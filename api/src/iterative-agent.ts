/**
 * Standalone iterative analysis agent.
 *
 * A thin wrapper over `runAgentTurn` that keeps re-invoking the agent until it
 * signals the instruction is complete (`[[DONE]]`) or a turn budget is hit.
 * `runAgentTurn` already loops over TOOL calls within one turn; this loops over
 * whole TURNS so the model can plan, act, review its own progress, and continue
 * across as many turns as the instruction needs (YAGNI: no planner/executor split,
 * the model self-manages via the progress transcript).
 *
 * Not wired into the pipeline — call it directly (see `api/test` for usage).
 */
import type { LanguageModel } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { keyPool } from "./keypool.js";
import { buildTools, type ToolContext } from "./tools.js";
import { VoyagerClient, toCountrySource } from "./voyager.js";
import { runAgentTurn, type HarnessTraceEvent } from "./harness.js";
import { config } from "./config.js";

/** Emitted by the agent (on its own line) when the instruction is complete. */
export const DONE_MARKER = "[[DONE]]";

export const DEFAULT_ITERATIVE_MODEL = "gemini/gemini-3.5-flash-lite";

export interface IterativeAgentOptions {
  /** What the agent must accomplish. */
  instruction: string;
  /** Company the tools are bound to (e.g. "RELIANCE"). */
  symbol: string;
  /** Model id used to pick a key + build the model. Ignored when `model` is set. */
  modelId?: string;
  /** Pre-built model (tests inject a mock; skips key picking). */
  model?: LanguageModel;
  /** Server key map for the model. Defaults to an empty map (server pool). */
  keys?: LlmKeys;
  /** Override the tool set (defaults to the analyst tools for `symbol`). */
  tools?: Record<string, unknown>;
  /** Override the system prompt (e.g. swap per task). Defaults to DEFAULT_SYSTEM. */
  system?: string;
  /** Market source for country/source binding. Default "NSE". */
  source?: string;
  /** Max outer turns before giving up. Default 6. */
  maxIterations?: number;
  /** Per-turn wall-clock budget, ms. */
  deadlineMs?: number;
  onEvent?: (event: HarnessTraceEvent) => void;
  /** Called after each outer turn with the prompt sent, output, and tools used. */
  onTurn?: (turn: { iteration: number; prompt: string; text: string; toolCalls: Record<string, unknown>[]; error?: string }) => void;
  /**
   * Independent completion gate, run when the agent emits `[[DONE]]`. The marker
   * alone is only a control signal — this decides whether the result actually
   * satisfies the task. Return `true` to accept, or a string describing the gap
   * to reject: the reason is fed back to the agent on the next turn. Omit to
   * trust the marker (legacy behaviour — you get exactly what the model says).
   */
  isComplete?: (result: { text: string; toolCalls: Record<string, unknown>[]; iterations: number }) => true | string;
}

export interface IterativeAgentResult {
  /** Accumulated text across all turns. */
  text: string;
  /** Number of outer turns that ran. */
  iterations: number;
  /** Every tool call the agent made (all turns). */
  toolCalls: Record<string, unknown>[];
  /** DONE only when a completion gate accepted (or no gate was given) and the marker was seen. */
  status: "DONE" | "PARTIAL" | "FAILED";
  /** Set when a turn failed (FAILED) or the criteria/budget were not met (PARTIAL). */
  error?: string;
}

/** Built-in system prompt; replace it by passing `opts.system`, or compose off it. */
export const DEFAULT_SYSTEM = [
  "You are an iterative analysis agent. You are bound to ONE company via your tools — the company symbol is handled for you, never pass a symbol for a different company.",
  "Work in turns. Each turn: think, call the tools you need, then write a concise progress note.",
  `When (and only when) the instruction is fully satisfied, write the final answer, then a line containing exactly ${DONE_MARKER}.`,
  "For charts later: ALWAYS call get_price_history with include_series=true (NOT default) so real price/SMA/RSI series are captured for plotting.",
  "If a document tool returns empty or unusable data, fall back to get_financial_metrics and get_price_history — never report numbers you did not get from a tool result.",
].join("\n");

export async function runIterativeAgent(opts: IterativeAgentOptions): Promise<IterativeAgentResult> {
  const modelId = opts.modelId ?? DEFAULT_ITERATIVE_MODEL;
  const maxIterations = opts.maxIterations ?? 6;

  const keys = opts.keys ?? {};
  const model = opts.model ?? buildModel(modelId, keys, keyPool.pickKey(modelId, keys as Record<string, string | undefined>).apiKey);

  // Symbol is closure-bound into every tool, so a "search for a company" tool is
  // worse than useless here — it invites the cross-company calls we saw. Drop it.
  const tools =
    opts.tools ??
    Object.fromEntries(
      Object.entries(buildTools(analysisContext(opts.symbol, opts.source), { analyst: true })).filter(
        ([name]) => name !== "search_symbol",
      ),
    );
  const system = opts.system ?? DEFAULT_SYSTEM;

  let text = "";
  let finalAnswer = "";
  const toolCalls: Record<string, unknown>[] = [];
  let iterations = 0;
  let error: string | undefined;
  let status: IterativeAgentResult["status"] = "PARTIAL";
  let rejectReason: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const prompt =
      i === 0
        ? `${opts.instruction}\n\nBegin.`
        : [
            "Progress so far:",
            text.trim() || "(no output yet)",
            ...(rejectReason
              ? ["", `Your previous answer was REJECTED: ${rejectReason}`, "Fix that gap before finishing."]
              : []),
            "",
            `Continue the instruction. If it is now fully satisfied, give the final answer then a line with exactly ${DONE_MARKER}; otherwise continue working.`,
          ].join("\n");

    const turn = await runAgentTurn({
      model,
      system,
      prompt,
      tools,
      forceTools: true,
      deadlineMs: opts.deadlineMs,
      onEvent: opts.onEvent,
    });

    toolCalls.push(...turn.toolCalls);
    if (turn.text) {
      text += (text ? "\n\n" : "") + turn.text;
      // The final answer is the last turn's text — earlier turns are progress
      // notes. Without a format step to distill, keep only the final answer.
      if (turn.text.includes(DONE_MARKER)) finalAnswer = turn.text;
    }

    opts.onTurn?.({ iteration: i + 1, prompt, text: turn.text, toolCalls: turn.toolCalls, error: turn.error });

    if (turn.error) {
      error = turn.streamError || turn.error;
      status = "FAILED";
      break;
    }
    if (turn.text.includes(DONE_MARKER)) {
      // The marker is a control signal, not proof. With a gate, the model only
      // gets to stop if the gate agrees; otherwise we tell it what's missing.
      if (!opts.isComplete) {
        status = "DONE";
        break;
      }
      const verdict = opts.isComplete({ text, toolCalls, iterations });
      if (verdict === true) {
        status = "DONE";
        break;
      }
      rejectReason = verdict;
    }
  }

  if (status !== "DONE" && status !== "FAILED") {
    error = rejectReason
      ? `Agent did not satisfy the completion criteria within ${maxIterations} iteration(s): ${rejectReason}`
      : `Agent did not complete within ${maxIterations} iteration(s).`;
  }

  // No format step distils the answer — keep only the final turn's text and
  // strip the control marker. Earlier turns are progress notes.
  if (status === "DONE" && finalAnswer) {
    text = finalAnswer.split(DONE_MARKER)[0].trim();
  }

  return { text, iterations, toolCalls, status, error };
}

/**
 * Freeze a run's tool calls into the layout manifest: the price profile plus
 * every measured dataset/metric group the agent actually pulled. Same
 * normalizers as the skill layout path — no new analysis code.
 */

function analysisContext(symbol: string, source = "NSE"): ToolContext {
  const market = toCountrySource(source);
  return {
    // Standalone path has no per-user key, so use the shared data:read key. The
    // admin key is only valid on /admin/* and 401s every data route.
    // ponytail: one shared key; thread a per-user key here if debug runs ever
    // need isolation (the HTTP path already does this via `voyagerKey`).
    voyager: new VoyagerClient(config.voyagerUrl, config.voyagerApiKey, config.voyagerRpm),
    symbol,
    country: market.country,
    source: market.source,
    shareName: symbol,
  };
}
