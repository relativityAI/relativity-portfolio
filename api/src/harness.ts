import { streamText, generateText, isStepCount, type LanguageModel } from "ai";
import { extractToolCalls } from "./tools.js";
import { log } from "./logger.js";

// Transient failures worth waiting on and retrying — model refused to produce
// output (no text, no tool call), provider hiccups, rate limits, aborted stream.
// NB: Gemini reports exhausted quota as 400 RESOURCE_EXHAUSTED — matched here
// because it IS transient (the free-tier window resets), unlike a real 400.
export const RETRYABLE_ERROR = /NoOutputGenerated|ECONNRESET|ETIMEDOUT|aborted|429|5\d\d|overloaded|resource.?exhausted|internal error|rate.?limit|quota|exceeded|unavailable|temporarily/i;
export const STREAM_RETRIES = 2;
export const STREAM_RETRY_DELAY_MS = 3000;

/**
 * Per-provider output-token ceilings. Requesting more than a model's hard
 * maximum is not a transient error — the provider rejects the whole request
 * with 400 (Cohere: "TOO_MANY_TOKENS — max tokens must be ≤ 4096 … received
 * 8192"), which the caller would otherwise misread as "no tool use". Clamp
 * instead so every call site can safely ask for its ideal budget.
 */
const PROVIDER_MAX_OUTPUT_TOKENS: [string, number][] = [
  // command-r7b and peers cap output at 4096 (live-probed; provider string is "cohere.chat")
  ["cohere", 4096],
];

function clampMaxOutputTokens(provider: string, requested: number): number {
  for (const [prefix, cap] of PROVIDER_MAX_OUTPUT_TOKENS) {
    if (provider.startsWith(prefix) && requested > cap) return cap;
  }
  return requested;
}

/** Test hook — the clamp itself runs inside the stream loop. */
export const clampMaxOutputTokensForTest = clampMaxOutputTokens;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Providers leak function-call and thought-signature control envelopes into
 * the TEXT channel (observed: `</co: 0:[1,2,3,...]` and bare `[1,2,3,...]`
 * call-index arrays from Gemini). `text` accumulates every step of the tool
 * loop, so these survive into the extraction prompt and get pasted into
 * reports. Strip them where the text is accumulated, once.
 */
const CONTROL_ENVELOPE_RE = /<\/?(?:co|content|function_call|tool_call|thought_signature)[^>]*>|\[\s*\d+(?:\s*,\s*\d+)*\s*\]/gi;

export function stripControlEnvelopes(text: string): string {
  return text.replace(CONTROL_ENVELOPE_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

// Generous enough for a long structured output on a slow provider, short
// enough that a hung stream fails and retries inside the run's own lifetime.
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/**
 * Shared agent turn harness. Both the analysis pipeline (agent.ts) and the
 * conversational agent builder (builder.ts) run their model loops through this
 * so every surface behaves identically: reasoning thoughts and tool calls are
 * streamed as trace events, tool use can be forced, and provider errors come
 * back normalized (a PDF/flle-input error becomes a message the user can act on).
 */

export type HarnessTraceEvent =
  | { type: "thought"; text: string }
  | { type: "tool_call"; tool: string; toolCallId?: string; args?: unknown }
  | { type: "tool_result"; tool: string; toolCallId?: string; status: "OK" | "ERR"; result?: unknown; duration_ms?: number }
  | { type: "decision"; score?: number; text?: string };

export interface HarnessOptions {
  model: LanguageModel;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Wall-clock budget for the whole turn. A stream that never resolves
   *  (provider hang, dead connection) would otherwise block the pipeline
   *  until the run is swept as stale. */
  deadlineMs?: number;
  /** Abort signal passed through to the provider stream. */
  abortSignal?: AbortSignal;
  /** Available tools (name -> tool spec). */
  tools?: Record<string, unknown>;
  /** Keep tools available (model may call zero or more). */
  forceTools?: boolean;
  /** Cap on tool-call rounds (passed to isStepCount). */
  maxToolSteps?: number;
  onEvent?: (event: HarnessTraceEvent) => void;
  /** Allow caller to restrict active tools per step (v2 path). */
  activeTools?: Array<string> | Record<string, any>;
  /** Per-step preparation to force tool use at start and drop at end (v2). */
  prepareStep?: any;
  /** Provider-specific call options (e.g. google thinkingConfig) passed through. */
  providerOptions?: Record<string, any>;
  /** Called with the provider error text when a key-level failure (quota, rate
   *  limit) is seen, so the caller can rotate to another key. */
  onKeyError?: (message: string) => void;
  /** Tool-call repair (v7). */
  repairToolCall?: any;
  /** Tool choice override passed through (v2 structured verdict path). */
  toolChoice?: any;
}

export interface HarnessResult {
  text: string;
  steps: any[];
  toolCalls: Record<string, unknown>[];
  finishReason?: string;
  usage?: { input?: number; output?: number };
  /** Real provider error seen mid-stream (the SDK's turn-level error is often generic). */
  streamError?: string;
  /** Machine-readable error. */
  error?: string;
  /** Human-facing explanation (e.g. "model can't read PDFs") surfaced to the user. */
  userMessage?: string;
  retryable?: boolean;
}

/** Map a provider/model error mentioning files/PDFs into advice the user can act on. */
export function describeInputError(e: unknown): string | undefined {
  const msg = String((e as any)?.message || e || "");
  if (/cannot read|does not support (pdf|file|image)|pdf input|file input|image input/i.test(msg)) {
    return "The model couldn't read that material directly — this model takes text only, not PDF/file attachments. Re-upload the document so its text gets extracted, or pick a different model.";
  }
  return undefined;
}

/**
 * Default per-step tool policy for tool loops that must END with a plain text
 * verdict. Step 0 forces a tool call (grounded research — fixes the small-model
 * habit of answering from memory with zero tool use); later steps free the model
 * so it can terminate in text (e.g. FINAL_SCORE), which the SDK's
 * `toolChoice: "required"` alone can never allow.
 */
export function buildForceToolsPrepareStep(toolNames: string[]) {
  return async ({ stepNumber }: { stepNumber: number }): Promise<any> => {
    if (stepNumber === 0) {
      return { toolChoice: "required" as const, activeTools: toolNames };
    }
    return {};
  };
}

/**
 * Re-ask the model for corrected tool args when a tool call fails schema
 * validation (small models emit malformed args). Bounded: one re-ask, short
 * output; best-effort — a failed repair returns null so the SDK surfaces the
 * original InvalidToolInputError to the caller's recovery path.
 */
export function buildToolCallRepair(model: LanguageModel) {
  return async (opts: any): Promise<any> => {
    try {
      const { toolCall, inputSchema, error } = opts;
      const schema = await inputSchema({ toolName: toolCall.toolName });
      const res = await generateText({
        model,
        prompt: [
          "A tool call you made failed schema validation. Fix ONLY its JSON arguments (the `input`) so they match the schema exactly. Reply with the corrected JSON object and nothing else.",
          `Tool: ${toolCall.toolName}`,
          `Validation error: ${String((error as any)?.message || error) || "invalid arguments"}`,
          `Schema: ${JSON.stringify(schema)}`,
          `Original input: ${typeof toolCall.input === "string" ? toolCall.input : JSON.stringify(toolCall.input)}`,
        ].join("\n"),
        temperature: 0,
        maxOutputTokens: 2048,
      });
      const text = (res.text || "").replace(/```(?:json)?|```/g, "").trim();
      const start = text.indexOf("{");
      if (start < 0) return null;
      const input = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
      return { ...toolCall, input };
    } catch {
      return null;
    }
  };
}

/**
 * Resilience for one-off LLM calls (generateObject / generateText) that
 * sit OUTSIDE the agent-turn loop: structured extraction, planning,
 * report synthesis. The turn loop already retries transient stream
 * failures internally; these single-shot calls used to die on the
 * first provider hiccup and silently downgrade the run (empty plan,
 * lost extraction, missing executive summary). The harness contract is
 * that ONE failed LLM call never kills a pipeline stage: retry it.
 *
 * Retries on transient provider conditions (RETRYABLE_ERROR) and on
 * empty/invalid output when a checker is supplied. Permanent errors
 * (auth, schema misuse) propagate immediately so callers fail fast.
 */
export async function retryLlmCall<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    /** Called with the error text on each failure so the key pool can rotate. */
    onError?: (message: string, attempt: number) => void;
    /** Validate the result; an invalid result is retried like an error. */
    check?: (result: T) => boolean;
    /**
     * Per-attempt wall-clock budget. Without it a provider that accepts the
     * request and then never resolves hangs the whole pipeline until the
     * stale-run sweeper kills the run — which is how we lost reports whose
     * scores were already persisted. The signal is FRESH per attempt: a
     * deadline created once would already be expired on the retry.
     */
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      log.warn("[harness]", `retrying ${label} (attempt ${attempt}/${attempts}) after:`, String((lastError as any)?.message || lastError));
      await sleep(delayMs);
    }
    // Both halves matter: the signal cancels the provider request (so we are
    // not leaking sockets/containers), and the race stops us WAITING on a
    // caller that ignores the signal.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([fn(controller.signal), deadline]);
      if (opts.check && !opts.check(result)) {
        throw new Error(`${label} returned an invalid/empty result`);
      }
      return result;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e || "");
      opts.onError?.(msg, attempt);
      // Clearly permanent failures (auth, bad request, quota) fail fast;
      // everything else — transient provider conditions AND unknown error
      // classes — is retried. The harness promise is resilience: one
      // failed LLM call must never silently downgrade the pipeline.
      const permanent = /invalid api key|unauthorized|authentication|invalid request|bad request|too_many_tokens|insufficient quota/i.test(msg) && !RETRYABLE_ERROR.test(msg);
      if (permanent || attempt >= attempts) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || `${label} failed after ${attempts} attempts`));
}

export async function runAgentTurn(opts: HarnessOptions): Promise<HarnessResult> {
  const { tools, forceTools, onEvent } = opts;
  const hasTools = !!tools && Object.keys(tools).length > 0;
  const maxToolSteps = opts.maxToolSteps ?? 10;

  // NB: never use toolChoice 'required' for a loop that must END with a plain
  // text answer — it forces a tool call on the final round too, so the model
  // can never write the closing verdict. prepareStep solves it: force tools on
  // step 0 only, then free the model (auto) to end in text. Providers that
  // can't honor a forced step degrade to the legacy auto attempt, not a failure.
  const forceStep = opts.prepareStep ?? (forceTools && hasTools ? buildForceToolsPrepareStep(Object.keys(tools)) : undefined);
  const attempts: Array<Record<string, unknown>> = !hasTools
    ? [{}]
    : forceTools
      ? !forceStep
        ? [{ tools }, {}]
        : [{ tools, prepareStep: forceStep }, { tools }]
      : [{ tools }];

  // Whole-turn wall-clock budget: if the provider stream hangs (no chunks, no
  // close) the loop below would never resolve and the run would sit in
  // RUNNING until the stale sweeper kills it. The deadline aborts the stream;
  // the resulting TimeoutError is non-retryable so we fail fast and honestly.
  const deadlineMs = opts.deadlineMs ?? 0;
  const turnAbort = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  if (deadlineMs > 0) {
    deadlineTimer = setTimeout(() => {
      const err = new Error(`Model turn exceeded its ${Math.round(deadlineMs / 1000)}s time budget`);
      (err as any).name = "TimeoutError";
      turnAbort.abort(err);
    }, deadlineMs);
  }
  // Combine with any caller-provided signal.
  const signals: AbortSignal[] = [turnAbort.signal];
  if (opts.abortSignal) signals.push(opts.abortSignal);
  const abortSignal = signals.length === 1 ? signals[0] : (AbortSignal as any).any
    ? (AbortSignal as any).any(signals)
    : turnAbort.signal;

  let matched: HarnessResult | undefined;
  let lastError: unknown;
  // Whatever the model managed to say before the turn died. A failed turn used to
  // return "" and throw its text away, so a crashed run showed the user an empty
  // reasoning tab even when the model had already streamed an answer.
  let lastText = "";
  let streamErrorText: string | undefined;
  let usedBareFallback = false;

  for (const attempt of attempts) {
    for (let retry = 0; retry <= STREAM_RETRIES && !matched; retry++) {
      if (retry > 0) {
        log.warn("[harness]", "retrying model call after transient error:", String((lastError as any)?.message || lastError));
        await sleep(STREAM_RETRY_DELAY_MS);
      }
      // `text` lives outside the try so the catch below can keep
      // the partial output when the stream throws mid-turn.
      let text = "";
      try {
      const streamOpts: any = {
        model: opts.model,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.1,
        maxOutputTokens: clampMaxOutputTokens(
          String((opts.model as any)?.provider || ""),
          opts.maxOutputTokens ?? 4096,
        ),
        stopWhen: isStepCount(maxToolSteps),
        abortSignal,
        ...attempt,
      };
      if (attempt.prepareStep) streamOpts.prepareStep = attempt.prepareStep;
      if (opts.repairToolCall) streamOpts.repairToolCall = opts.repairToolCall;
      else if (hasTools && forceTools && opts.model) streamOpts.repairToolCall = buildToolCallRepair(opts.model);
      if (opts.activeTools) streamOpts.activeTools = opts.activeTools;
      if (opts.toolChoice) streamOpts.toolChoice = opts.toolChoice;
      if (opts.providerOptions) streamOpts.providerOptions = opts.providerOptions;
      const result = await streamText(streamOpts);

      const observedToolCalls: { name: string; input: unknown }[] = [];
      let sawOutputPart = false;
      let streamHadError = false;
      for await (const part of result.fullStream) {
        switch (part?.type) {
          case "text-delta":
            // NB: never trim per-chunk — streamed deltas split mid-sentence
            // ("I can" + " help"), so a per-chunk trim eats the inter-word
            // spaces and yields "Icanhelp". Envelopes are stripped once on the
            // accumulated text after the loop, as designed.
            text += part.text;
            sawOutputPart = true;
            break;
          case undefined:
            break;
          case "reasoning-delta":
            // A thinking model streams reasoning before any text. Count the step
            // as output so `steps` resolves instead of throwing
            // AI_NoOutputGeneratedError and burning retries.
            onEvent?.({ type: "thought", text: part.text });
            sawOutputPart = true;
            break;
          case "reasoning-start":
          case "reasoning-end":
            sawOutputPart = true;
            break;
          case "tool-call":
            observedToolCalls.push({ name: part.toolName, input: part.input ?? {} });
            sawOutputPart = true;
            onEvent?.({ type: "tool_call", tool: part.toolName, toolCallId: part.toolCallId, args: part.input ?? {} });
            break;
          case "tool-result":
            onEvent?.({
              type: "tool_result",
              tool: part.toolName,
              toolCallId: part.toolCallId,
              status: "OK",
              result: (part as any).output,
              duration_ms: typeof (part as any).duration === "number" ? (part as any).duration : undefined,
            });
            break;
          case "tool-error":
            streamHadError = true;
            onEvent?.({
              type: "tool_result",
              tool: part.toolName,
              toolCallId: part.toolCallId,
              status: "ERR",
              result: String((part as any).error ?? ""),
            });
            break;
          case "error": {
            // Provider refuses an empty final step (AI_NoOutputGeneratedError).
            // Only fatal when nothing at all was produced — otherwise keep what
            // we streamed and let the caller fill the missing verdict.
            streamHadError = true;
            // Keep the REAL provider error text: the SDK replaces the whole
            // turn with a generic "No output generated" at flush, which hides
            // the actual cause (rate limit, invalid key, signature bug, ...).
            const emsg = String((part as any).error?.message ?? (part as any).error ?? "");
            if (emsg && !/No output generated/i.test(emsg)) streamErrorText = emsg;
            // Rate-limit / quota errors seen mid-stream: report the key so the
            // pool rotates to a healthy one instead of retrying the same key.
            if (typeof (opts as any).onKeyError === "function" && /quota|rate.?limit|429|exceeded|resource.?exhausted/i.test(emsg)) {
              (opts as any).onKeyError(emsg);
            }
            break;
          }
          default:
            break;
        }
      }

      // fullStream resolves, but the SDK rejects steps/text with
      // AI_NoOutputGeneratedError when the last step was empty. If we already
      // have output, keep the turn; if we produced nothing, let the error throw.
      let steps: any[] = [];
      let usage: any = null;
      if (sawOutputPart) {
        try { steps = await result.steps; } catch { steps = []; }
        try { usage = await result.usage; } catch { usage = null; }
      } else {
        try {
          steps = await result.steps;
          usage = await result.usage;
        } catch {
          // Nothing was produced AND the SDK wraps the flush in the generic
          // AI_NoOutputGeneratedError. The REAL cause is almost always in the
          // streamError we captured above (provider 401/429/5xx text). Re-throw
          // that so the error the caller sees names the actual problem instead
          // of the opaque "No output generated" wrapper.
          throw new Error(streamErrorText || "No output generated. Check the stream for errors.");
        }
      }
      const lastStep = steps[steps.length - 1] as any;
      matched = {
        text: stripControlEnvelopes(text),
        steps,
        streamError: streamErrorText,
        toolCalls:
          steps.length > 0
            ? extractToolCalls(steps as any)
            : observedToolCalls.map((t) => ({ tool_name: t.name, args: t.input, status: "OK" })),
        finishReason: lastStep?.finishReason ?? (streamHadError ? "error" : "stop"),
        usage: usage ? { input: usage.inputTokens ?? undefined, output: usage.outputTokens ?? undefined } : undefined,
      };
      break;      } catch (e: any) {
        lastError = e;
        // Keep whatever the model managed to say before the throw — a
        // failed turn must not discard its partial stream, or a crashed
        // run shows an empty reasoning tab even though the model spoke.
        if (text.trim()) lastText = text;
        log.warn("[harness]", "model turn attempt failed:", e?.message || e, e?.stack ? String(e.stack).split("\n").slice(1, 4).join(" | ") : "");
        // The deadline already fired: fail fast, don't burn retries on a signal
        // that will abort every subsequent attempt.
        if (turnAbort.signal.aborted) break;
        // A raw TypeError/undefined-access escaping the stream is an SDK or
        // provider-adapter bug on a decorated call path (prepareStep / repair /
        // activeTools), not a model failure. Retry once with the plainest
        // possible call — no decorations — before giving up.
        const isJsBug = e instanceof TypeError || /^Cannot read propert/i.test(String(e?.message || ""));
        if (isJsBug && !usedBareFallback) {
          usedBareFallback = true;
          // Keep the toolset: a bare {} attempt has no tools, so the
          // force-tool gate below can only fail and the turn dies with
          // "the provider returned no tool use" even when the plain
          // call path would have worked.
          attempts.push({ tools });
          log.warn("[harness]", "JS error on decorated call path — retrying once with a bare attempt:", String(e?.message || e));
          continue;
        }
        // A provider that rejects our thinking config (e.g. thinkingBudget 0 on
        // Gemini 3) fails every attempt instantly with a 400. Strip provider
        // options and retry once rather than failing the whole run.
        const rejectsThinking = /400|InvalidArgument|thinking/i.test(String(e?.message || "")) && !!opts.providerOptions;
        if (rejectsThinking && !usedBareFallback) {
          usedBareFallback = true;
          attempts.push({ ...attempts[attempts.length - 1], providerOptions: undefined });
          log.warn("[harness]", "provider rejected thinking config — retrying without it:", String(e?.message || e).slice(0, 160));
          continue;
        }
        // toolChoice 'required' unsupported by the provider -> next attempt falls
        // back to 'auto'; a transient stream failure is retried with a wait above
        // before giving up; a hard error propagates below.
        if (!RETRYABLE_ERROR.test(String(e?.message || e || ""))) break;
      }
    }
  }

  if (!matched) {
    let error = String((lastError as any)?.message || lastError || "Model call failed");
    // A bare "Cannot read properties of undefined (reading 'x')" names neither
    // our bug nor the provider's, so the surface text ended up blaming the model
    // for our own crash. Append the top in-repo stack frame so the throw site is
    // visible where the error is actually read.
    if (/^Cannot read propert/i.test(error)) {
      const frame = String((lastError as any)?.stack || "")
        .split("\n")
        .slice(1)
        .find((l) => l.includes("/src/") && !l.includes("node_modules"));
      if (frame) {
        const at = frame.match(/((?:\/|^)[^\s)]*\/src\/[^\s)]+)/);
        error += ` [thrown at ${at ? at[1].replace(process.cwd(), "") : frame.trim()}]`;
      }
    }
    const timedOut = (lastError as any)?.name === "TimeoutError" || /abort/i.test(String((lastError as any)?.name || error));
    return {
      text: lastText,
      steps: [],
      toolCalls: [],
      error,
      userMessage: describeInputError(lastError),
      retryable: !timedOut,
    };
  }

  if (deadlineTimer) clearTimeout(deadlineTimer);

  // Force-tool gate: if we only reached a fallback (auto / no-tools) attempt and
  // the model produced neither tool calls nor any text, flag it so the caller
  // retries. A contentful zero-tool completion is accepted — the caller's
  // score recovery still fills in the verdict.
  if (hasTools && forceTools && matched.toolCalls.length === 0 && !matched.text.trim() && attempts.length > 1) {
    matched = {
      ...matched,
      error: matched.streamError || "Model finished without calling any data tools",
      retryable: !matched.streamError,
    };
  }

  return matched;
}
