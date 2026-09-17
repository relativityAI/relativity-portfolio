import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { aggregateWeightedScores } from "./scoring.js";
import { config } from "./config.js";
import { buildTools, getToolCatalog, ToolContext } from "./tools.js";
import type { DataAdequacy } from "./quant.js";
import { log } from "./logger.js";
import { runAgentTurn, type HarnessOptions } from "./harness.js";
import { keyPool } from "./keypool.js";
import {
  QUALITATIVE_SCORING_SYSTEM_PROMPT,
  QUALITATIVE_VERDICT_SYSTEM_PROMPT,
  buildScoreRecoveryPrompt,
  buildDraftParametersPrompt,
  buildVerdictRecoveryPrompt,
} from "./prompts.js";

// Per-parameter wall-clock budget for the LLM tool loop.
const PARAM_TIMEOUT_MS = 180_000;
// Qualitative parameters scored in parallel.
const QUAL_CONCURRENCY = 3;

export interface LlmKeys {
  openai?: string;
  gemini?: string;
  anthropic?: string;
  cerebras?: string;
  groq?: string;
  openrouter?: string;
  tavily?: string;
}

function providerFor(modelId: string): string {
  return modelId.split("/")[0];
}

function modelNameFor(modelId: string): string {
  return modelId.slice(modelId.indexOf("/") + 1);
}

// Legacy single-key env fallbacks (superseded by the key pool, kept safe).
const LEGACY_ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  cerebras: process.env.CEREBRAS_API_KEY,
  groq: process.env.GROQ_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};

export function buildModel(modelId: string, keys: LlmKeys, apiKey?: string) {
  const provider = providerFor(modelId);
  const name = modelNameFor(modelId);
  const key = apiKey || keys[provider as keyof LlmKeys] || LEGACY_ENV_KEYS[provider];
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: key })(name);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: key })(name);
    case "anthropic":
      return createAnthropic({ apiKey: key })(name);
    case "cerebras":
      return createOpenAICompatible({
        name: "cerebras",
        apiKey: key,
        baseURL: "https://api.cerebras.ai/v1",
      })(name);
    case "groq":
      return createOpenAICompatible({
        name: "groq",
        apiKey: key,
        baseURL: "https://api.groq.com/openai/v1",
      })(name);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        apiKey: key,
        baseURL: "https://openrouter.ai/api/v1",
      })(name);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: config.ollamaUrl,
      })(name);
    default:
      throw new Error(`Unknown model provider: ${provider}`);
  }
}

// System prompt imported from prompts.ts

export interface QualResult {
  score: number;
  analysis: string;
  toolCalls: Record<string, unknown>[];
  error?: string;
  /** Thrown provider/network errors are worth one retry; parse failures are not. */
  retryable?: boolean;
  tokens?: { input?: number; output?: number };
}

/** Emitted live while a qualitative parameter is being scored. */
export type TraceCallback = (event: {
  type: "thought" | "tool_call" | "tool_result" | "decision";
  text?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  status?: string;
  duration_ms?: number;
  score?: number;
}) => void;

// Last-resort score recovery: ask the model to restate just the integer.
async function recoverScore(
  model: LanguageModel,
  analysis: string,
): Promise<{ score: number; found: boolean }> {
  try {
    const res = await generateText({
      model,
      prompt: buildScoreRecoveryPrompt(analysis),
      temperature: 0,
      maxOutputTokens: 8,
    });
    const m = (res.text || "").match(/\d{1,3}/);
    if (!m) return { score: 0, found: false };
    return { score: Math.max(0, Math.min(100, Number(m[0]))), found: true };
  } catch {
    return { score: 0, found: false };
  }
}

const RECOVERY_RETRIES = 2;
const RECOVERY_RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Compact log of what the research tools actually returned. Recovery verdicts
// are fresh completions with NO tool context, so without this they end up
// thin — or blank — and the concrete findings from the tool loop are lost.
export function summarizeToolEvidence(steps: any[], maxChars = 12000): string {
  const lines: string[] = [];
  const size = () => lines.join("\n").length;
  for (const step of steps || []) {
    for (const tc of step?.toolCalls || []) {
      const res = (step?.toolResults || []).find((tr: any) => tr.toolCallId === tc.toolCallId)?.output;
      let resultText = "";
      try {
        const s = typeof res === "string" ? res : JSON.stringify(res);
        resultText = (s || "").length > 800 ? s.slice(0, 800) + "…" : s || "";
      } catch {
        resultText = "";
      }
      let argsText = "";
      try {
        const s = JSON.stringify(tc.input ?? {}) || "";
        argsText = s.length > 200 ? s.slice(0, 200) + "…" : s;
      } catch {
        argsText = "";
      }
      lines.push(`Tool call: ${tc.toolName}\n  args: ${argsText}\n  result: ${resultText}`);
      if (size() >= maxChars) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

// No-tools verdict pass used when the tool loop ended without a FINAL_SCORE
// line. Retried a couple times with a short wait for empty/no-output replies.
async function verdictRecovery(
  model: LanguageModel,
  parameter: { parameter: string; content?: string; section?: string },
  researchText: string,
  context = "",
): Promise<{ text: string; score: number; found: boolean }> {
  const prompt = buildVerdictRecoveryPrompt(parameter, researchText, context);
  for (let attempt = 0; attempt < RECOVERY_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RECOVERY_RETRY_DELAY_MS);
    try {
      const turn = await runAgentTurn({
        model,
        system: QUALITATIVE_VERDICT_SYSTEM_PROMPT,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 4096,
        maxToolSteps: 1,
        abortSignal: AbortSignal.timeout(60_000),
      });
      const text = turn.text || "";
      if (text.trim()) {
        const { score, found } = parseFinalScoreResult(text);
        return { text, score, found };
      }
      log.warn("[agent]", "verdict recovery returned no output; retrying");
    } catch (e: any) {
      log.warn("[agent]", "verdict recovery failed:", String(e?.message || e));
    }
  }
  return { text: "", score: 0, found: false };
}

// One context line from the agent's Configuration section (horizon + risk).
export function investorProfileLine(configuration: any): string {
  const h = configuration?.investment_horizon;
  const r = configuration?.risk_appetite;
  if (!h && !r) return "";
  const parts = [
    h ? `Investment horizon: ${h}.` : "",
    r ? `Risk appetite: ${r}.` : "",
  ].filter(Boolean);
  return `Investor profile — ${parts.join(" ")}`;
}

// Draft qualitative parameters from an investor's persona text.
export async function draftParameters(
  modelId: string,
  keys: LlmKeys,
  persona: string,
  section: "asset_evaluation" | "macro_evaluation",
  count: number,
): Promise<{ parameter: string; content: string; weightage: number }[]> {
  const { apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>);
  const model = buildModel(modelId, keys, apiKey);
  const scope =
    section === "macro_evaluation"
      ? "market-level / macro qualitative factors a stock picker should monitor"
      : "company-level qualitative parameters for judging individual stocks";
  const result = await generateText({
    model,
    prompt: buildDraftParametersPrompt(persona, count, scope, getToolCatalog()),
    temperature: 0.4,
    maxOutputTokens: 1500,
  });
  keyPool.recordUsage({
    provider: providerFor(modelId),
    keyRef,
    modelId,
    requests: 1,
    tokensIn: result.usage?.inputTokens,
    tokensOut: result.usage?.outputTokens,
  });
  const text = (result.text || "").replace(/```(?:json)?|```/g, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Draft response was not a JSON array");
  let arr: any[];
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Could not parse drafted parameters");
  }
  return (Array.isArray(arr) ? arr : [])
    .filter((p) => p && typeof p.parameter === "string" && p.parameter.trim())
    .slice(0, count)
    .map((p) => ({
      parameter: String(p.parameter).trim(),
      content: String(p.content ?? "").trim(),
      weightage: Number.isFinite(Number(p.weightage)) ? Math.min(Math.max(Math.round(Number(p.weightage)), 1), 10) : 5,
    }));
}

export async function runQualitative(
  modelId: string,
  keys: LlmKeys,
  toolCtx: ToolContext,
  parameter: { parameter: string; content?: string; weightage?: number; section?: string },
  documents: string[],
  webSearch: boolean,
  adequacy: DataAdequacy,
  investorContext = "",
  onTrace?: TraceCallback,
): Promise<QualResult> {
  const started = Date.now();
  const provider = providerFor(modelId);
  let apiKey = "";
  let keyRef = "none";
  try {
    ({ apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>));
    const model = buildModel(modelId, keys, apiKey);
    const tools = buildTools(toolCtx);

    const isMacro = parameter.section === "macro_evaluation";
    const contextLines = [
      ...(isMacro
        ? [
            `Market: ${toolCtx.source.toUpperCase()} (${toolCtx.country}).`,
            "",
            "This is a MACRO / market-level evaluation. Judge the state of the broader market that the analyzed company trades in — market direction, index levels, breadth, leadership, and macro conditions — not the company itself. Use web search and market data tools for recent market context.",
          ]
        : [
            `Company: ${toolCtx.shareName || toolCtx.symbol} (${toolCtx.symbol}) on ${toolCtx.source.toUpperCase()} (${toolCtx.country}).`,
          ]),
      ...(investorContext ? [``, investorContext] : []),
    ];

    const userPrompt = [
      ...contextLines,
      ``,
      isMacro
        ? `The subject of this analysis is the ${toolCtx.source.toUpperCase()} market (${toolCtx.country}) — every criterion below refers to that market, not to a specific company.`
        : `The subject of this analysis is the company ${toolCtx.shareName || toolCtx.symbol} (${toolCtx.symbol}) on ${toolCtx.source.toUpperCase()} (${toolCtx.country}). Every criterion below refers to THIS company and no other.`,
      `Qualitative parameter: ${parameter.parameter}`,
      parameter.content ? `Guidelines for this parameter:\n${parameter.content}` : "",
      ``,
      `Instructions for this parameter:
- Work through your checklist for "${parameter.parameter}" one item at a time.
- Call tools to verify claims with real data.
- Internal data availability: ${adequacy}. ${
        adequacy === "adequate"
          ? "Internal data should cover most criteria."
          : "Internal data may be incomplete — expect empty tool results."
      }
- If an internal tool returns empty or no-data results, mark that criterion Insufficient Data unless web search is enabled and can supply evidence instead.`,
      documents?.length ? `Relevant documents available on the exchange: ${documents.join(", ")}` : "",
      webSearch ? "Web search is enabled." : "Web search is disabled.",
      toolCtx.webSources?.length ? `Preferred web sources: ${toolCtx.webSources.join(", ")}` : "",
      ``,
      `End with the FINAL_SCORE line.`,
    ]
      .filter(Boolean)
      .join("\n");

    const onEvent: HarnessOptions["onEvent"] = (ev) => {
      switch (ev.type) {
        case "thought":
          onTrace?.({ type: "thought", text: ev.text });
          break;
        case "tool_call":
          onTrace?.({ type: "tool_call", tool: ev.tool, args: ev.args });
          break;
        case "tool_result":
          onTrace?.({
            type: "tool_result",
            tool: ev.tool,
            result: ev.result,
            status: ev.status,
            duration_ms: ev.duration_ms,
          });
          break;
      }
    };

    const turn = await runAgentTurn({
      model,
      system: QUALITATIVE_SCORING_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.1,
      maxOutputTokens: 8192,
      tools,
      forceTools: true,
      maxToolSteps: config.maxToolSteps,
      abortSignal: AbortSignal.timeout(PARAM_TIMEOUT_MS),
      onEvent,
    });

    // Tally the attempt for admin stats; put the key in cooldown on provider errors
    // so the retry in runQualitativeAll lands on a different, healthy key.
    if (turn.retryable) keyPool.markFailure(provider, keyRef);
    keyPool.recordUsage({
      provider,
      keyRef,
      modelId,
      requests: 1,
      tokensIn: turn.usage?.input,
      tokensOut: turn.usage?.output,
    });

    if (turn.error) {
      log.warn("[agent]", `${modelId} "${parameter.parameter}" harness error (will attempt verdict recovery):`, turn.error);
    }

    const text = (turn.text || "").trim();
    let analysis = text;
    const toolEvidence = summarizeToolEvidence(turn.steps);
    const research = [text, toolEvidence].filter(Boolean).join("\n\n");
    let { score, found } = parseFinalScoreResult(text);
    if (!found && text) {
      ({ score, found } = await recoverScore(model, text));
    }

    // The tool loop can end (step cap, empty stream, forced-tool refusal, or a
    // provider error) before the model writes its closing FINAL_SCORE verdict.
    // Recover with a fresh NO-TOOLS pass — it must never depend on the flaky
    // tools-enabled request, so it succeeds even when the main turn errored.
    // Company/market context is re-sent so the verdict can never claim the
    // subject is unknown, and tool results are included so it reflects reality.
    if (!found) {
      const verdict = await verdictRecovery(
        model,
        parameter,
        research,
        [...contextLines, investorContext].filter(Boolean).join("\n\n"),
      );
      if (verdict.text.trim() && verdict.text.trim() !== text) {
        analysis = [text, verdict.text.trim()].filter(Boolean).join("\n\n");
      }
      if (verdict.found) {
        score = verdict.score;
        found = true;
      } else if (verdict.text.trim()) {
        const recovered = await recoverScore(model, verdict.text);
        if (recovered.found) {
          score = recovered.score;
          found = true;
        }
      }
    }

    // Never hand back a blank result: surface the tool evidence (or a note) so
    // the user always has something to see even when every recovery failed.
    if (!analysis) {
      analysis = toolEvidence
        ? `The model finished without writing a verdict for this parameter. Research gathered by the tools:\n\n${toolEvidence}`
        : "No model output was produced for this parameter — neither text nor tool results.";
    }

    onTrace?.({ type: "decision", score: found ? score : undefined, text: found ? undefined : "FINAL_SCORE not found" });
    const calls = turn.toolCalls;

    const steps = turn.steps || [];
    const lastStep = steps[steps.length - 1] as any;
    const maxTurnsReached =
      steps.length >= config.maxToolSteps && !!lastStep && lastStep.finishReason === "tool-calls";

    let error: string | undefined;
    if (!found) {
      error = turn.error
        ? turn.userMessage || turn.error
        : maxTurnsReached
          ? "Max tool-call turns reached"
          : "FINAL_SCORE not found";
    }

    log.info(
      "[agent]",
      `${modelId} "${parameter.parameter}" -> score=${score} toolCalls=${calls.length} steps=${steps.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return {
      score: error ? 0 : score,
      analysis,
      toolCalls: calls,
      error,
      retryable: !!error && !!turn.error && turn.retryable === true,
      tokens: turn.usage,
    };
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError" || /abort/i.test(String(e?.name));
    log.error("[agent]", `${modelId} "${parameter.parameter}" failed:`, e?.message || e);
    if (!timedOut) keyPool.markFailure(provider, keyRef);
    return {
      score: 0,
      analysis: `The analysis for this parameter was interrupted by an error: ${String(e?.message || e)}`,
      toolCalls: [],
      error: String(e?.message || e),
      retryable: !timedOut,
    };
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed > 90_000) {
      log.warn(`[agent] ${modelId} took ${(elapsed / 1000).toFixed(1)}s`);
    }
  }
}

export function parseFinalScoreResult(text: string): { score: number; found: boolean } {
  const m =
    text.match(/FINAL_SCORE\s*[:：=]\s*\**\s*(\d{1,3})\s*\**/i) ||
    text.match(/FINAL[\s_-]*SCORE[^\d\n]{0,20}(\d{1,3})/i);
  if (!m) return { score: 50, found: false };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { score: 50, found: false };
  return { score: Math.max(0, Math.min(100, n)), found: true };
}

export function parseFinalScore(text: string): number {
  return parseFinalScoreResult(text).score;
}

export interface QualParamEntry {
  score: number;
  weightage: number;
  analysis: string;
  error?: string;
  section?: string;
  tokens?: { input?: number; output?: number };
}

// Run async work over items with at most `limit` in flight, preserving order.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runQualitativeAll(
  modelId: string,
  keys: LlmKeys,
  toolCtx: ToolContext,
  agent: any,
  documents: string[],
  webSearch: boolean,
  adequacy: DataAdequacy,
  onProgress?: (done: number, total: number, label: string) => void,
  onTrace?: (key: string, event: Parameters<TraceCallback>[0]) => void,
): Promise<{
  qualitative_analysis: Record<string, QualParamEntry>;
  qualitative_tool_calls: Record<string, Record<string, unknown>[]>;
  qualitative_score: number;
}> {
  const params = [
    ...(agent?.asset_evaluation?.qualitative || []).map((p: any) => ({
      ...p,
      section: "asset_evaluation",
    })),
    ...(agent?.macro_evaluation?.qualitative || []).map((p: any) => ({
      ...p,
      section: "macro_evaluation",
    })),
  ];

  const qualitative_analysis: Record<string, QualParamEntry> = {};
  const qualitative_tool_calls: Record<string, Record<string, unknown>[]> = {};

  const total = params.length;
  let done = 0;
  const investorContext = investorProfileLine(agent?.configuration);

  await mapWithConcurrency(params, QUAL_CONCURRENCY, async (p) => {
    const label = p.parameter || "Qualitative Parameter";
    const trace = (ev: Parameters<TraceCallback>[0]) => onTrace?.(label, ev);
    let res = await runQualitative(
      modelId,
      keys,
      toolCtx,
      { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
      documents,
      webSearch,
      adequacy,
      investorContext,
      trace,
    );
    if (res.error && res.retryable) {
      log.warn("[agent]", `${modelId} "${label}" retrying once after: ${res.error}`);
      res = await runQualitative(
        modelId,
        keys,
        toolCtx,
        { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
        documents,
        webSearch,
        adequacy,
        investorContext,
        trace,
      );
    }
    qualitative_analysis[label] = {
      score: res.score,
      weightage: typeof p.weightage === "number" ? p.weightage : 5,
      analysis: res.analysis,
      error: res.error,
      section: p.section,
      tokens: res.tokens,
    };
    qualitative_tool_calls[label] = res.toolCalls;
    done += 1;
    onProgress?.(done, total, label);
  });

  const entries = Object.values(qualitative_analysis);
  const { score: qualitative_score } = aggregateWeightedScores(entries, {
    includeMissingAsZero: false,
  });

  return { qualitative_analysis, qualitative_tool_calls, qualitative_score };
}
