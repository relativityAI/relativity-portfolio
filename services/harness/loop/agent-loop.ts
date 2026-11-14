/**
 * Core agent loop — a ReAct-style `ToolLoopAgent` over native tool calling.
 *
 * The SDK owns the loop mechanics (message history, step iteration, stop
 * conditions); this module owns discipline: the evidence trace, output-token
 * budget stops, CONTEXT COMPACTION, and a soft deadline nudge that reminds the
 * agent to start writing before the budget dies — tool choice is never forced.
 *
 * Compaction runs inside prepareStep — only when thresholds trip, not every
 * step — so the agent can keep working long after the raw history would have
 * blown the context window (the failure mode where a run dies 8 steps in with
 * 46k re-billed input tokens and a half-written report):
 *
 *   CLEAR     every step: BULK tool results (fs_* pages, >8KB) older than
 *             the last ~3 are replaced with `[cleared] full output at
 *             <workspace path>` — Anthropic's clearing config default.
 *             Compact state digests are never retired (see isClearable).
 *             Stays restorable: the full payload lives on the workspace
 *             filesystem (the KB archive), so the model fs_read's it back
 *             when a figure is needed again.
 *   SUMMARIZE when the last step's input tokens pass ~90% of the context
 *             budget: a cheap model compacts everything older than the last
 *             N messages into a continuation brief (tickers, figures with
 *             source + date, open questions, plan state). One call, then the
 *             input drops back to the recent window.
 *
 * The system prompt (instructions) and the last N messages are never touched.
 * The canvas itself never rides the context — the agent appends sections with
 * report_write as evidence lands; assembly is deterministic afterwards.
 *
 *   new ToolLoopAgent({ model, instructions, tools, stopWhen, prepareStep })
 *   stopWhen: [stepCountIs(maxSteps), overBudget(maxTokens)]  — first match stops
 *   serve with createAgentUIStreamResponse (see serveAgentUIStream)
 */

import {
  ToolLoopAgent,
  createAgentUIStreamResponse,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { promptDoc } from "../config.js";
import { repairNullToolArgs } from "../resilience.js";
import { friendlyError } from "../errors.js";
import { describeToolCall } from "../tools/describe.js";
import type { ToolContext, ToolDefinition } from "../tools/registry.js";
import type { Budget, TraceEvent } from "../types.js";

/** Optional tool args are declared `.nullish()` so Groq's server-side schema
 *  validation accepts the explicit `null` models emit to mean "omit"; drop the
 *  nulls before the handler so it still sees the arg as absent. */
function stripNullArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) if (v !== null) out[k] = v;
  return out;
}

// ── Compaction ──────────────────────────────────────────────────────────────

/** Clearing keeps the last N tool results verbatim (Anthropic's default). */
export const KEEP_RECENT_TOOL_RESULTS = 3;
/** Results over this size are bulk regardless of tool — always clearable. */
const CLEAR_SIZE_CHARS = 8_000;

/**
 * What clearing may retire: `fs_*` pages (raw workspace reads, one fs_read
 * away from restore) and anything over CLEAR_SIZE_CHARS (bulk prose/MCP).
 * Everything else past the keep-window is RESEARCH STATE — the compact
 * digests the model reasons over ("tool results are your research state").
 * Stubbing those sends the model into fs_read/re-search loops to get the
 * numbers back: run efb0994b re-read the same price digest for 22 of 30
 * steps (41 fs_reads) and shipped a single section.
 */
function isClearable(part: { toolName?: string; output?: unknown }): boolean {
  if (part.toolName?.startsWith("fs_")) return true;
  const text = typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
  return text.length > CLEAR_SIZE_CHARS;
}
/** Messages kept verbatim beside the summary when the summarizer trips. */
export const SUMMARIZE_KEEP_RECENT = 6;
/** Summarize when the last step's input tokens pass this share of the budget. */
export const SUMMARIZE_INPUT_RATIO = 0.9;
/** Default input-token working budget (summarize trips at 90% of it). */
export const DEFAULT_CONTEXT_BUDGET = 96_000;

/** Custom compaction prompt (config/prompts/COMPACTION.md) — fidelity is figures, sources, and plan state. */
function compactionPrompt(): string {
  return promptDoc("compaction");
}

/** Where the cleared payload can be restored from, when the tool archived it. */
function sourcePathOf(output: unknown): string | undefined {
  const value = (output as { value?: unknown } | undefined)?.value ?? output;
  const source = (value as { _source?: { path?: unknown } } | null | undefined)?._source;
  return typeof source?.path === "string" ? source.path : undefined;
}

function truncate(value: unknown, max = 1500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * CLEAR: replace bulk tool results older than the last `keep` with a one-line
 * stub pointing at the workspace path where the full output lives. The
 * assistant tool-call parts stay (the pairing remains valid), so context
 * grows by ~20 tokens per retired call instead of the full payload — and a
 * needed figure is one fs_read away. Compact state digests (see isClearable)
 * are NEVER retired, however old they get.
 */
export function clearOldToolResults(messages: ModelMessage[], keep = KEEP_RECENT_TOOL_RESULTS): ModelMessage[] {
  return clearOldToolResultsDetailed(messages, keep).messages;
}

/** Clearing plus how many results were actually retired (for the trace log). */
export function clearOldToolResultsDetailed(
  messages: ModelMessage[],
  keep = KEEP_RECENT_TOOL_RESULTS,
): { messages: ModelMessage[]; cleared: number } {
  const toolIndexes: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") toolIndexes.push(i);
  });
  if (toolIndexes.length <= keep) return { messages, cleared: 0 };
  const beyondWindow = new Set(toolIndexes.slice(0, toolIndexes.length - keep));
  let cleared = 0;
  const out = messages.map((m, i) => {
    if (m.role !== "tool" || !beyondWindow.has(i)) return m;
    let changed = false;
    const content = (m.content as Array<Record<string, unknown>>).map((part) => {
      if (part?.type !== "tool-result" || !isClearable(part)) return part;
      changed = true;
      cleared++;
      const path = sourcePathOf(part.output);
      return {
        ...part,
        output: {
          type: "text",
          value: path
            ? `[cleared] full output at ${path} — fs_read to restore`
            : "[cleared] full output archived in the research workspace",
        },
      } as Record<string, unknown>;
    });
    return changed ? ({ ...m, content } as ModelMessage) : m;
  });
  return { messages: out, cleared };
}

/** Drop reminders we injected last step (idempotent if the SDK persisted them). */
function stripReminders(messages: ModelMessage[]): ModelMessage[] {
  const text = (m: ModelMessage): string =>
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((p: any) => (p?.type === "text" ? p.text : "")).join("")
        : "";
  const out = messages.filter((m) => !(m.role === "user" && text(m).startsWith("<reminder>")));
  return out.length === messages.length ? messages : out;
}

/** One message → a few transcript lines for the summarizer (bounded). */
function describeMessage(m: ModelMessage): string {
  if (m.role === "user" || m.role === "system") {
    return `${m.role.toUpperCase()}: ${truncate(m.content, 4000)}`;
  }
  if (m.role === "assistant") {
    return (m.content as Array<Record<string, unknown>>)
      .map((p) => {
        if (p?.type === "text") return `ASSISTANT: ${truncate(p.text, 2000)}`;
        if (p?.type === "tool-call") return `CALL ${p.toolName}: ${truncate(p.input, 1500)}`;
        if (p?.type === "reasoning") return `THINK: ${truncate((p as any).text ?? "", 400)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (m.role === "tool") {
    return (m.content as Array<Record<string, unknown>>)
      .map((p) => (p?.type === "tool-result" ? `RESULT ${p.toolName}: ${truncate(p.output, 2000)}` : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * SUMMARIZE: compact everything older than the last `keepRecent` messages
 * (plus the seed task message) into one continuation brief via the cheap
 * model. Returns the new message list; the old messages stay recoverable
 * through the workspace (cleared stubs point at their paths).
 */
export async function summarizeOlderMessages(options: {
  messages: ModelMessage[];
  model: LanguageModel;
  keepRecent?: number;
  abortSignal?: AbortSignal;
}): Promise<{ messages: ModelMessage[]; summary: string }> {
  const { model } = options;
  const keepRecent = options.keepRecent ?? SUMMARIZE_KEEP_RECENT;
  const seed = messages0(options.messages);
  const rest = options.messages.slice(seed.length);
  if (rest.length < 3) return { messages: options.messages, summary: "" };
  // Adaptive window: keep up to `keepRecent` messages but always leave
  // something to compact. Never split a tool-call/tool-result pair at the
  // cut — the SDK rejects an orphaned tool message.
  let cut = rest.length - Math.min(keepRecent, Math.max(1, rest.length - 2));
  while (cut > 0 && rest[cut]?.role === "tool") cut--;
  const older = rest.slice(0, cut);
  const keep = rest.slice(cut);
  const transcript = older.map(describeMessage).filter(Boolean).join("\n\n");
  if (!transcript.trim()) return { messages: options.messages, summary: "" };

  const result = await generateText({
    model,
    system: compactionPrompt(),
    prompt: `Compact this conversation into the continuation brief. Keep every figure with its [src:id] and date.\n\n${transcript}`,
    maxRetries: 1,
    maxOutputTokens: 1500,
    abortSignal: options.abortSignal,
  });
  const summary = (result.text ?? "").trim();
  if (!summary) return { messages: options.messages, summary: "" };
  const summaryMessage: ModelMessage = {
    role: "user",
    content: `[conversation summary — earlier steps compacted to free context; the system instructions still apply]\n${summary}\n\nOlder tool outputs remain archived in the workspace: fs_read the path in any [cleared] stub when you need the raw data.`,
  };
  return { messages: [...seed, summaryMessage, ...keep], summary };
}

function messages0(messages: ModelMessage[]): ModelMessage[] {
  return messages[0]?.role === "user" ? [messages[0]] : [];
}

// ── Agent construction ──────────────────────────────────────────────────────

export interface LoopConfig {
  model: LanguageModel;
  system: string;
  prompt: string;
  tools: ToolDefinition[];
  allowedTools?: string[];
  ctx: ToolContext;
  budget: Budget;
  /**
   * Input-token working budget per request. Summarize compaction trips when
   * the last step's input tokens pass 90% of this. Defaults to the smaller
   * of the output budget and DEFAULT_CONTEXT_BUDGET — the run that motivated
   * compaction re-billed 46k input on step 8 and died mid-report.
   */
  contextBudget?: number;
  /** Cheap model for summarize compaction; without it only clearing runs. */
  summarizerModel?: LanguageModel;
  /**
   * Per-step state reminder (todo/plan file, memory) — injected as a
   * TRAILING user message in prepareStep, never into the static prefix:
   * the system prompt stays byte-identical every step so provider caching
   * holds; the reminder re-reads live state (the agent edits it mid-run).
   */
  reminders?: () => string | undefined;
  /**
   * Tool whose absence triggers a soft "write now" nudge while the budget
   * runs low (the canvas pipeline passes "report_write"). An instruction
   * only — the model keeps its tool choice; nothing is ever forced.
   */
  deadlineTool?: string;
  /**
   * Checked after every step (in addition to budgets): return true to stop
   * the loop immediately — e.g. the planner stops the moment the plan is
   * saved instead of burning a round trip on a wrap-up text step.
   */
  stopAfter?: () => boolean;
  abortSignal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
  /**
   * Pure observation hook: fires after each SDK step with the untouched
   * StepResult (usage, text, tool calls). For presentation only — the CLI
   * footer reads step number and token usage from it. Optional; when absent
   * (or a provider omits usage fields) the loop behaves exactly as before.
   */
  onStepFinish?: (step: StepResult<ToolSet>) => void;
}

/** Agent-shaped config: everything except the per-run prompt/stream input. */
export type LoopAgentConfig = Omit<LoopConfig, "prompt" | "abortSignal" | "onEvent">;

/** Per-run hooks: the trace sink and step accounting. */
export interface LoopRunHooks {
  onEvent?: (event: TraceEvent) => void;
  onStepFinish?: (step: StepResult<ToolSet>) => void;
}

export interface LoopResult {
  status: "completed" | "budget_exhausted" | "failed";
  text: string;
  steps: number;
  /** Output tokens (budget currency). */
  tokens: number;
  /** Input tokens (reporting only — never charged against the budget). */
  inputTokens: number;
  /** Highest single-step input — what compaction fights (summarize trips at 90% of the context budget). */
  peakInput: number;
  trace: TraceEvent[];
}

/**
 * Build the ToolLoopAgent: harness tools → SDK toolset (with null-stripping,
 * existence gate and trace), ReAct instructions, stop conditions, and the
 * prepareStep hook that compacts context (clear + summarize) and drives the
 * deadline.
 */
export function createLoopAgent(
  config: LoopAgentConfig,
  hooks: LoopRunHooks = {},
  runtime: { abortSignal?: AbortSignal } = {},
): ToolLoopAgent<never, ToolSet> {
  const emit = hooks.onEvent ?? (() => {});

  const allowed = config.allowedTools;
  const tools = allowed ? config.tools.filter((t) => allowed.includes(t.name)) : config.tools;

  const sdkTools: Record<
    string,
    { description: string; inputSchema: z.ZodTypeAny; execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown> }
  > = {};
  let deadlineCalled = false;
  for (const t of tools) {
    sdkTools[t.name] = {
      description: t.description,
      inputSchema: t.parameters,
      execute: async (args: unknown, opts: { toolCallId: string }) => {
        const started = Date.now();
        const clean = stripNullArgs(args);
        emit({ type: "tool_call", tool: t.name, toolCallId: opts.toolCallId, args: clean, summary: describeToolCall(t.name, clean) });
        try {
          const result = await t.execute(clean as never, config.ctx);
          // Existence gate: a tool that "succeeds" with nothing (undefined/null)
          // must not reach the model as OK — OK-with-nothing invites fabrication.
          if (result == null) throw new Error("tool returned no data");
          // Stand the deadline down only when the deadline tool LANDED (result
          // carries no `error`). One rejected report_write must not free the
          // agent to burn the rest of the budget on research — KEI run
          // 2026-10-30T04-36: a placeholder write was rejected and the agent
          // went straight back to fs_read with an empty canvas.
          if (
            config.deadlineTool &&
            t.name === config.deadlineTool &&
            !(result && typeof result === "object" && "error" in result)
          )
            deadlineCalled = true;
          emit({ type: "tool_result", tool: t.name, toolCallId: opts.toolCallId, status: "ok", result, durationMs: Date.now() - started });
          return result;
        } catch (e: any) {
          const error = e?.message || String(e);
          emit({ type: "tool_result", tool: t.name, toolCallId: opts.toolCallId, status: "error", result: error, durationMs: Date.now() - started, summary: friendlyError(error) });
          return { error };
        }
      },
    };
  }

  // Deadline window: the last ~25% of the step budget (at least 2 steps).
  // While deadlineTool hasn't run, prepareStep appends a soft "start writing"
  // instruction — advice only; the model decides which tool to call.
  const hasDeadline = !!config.deadlineTool && tools.some((t) => t.name === config.deadlineTool);
  const reserve = Math.max(2, Math.ceil(config.budget.maxSteps * 0.25));
  let deadlineNudged = false;

  // Wall clock: soft "write now" at 60% of maxMs, hard stop via stopWhen
  // (checked BETWEEN steps — an in-flight report write is never killed).
  const startedAt = Date.now();
  const maxMs = config.budget.maxMs && config.budget.maxMs > 0 ? config.budget.maxMs : 0;
  let timeNudged = false;

  // Batch discipline: a streak of single-call research turns gets one nudge.
  let singleStreak = 0;
  let batchNudges = 0;

  // Per-step wall timing — the only way to see where a run's seconds go.
  const runStartedAt = Date.now();
  let lastStepAt = 0;

  // Compaction threshold: 90% of the input-token working budget.
  const contextBudget = Math.max(
    4_000,
    config.contextBudget ?? Math.min(config.budget.maxTokens, DEFAULT_CONTEXT_BUDGET),
  );
  const summarizeAt = contextBudget * SUMMARIZE_INPUT_RATIO;
  let lastSummarizedAtStep = -10;
  let clearLogged = false;

  return new ToolLoopAgent<never, ToolSet>({
    model: config.model,
    // Instructions arrive fully assembled from run.ts (AGENTS doc + system doc).
    instructions: config.system,
    tools: sdkTools as ToolSet,
    // Retries are owned by the caller (index.ts) so each attempt can rotate to a
    // fresh key/model; the SDK's own retry hammers the same exhausted key.
    maxRetries: 0,
    // Drop null optional args (Groq gpt-oss) before schema validation.
    repairToolCall: async (opts: any) => repairNullToolArgs(opts.toolCall),
    // Arrays stop on the first match: step budget, output-token budget,
    // then the caller's own stop condition (plan saved, sections written…).
    stopWhen: [
      stepCountIs(config.budget.maxSteps),
      overBudget(config.budget.maxTokens),
      ...(maxMs ? [overDeadline(maxMs, startedAt)] : []),
      ...(config.stopAfter ? [config.stopAfter] : []),
    ],
    prepareStep: async ({ stepNumber, messages, steps }) => {
      // Step timing: the gap since the previous prepareStep IS the previous
      // step's wall time (model + tools).
      const now = Date.now();
      if (lastStepAt) {
        emit({
          type: "log",
          text: `step ${stepNumber - 1}: ${((now - lastStepAt) / 1000).toFixed(1)}s · in ${(steps.at(-1)?.usage?.inputTokens ?? 0).toLocaleString()} tok · elapsed ${((now - runStartedAt) / 1000).toFixed(0)}s`,
        });
      }
      lastStepAt = now;

      // Reminders from last step come off first (fresh state replaces stale).
      let compacted = stripReminders(messages);

      // ── COMPACTION (only when thresholds trip — never every step) ────────
      const lastInput = steps.at(-1)?.usage?.inputTokens ?? 0;
      if (config.summarizerModel && lastInput > summarizeAt && stepNumber - lastSummarizedAtStep >= 2) {
        try {
          const { messages: summarized, summary } = await summarizeOlderMessages({
            messages: compacted,
            model: config.summarizerModel,
            abortSignal: runtime.abortSignal,
          });
          if (summary) {
            compacted = summarized;
            lastSummarizedAtStep = stepNumber;
            emit({
              type: "log",
              text: `compaction: summarized older context — last step input ${lastInput.toLocaleString()} > ${Math.round(summarizeAt).toLocaleString()} token threshold`,
            });
          }
        } catch (e: any) {
          emit({ type: "log", text: `compaction: summarize failed (${friendlyError(e?.message || String(e))}) — clearing only` });
        }
      }
      // CLEAR runs every step (cheap): retire tool results past the keep-window.
      const clearing = clearOldToolResultsDetailed(compacted);
      compacted = clearing.messages;
      if (clearing.cleared > 0 && !clearLogged) {
        clearLogged = true;
        emit({
          type: "log",
          text: `compaction: clearing active — ${clearing.cleared} old tool result(s) replaced with workspace pointers (kept last ${KEEP_RECENT_TOOL_RESULTS})`,
        });
      }

      // ── TRAILING REMINDER — todo state, memory, deadline nudge ──────────
      // Instructions are never touched: the prefix stays static for caching,
      // all per-step state rides this trailing message.
      const parts: string[] = [];
      const state = config.reminders?.();
      if (state) parts.push(state);
      if (hasDeadline && !deadlineCalled) {
        const remaining = config.budget.maxSteps - stepNumber;
        if (remaining <= reserve) {
          const toolName = config.deadlineTool!;
          // Soft nudge only — the model keeps full control of tool choice.
          if (!deadlineNudged) {
            deadlineNudged = true;
            emit({ type: "log", text: `${remaining} steps left and ${toolName} never called — telling the agent to write now` });
          }
          parts.push(
            `DEADLINE: only ${remaining} steps remain and ${toolName} has not been called yet. Stop gathering evidence. Assemble the report NOW from the evidence already gathered with ${toolName} — one call per section-group, real findings only (never placeholder text) — then refine if steps allow.`,
          );
        }
      }
      if (maxMs && !timeNudged && Date.now() - startedAt > maxMs * 0.6) {
        timeNudged = true;
        const left = Math.max(1, Math.round((maxMs - (Date.now() - startedAt)) / 1000));
        parts.push(
          `TIME: about ${left}s left before the hard stop — stop gathering and assemble your output NOW from the evidence already in hand (${config.deadlineTool ?? "your final deliverable"}), real findings only.`,
        );
      }
      // BATCH: single-call research streak (deadlineTool excluded — section
      // writes are meant to be one call each).
      const lastCalls = steps.at(-1)?.toolCalls ?? [];
      const researching = lastCalls.length === 1 && lastCalls[0]?.toolName !== config.deadlineTool;
      singleStreak = researching ? singleStreak + 1 : 0;
      if (singleStreak >= 3 && batchNudges < 2) {
        batchNudges++;
        parts.push(
          `BATCH: ${singleStreak} turns in a row with exactly ONE tool call — issue independent reads/greps/searches together in a single turn (several tool calls per response).`,
        );
      }
      if (!parts.length) return { messages: compacted };
      return { messages: [...compacted, { role: "user" as const, content: `<reminder>\n${parts.join("\n\n")}\n</reminder>` }] };
    },
    onStepFinish: hooks.onStepFinish,
  });
}

/**
 * Custom stop condition: stop once the OUTPUT-token budget is spent.
 * Output tokens are the budget currency — counting totalTokens would re-bill
 * the whole conversation every step and starve compose.
 */
export function overBudget(maxTokens: number): StopCondition<ToolSet> {
  return ({ steps }) => steps.reduce((n, s) => n + (s.usage?.outputTokens ?? 0), 0) > maxTokens;
}

/** Wall-clock stop — checked between steps, so an in-flight write finishes. */
export function overDeadline(maxMs: number, startedAt: number): StopCondition<ToolSet> {
  return () => Date.now() - startedAt > maxMs;
}

export async function runAgentLoop(config: LoopConfig): Promise<LoopResult> {
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    config.onEvent?.(e);
  };

  const t0 = Date.now();
  let steps = 0;
  let tokens = 0;
  let inputTokens = 0;
  let peakInput = 0;

  const agent = createLoopAgent(
    config,
    {
      onEvent: emit,
      onStepFinish: (step) => {
        steps++;
        tokens += step.usage?.outputTokens ?? 0;
        inputTokens += step.usage?.inputTokens ?? 0;
        peakInput = Math.max(peakInput, step.usage?.inputTokens ?? 0);
        // Thinking models stream reasoning separately from the final text.
        if (step.reasoningText?.trim()) emit({ type: "thought", text: step.reasoningText });
        if (step.text) emit({ type: "thought", text: step.text });
        // Pure passthrough after the loop's own accounting — never mutates.
        config.onStepFinish?.(step);
      },
    },
    { abortSignal: config.abortSignal },
  );

  const result = await agent.generate({ prompt: config.prompt, abortSignal: config.abortSignal });

  const finishReason = result.finishReason ?? "other";
  const text = result.text ?? "";
  const wallMs = Date.now() - t0;
  emit({ type: "log", text: `wall: ${(wallMs / 1000).toFixed(1)}s · ${steps} steps` });
  const clockOut = !!config.budget.maxMs && config.budget.maxMs > 0 && wallMs > config.budget.maxMs;
  const exhausted =
    steps >= config.budget.maxSteps ||
    tokens >= config.budget.maxTokens ||
    finishReason === "length" ||
    clockOut;
  const status: LoopResult["status"] =
    finishReason === "stop" && !exhausted ? "completed" : exhausted ? "budget_exhausted" : "failed";

  return { status, text, steps, tokens, inputTokens, peakInput, trace };
}

/**
 * Serve a loop agent over the UI message stream (SSE) — the same agent the
 * canvas pipeline runs, for interactive sessions:
 *
 *   const agent = createLoopAgent({ model, system, tools, ctx, budget });
 *   return serveAgentUIStream(agent, uiMessages, { abortSignal });
 */
export function serveAgentUIStream(
  agent: ToolLoopAgent<never, ToolSet>,
  uiMessages: unknown[],
  init: Record<string, unknown> = {},
): Promise<Response> {
  return createAgentUIStreamResponse({ agent, uiMessages, ...init } as Parameters<typeof createAgentUIStreamResponse>[0]);
}
