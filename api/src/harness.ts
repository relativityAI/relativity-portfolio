import { streamText, generateText, isStepCount, type LanguageModel } from "ai";
import { extractToolCalls } from "./tools.js";
import { log } from "./logger.js";

// Transient failures worth waiting on and retrying — model refused to produce
// output (no text, no tool call), provider hiccups, rate limits, aborted stream.
export const RETRYABLE_ERROR = /NoOutputGenerated|ECONNRESET|ETIMEDOUT|aborted|429|5\d\d|overloaded|resource exhausted|internal error|rate limit|unavailable|temporarily/i;
export const STREAM_RETRIES = 2;
export const STREAM_RETRY_DELAY_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Shared agent turn harness. Both the analysis pipeline (agent.ts) and the
 * conversational agent builder (builder.ts) run their model loops through this
 * so every surface behaves identically: reasoning thoughts and tool calls are
 * streamed as trace events, tool use can be forced, and provider errors come
 * back normalized (a PDF/flle-input error becomes a message the user can act on).
 */

export type HarnessTraceEvent =
  | { type: "thought"; text: string }
  | { type: "tool_call"; tool: string; args?: unknown }
  | { type: "tool_result"; tool: string; status: "OK" | "ERR"; result?: unknown; duration_ms?: number }
  | { type: "decision"; score?: number; text?: string };

export interface HarnessOptions {
  model: LanguageModel;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Available tools (name -> tool spec). */
  tools?: Record<string, unknown>;
  /** Keep tools available (model may call zero or more). */
  forceTools?: boolean;
  /** Cap on tool-call rounds (passed to isStepCount). */
  maxToolSteps?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: HarnessTraceEvent) => void;
  /** Allow caller to restrict active tools per step (v2 path). */
  activeTools?: Array<string> | Record<string, any>;
  /** Per-step preparation to force tool use at start and drop at end (v2). */
  prepareStep?: any;
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

  let matched: HarnessResult | undefined;
  let lastError: unknown;

  for (const attempt of attempts) {
    for (let retry = 0; retry <= STREAM_RETRIES && !matched; retry++) {
      if (retry > 0) {
        log.warn("[harness]", "retrying model call after transient error:", String((lastError as any)?.message || lastError));
        await sleep(STREAM_RETRY_DELAY_MS);
      }
      try {
      const streamOpts: any = {
        model: opts.model,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.1,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
        stopWhen: isStepCount(maxToolSteps),
        abortSignal: opts.abortSignal,
        ...attempt,
      };
      if (attempt.prepareStep) streamOpts.prepareStep = attempt.prepareStep;
      if (opts.repairToolCall) streamOpts.repairToolCall = opts.repairToolCall;
      else if (hasTools && forceTools && opts.model) streamOpts.repairToolCall = buildToolCallRepair(opts.model);
      if (opts.activeTools) streamOpts.activeTools = opts.activeTools;
      if (opts.toolChoice) streamOpts.toolChoice = opts.toolChoice;
      const result = await streamText(streamOpts);

      let text = "";
      const observedToolCalls: { name: string; input: unknown }[] = [];
      let sawOutputPart = false;
      let streamHadError = false;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            text += part.text;
            sawOutputPart = true;
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
            onEvent?.({ type: "tool_call", tool: part.toolName, args: part.input ?? {} });
            break;
          case "tool-result":
            onEvent?.({
              type: "tool_result",
              tool: part.toolName,
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
              status: "ERR",
              result: String((part as any).error ?? ""),
            });
            break;
          case "error":
            // Provider refuses an empty final step (AI_NoOutputGeneratedError).
            // Only fatal when nothing at all was produced — otherwise keep what
            // we streamed and let the caller fill the missing verdict.
            streamHadError = true;
            break;
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
        steps = await result.steps;
        usage = await result.usage;
      }
      const lastStep = steps[steps.length - 1] as any;
      matched = {
        text,
        steps,
        toolCalls:
          steps.length > 0
            ? extractToolCalls(steps as any)
            : observedToolCalls.map((t) => ({ tool_name: t.name, args: t.input, status: "OK" })),
        finishReason: lastStep?.finishReason ?? (streamHadError ? "error" : "stop"),
        usage: usage ? { input: usage.inputTokens ?? undefined, output: usage.outputTokens ?? undefined } : undefined,
      };
      break;
    } catch (e: any) {
        lastError = e;
        // toolChoice 'required' unsupported by the provider -> next attempt falls
        // back to 'auto'; a transient stream failure is retried with a wait above
        // before giving up; a hard error propagates below.
        if (!RETRYABLE_ERROR.test(String(e?.message || e || ""))) break;
      }
    }
  }

  if (!matched) {
    const error = String((lastError as any)?.message || lastError || "Model call failed");
    const timedOut = (lastError as any)?.name === "TimeoutError" || /abort/i.test(String((lastError as any)?.name || error));
    return {
      text: "",
      steps: [],
      toolCalls: [],
      error,
      userMessage: describeInputError(lastError),
      retryable: !timedOut,
    };
  }

  // Force-tool gate: if we only reached a fallback (auto / no-tools) attempt and
  // the model produced neither tool calls nor any text, flag it so the caller
  // retries. A contentful zero-tool completion is accepted — the caller's
  // score recovery still fills in the verdict.
  if (hasTools && forceTools && matched.toolCalls.length === 0 && !matched.text.trim() && attempts.length > 1) {
    matched = {
      ...matched,
      error: "Model finished without calling any data tools",
      retryable: true,
    };
  }

  return matched;
}