import { generateText, generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { aggregateWeightedScores, scoreChecklist } from "./scoring.js";
import { config } from "./config.js";
import { buildTools, getToolCatalog, ToolContext } from "./tools.js";
import type { DataAdequacy } from "./quant.js";
import { log } from "./logger.js";
import { runAgentTurn, type HarnessOptions } from "./harness.js";
import { keyPool } from "./keypool.js";
import {
  QUALITATIVE_SCORING_SYSTEM_PROMPT,
  QUALITATIVE_VERDICT_SYSTEM_PROMPT,
  ANALYSIS_PLAN_SYSTEM_PROMPT,
  buildAnalysisPlanPrompt,
  buildScoreRecoveryPrompt,
  buildDraftParametersPrompt,
  buildVerdictRecoveryPrompt,
  REPORT_SYNTHESIS_SYSTEM_PROMPT,
  buildReportSynthesisPrompt,
  UNSCORED_LABEL,
  type ScoreTable,
  type ScoreTableRow,
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
  /** 0..100, or null when the parameter could not be scored (unknown ≠ 0). */
  score: number | null;
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

// Compile the FULL investor persona for research prompts (plan B1 / 1.2):
// the analysts must score against the investor's actual profile, not just a
// one-line horizon summary. Dealbreakers, screening rules and ideal-company
// description all reach the prompt here.
export function investorProfileLine(configuration: any, persona?: any): string {
  const parts: string[] = [];
  const h = configuration?.investment_horizon;
  const r = configuration?.risk_appetite;
  if (h) parts.push(`Investment horizon: ${h}.`);
  if (r) parts.push(`Risk appetite: ${typeof r === "number" ? `${r}/10` : r}.`);
  const phil = persona?.philosophy_and_mindset;
  if (phil?.trim()) parts.push(`Philosophy & mindset: ${String(phil).trim().slice(0, 2000)}`);
  if (!parts.length) return "";
  return `Investor profile — score every criterion against THIS profile:
${parts.join("\n")}`;
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
  /** Full investor profile context — horizon, risk, philosophy, dealbreakers (plan B1). */
  investorContext = "",
  onTrace?: TraceCallback,
  plan?: AnalysisPlan,
): Promise<QualResult> {
  const started = Date.now();
  const provider = providerFor(modelId);
  let apiKey = "";
  let keyRef = "none";
  try {
    ({ apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>));
    const model = buildModel(modelId, keys, apiKey);
    // Analyst toolset (plan 0.5 / C2): read-only, symbol-bound, no pull tools.
    const tools = buildTools({ ...toolCtx, macro: parameter.section === "macro_evaluation" }, { analyst: true });

    const isMacro = parameter.section === "macro_evaluation";
    const planEntry = plan?.params?.find((p) => p.parameter === parameter.parameter);
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
      planEntry?.tactic ? `Planned approach for this run: ${planEntry.tactic}` : "",
      planEntry?.tools?.length ? `Tools this run planned to lean on: ${planEntry.tools.join(", ")} — prefer these when they fit.` : "",
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
      score: error ? null : score,
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
      score: null,
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

// ============================================================================
// 2. Analysis planning
// One cheap pre-scoring turn decides how each parameter should be researched
// and which figures/plots the final report should carry — the agent's plan,
// not a hardcoded template.
// ============================================================================

export const AnalysisPlanSchema = z.object({
  params: z.array(
    z.object({
      parameter: z.string(),
      tactic: z.string(),
      tools: z.array(z.string()),
    }),
  ),
  report: z.object({
    charts: z.array(
      z.object({ type: z.enum(["bar", "line", "radar", "area", "scatter", "pie"]), title: z.string(), subjects: z.array(z.string()) }),
    ),
    tables: z.array(z.object({ title: z.string(), subjects: z.array(z.string()) })),
    sections: z.array(z.string()),
  }),
});

export type AnalysisPlan = z.infer<typeof AnalysisPlanSchema>;
export const EMPTY_PLAN: AnalysisPlan = {
  params: [],
  report: { charts: [], tables: [], sections: ["Executive Summary", "Quantitative Scorecard", "Qualitative Assessment", "Aggregate Scores"] },
};

export function planAnalyze(input: {
  modelId: string;
  llmKeys: LlmKeys;
  persona: string;
  agentDisplayName?: string;
  quant: { key: string; metric_name: string; value: unknown; threshold: unknown; operator: string; score: number }[];
  qual: { parameter: string; content?: string; section?: string }[];
  adequacy: string;
  webSearch: boolean;
  tools: { name: string; description: string }[];
  subject: string;
}): Promise<AnalysisPlan> {
  const { apiKey, keyRef } = keyPool.pickKey(input.modelId, input.llmKeys as Record<string, string | undefined>);
  const model = buildModel(input.modelId, input.llmKeys, apiKey);
  const provider = providerFor(input.modelId);
  return (async () => {
    try {
      const res = await generateObject({
        model,
        schema: AnalysisPlanSchema,
        system: ANALYSIS_PLAN_SYSTEM_PROMPT,
        prompt: buildAnalysisPlanPrompt(input),
        temperature: 0.2,
        maxOutputTokens: 2048,
      });
      keyPool.recordUsage({ provider, keyRef, modelId: input.modelId, requests: 1, tokensIn: res.usage?.inputTokens, tokensOut: res.usage?.outputTokens });
      return res.object;
    } catch (e: any) {
      log.warn("[agent]", "analysis planning failed — using default plan:", e?.message || e);
      return EMPTY_PLAN;
    }
  })();
}

export interface QualParamEntry {
  /** 0..100, or null when unscored (errored / zero-tool). */
  score: number | null;
  weightage: number;
  analysis: string;
  error?: string;
  /** Present when score is null: why the parameter is unscored. */
  unscored_reason?: "insufficient_data";
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
  plan?: AnalysisPlan,
): Promise<{
  qualitative_analysis: Record<string, QualParamEntry>;
  qualitative_tool_calls: Record<string, Record<string, unknown>[]>;
  qualitative_score: number | null;
  fit_low: number;
  fit_high: number;
  coverage: number;
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
  // Full persona reaches every analyst (plan B1): philosophy, horizon, risk —
  // not just the one-line configuration summary.
  const investorContext = investorProfileLine(agent?.configuration, agent?.persona);

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
      plan,
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
        plan,
      );
    }
    // Zero-tool completions are UNSCORED, not 0 and not a memory-based guess
    // (plan A11): without tool evidence the analyst has nothing to audit.
    const zeroTool = (res.toolCalls || []).length === 0;
    qualitative_analysis[label] = {
      score: zeroTool ? null : res.score,
      weightage: typeof p.weightage === "number" ? p.weightage : 5,
      analysis: res.analysis,
      error: res.error ?? (zeroTool ? "No tool evidence gathered — parameter unscored" : undefined),
      unscored_reason: zeroTool ? "insufficient_data" : undefined,
      section: p.section,
      tokens: res.tokens,
    };
    qualitative_tool_calls[label] = res.toolCalls;
    done += 1;
    onProgress?.(done, total, label);
  });

  // Honest aggregation (plan 0.3): unknown ≠ 0. Errored/zero-tool params are
  // unscored — they reduce coverage and widen the band; they never count as 0
  // (the old asymmetry vs. quant) nor get excluded silently in both directions.
  const entries = Object.values(qualitative_analysis);
  const agg = aggregateWeightedScores(entries);

  return {
    qualitative_analysis,
    qualitative_tool_calls,
    qualitative_score: agg.score,
    fit_low: agg.fit_low,
    fit_high: agg.fit_high,
    coverage: agg.coverage,
  };
}

// ============================================================================
// 3. Report Synthesis
// ============================================================================

export const ReportBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: z.string() }),
  z.object({ type: z.literal("paragraph"), text: z.string(), citedKeys: z.array(z.string()).optional() }),
  z.object({ type: z.literal("table"), title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("chart"), chartType: z.enum(["bar", "line", "radar", "area", "scatter", "pie"]), title: z.string().optional(), data: z.array(z.record(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["positive", "caution", "negative", "neutral"]), text: z.string() }),
  z.object({ type: z.literal("quote"), text: z.string(), attribution: z.string().optional() }),
]);

export type ReportBlock = z.infer<typeof ReportBlockSchema>;

export const AnalysisReportSchema = z.object({
  heroPct: z.number(),
  heroLabel: z.string(),
  blocks: z.array(ReportBlockSchema),
  partial: z.boolean(),
  /** "llm" = narrative synthesized by the model, "fallback" = deterministic assembly from scored data. */
  source: z.enum(["llm", "fallback"]).default("llm"),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

export function normalizeQuantScale(quantAnalysis: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, val] of Object.entries(quantAnalysis || {})) {
    normalized[key] = {
      ...val,
      // Scores are stored on the explicit 0..100 scale (plan A1); preserve null
      // (unscored) instead of collapsing it to 0.
      score_0_100: val.score == null ? null : Math.round(val.score * 100) / 100,
    };
  }
  return normalized;
}

export function parseQualStructure(qualAnalysis: Record<string, any>): Record<string, any> {
  const parsed: Record<string, any> = {};

  // Verdict tokens the scoring prompt can emit (order matters: longest first to avoid partial match)
  const VERDICT_TOKENS = ["INSUFFICIENT DATA", "PARTIAL", "YES", "NO"] as const;
  // Matches a verdict at/near end of line, optionally wrapped in markdown bold (**VERDICT**)
  const VERDICT_PATTERN = /\*{0,2}(INSUFFICIENT DATA|PARTIAL|YES|NO)\*{0,2}\s*$/i;

  for (const [key, val] of Object.entries(qualAnalysis || {})) {
    const rawAnalysis: string = val.analysis || "";

    // ── Section extraction ────────────────────────────────────────────────────
    // The scoring prompt enforces a fixed section order:
    //   SCORE JUSTIFICATION → CHECKLIST → RISKS → CONCLUSION → FINAL_SCORE
    // We split on those headers so we can pass clean structured data to synthesis.
    const checklistMatch = rawAnalysis.match(/CHECKLIST[\s\S]*?(?=RISKS|CONCLUSION|FINAL_SCORE)/i);
    const risksMatch     = rawAnalysis.match(/RISKS[\s\S]*?(?=CONCLUSION|FINAL_SCORE)/i);

    const checklistText = checklistMatch ? checklistMatch[0] : "";
    const risksText     = risksMatch
      ? risksMatch[0].replace(/^RISKS[:\s]*/i, "").trim()
      : "";

    // ── Checklist line parser ─────────────────────────────────────────────────
    // The prompt produces lines like:
    //   - Criterion description: YES
    //   - Another criterion — PARTIAL
    //   - Missing evidence criterion: INSUFFICIENT DATA
    // We require the verdict token to appear at/near the END of the line,
    // preventing false positives on prose lines that happen to contain "No".
    const checklist: { criterion: string; verdict: string }[] = [];
    for (const raw of checklistText.split("\n")) {
      const line = raw.trim();
      if (!line) continue;

      const verdictMatch = line.match(VERDICT_PATTERN);
      if (!verdictMatch) continue;

      const verdict = verdictMatch[1].toUpperCase() as (typeof VERDICT_TOKENS)[number];

      // Strip leading list markers (-, *, •, numbers), then strip trailing verdict + delimiter
      const criterion = line
        .replace(/^[-*•\d.)\s]+/, "")          // leading bullets / numbering
        .replace(VERDICT_PATTERN, "")           // trailing verdict token (with optional **)
        .replace(/[\s:—\-]+$/, "")             // trailing delimiter(s)
        .trim();

      if (criterion) {
        checklist.push({ criterion, verdict });
      }
    }

    // ── The score is COMPUTED from the checklist in code (plan A4/A10) ────────
    // The LLM's FINAL_SCORE is a convenience echo; the authoritative number is
    // credits ÷ assessable criteria, with Insufficient Data UNSCORED (reducing
    // coverage, never inflating the score). Zero-tool / recovery verdicts with
    // no checklist cannot produce a number at all.
    let computed: ReturnType<typeof scoreChecklist> | null = null;
    if (checklist.length > 0) {
      computed = scoreChecklist(checklist);
    }
    const hasError = !!val.error;
    const authoritative = computed && computed.score !== null ? computed.score : null;

    parsed[key] = {
      ...val,
      score_0_100: authoritative == null ? null : Math.round(authoritative * 100) / 100,
      // The code-computed value is authoritative; keep the model echo for audit.
      llm_final_score: typeof val.score === "number" ? Math.round(val.score) : null,
      score_source: computed && computed.score !== null ? "checklist" : hasError ? "error" : "no_checklist",
      checklist,
      checklist_counts: computed?.counts,
      coverage: computed ? computed.coverage : null,
      risks: risksText,
    };
  }
  return parsed;
}

function isMacroSection(section?: string): boolean {
  return String(section || "").toLowerCase().includes("macro");
}

/**
 * Deterministic fallback report assembled purely from the already-scored data.
 * Used whenever LLM synthesis fails, so the final report ALWAYS reflects the
 * run's actual output — never a blank/banner page.
 */
export function buildFallbackReport(input: {
  agentDisplayName: string;
  quantAnalysis: Record<string, any>;
  qualAnalysis: Record<string, any>;
  totalScore: number;
  quantScore: number | null;
  qualScore: number | null;
  coverage?: number;
  /** Human-readable reason part of the pipeline could not run (metrics outage). */
  degraded?: string;
  partial: boolean;
}): AnalysisReport {
  const blocks: ReportBlock[] = [];
  const {
    totalScore,
    quantScore,
    qualScore,
    quantAnalysis,
    qualAnalysis,
    partial,
    agentDisplayName,
    coverage,
  } = input;

  const quantEntries = Object.values(quantAnalysis || {});
  const liveQuant = quantEntries.filter((m: any) => !m.price_unavailable && m.score_0_100 != null);
  const passed = liveQuant.filter((m: any) => (m.score_0_100 ?? 0) >= 70).length;
  const failed = liveQuant.filter((m: any) => (m.score_0_100 ?? 0) < 40).length;
  const unavailable = quantEntries.length - liveQuant.length;

  // Unscored params are excluded from the average — never dragged through 0.
  const qualEntries = Object.values(qualAnalysis || {}).filter(
    (p: any) => !p.error && p.score_0_100 != null,
  );
  const qualAvg = qualEntries.length
    ? Math.round(qualEntries.reduce((s, p) => s + (p.score_0_100 ?? 0), 0) / qualEntries.length)
    : null;
  const macroScored = qualEntries.filter((p) => isMacroSection(p.section));
  const macroAvg = macroScored.length
    ? Math.round(macroScored.reduce((s, p) => s + (p.score_0_100 ?? 0), 0) / macroScored.length)
    : null;

  const sev =
    (totalScore >= 70 ? "strong" : totalScore >= 40 ? "moderate" : "weak") +
    ` (${totalScore.toFixed(1)}/100) alignment with the "${agentDisplayName}" mandate.`;

  const summary: string[] = [];
  summary.push(`Quantitative gates: ${passed} passed, ${failed} failed of ${quantEntries.length} assessed.`);
  if (unavailable > 0) summary.push(`${unavailable} criterion${unavailable === 1 ? " is" : "s are"} not scored (no live price or missing data) — coverage reflects this.`);
  if (qualEntries.length) summary.push(`Qualitative average ${qualAvg}${macroAvg != null ? `; macro/market average ${macroAvg}` : ""}.`);
  if (partial) summary.push("Some qualitative parameters failed to score; this report reflects partial data.");
  if (coverage != null) summary.push(`Coverage: ${coverage}% of scoring weight was backed by assessable data.`);
  summary.push("Score summary tables are rendered deterministically from the scored data; per-parameter reasoning follows.");

  blocks.push(
    { type: "heading", level: 2, text: "Executive Summary" },
    { type: "paragraph", text: `Overall assessment: ${sev}\n\n${summary.map((s) => `- ${s}`).join("\n")}` },
    {
      type: "callout",
      tone: totalScore >= 70 ? "positive" : totalScore >= 40 ? "caution" : "negative",
      text: `Aggregate score ${totalScore.toFixed(1)}/100 — quantitative ${quantScore == null ? UNSCORED_LABEL : quantScore.toFixed(1)}, qualitative ${qualScore == null ? UNSCORED_LABEL : qualScore.toFixed(1)}.`,
    },
  );

  // Degraded-data notice (metrics outage): stated up front, never buried.
  if (input.degraded) {
    blocks.push({
      type: "callout",
      tone: "caution",
      text: `Partial analysis: ${input.degraded}. The score above is a PARTIAL estimate built only from the pillars that ran; re-run when the data service recovers for the complete assessment.`,
    });
  }

  if (Object.keys(qualAnalysis || {}).length > 0) {
    blocks.push({ type: "heading", level: 2, text: "Qualitative Assessment" });
    for (const [key, p] of Object.entries(qualAnalysis as Record<string, any>)) {
      const score = Math.round(p.score_0_100 ?? p.score ?? 0);
      blocks.push(
        { type: "heading", level: 3, text: `${key}` },
        { type: "paragraph", text: `Score: ${score}/100 · weight ${p.weightage ?? "—"}${isMacroSection(p.section) ? " · macro/market" : ""}` },
      );
      if (p.error) {
        blocks.push({ type: "callout", tone: "negative", text: `This parameter failed to score: ${String(p.error)}` });
        continue;
      }
      if (p.risks) blocks.push({ type: "callout", tone: "caution", text: `Risks / mitigations: ${String(p.risks).slice(0, 1200)}` });
      if (p.analysis) blocks.push({ type: "paragraph", text: `Reasoning: ${String(p.analysis).slice(0, 4000)}` });
    }
  }

  blocks.push(
    { type: "heading", level: 2, text: "Aggregate Scores" },
    {
      type: "chart",
      chartType: "bar",
      title: "Score by dimension",
      data: [
        { name: "Quantitative", score: Math.round(quantScore ?? 0) },
        { name: "Qualitative", score: Math.round(qualScore ?? 0) },
        { name: "Overall", score: Math.round(totalScore) },
      ],
      sourceKeys: ["scored_data"],
    },
    { type: "callout", tone: "neutral", text: `Generated deterministically from this run's scored output by the Relativity pipeline.` },
  );

  return { heroPct: Math.round(totalScore * 10) / 10, heroLabel: `Alignment with ${agentDisplayName}`, blocks, partial, source: "fallback" };
}

export interface SynthesisInput {
  modelId: string;
  llmKeys: LlmKeys;
  agentPersona: string;
  agentDisplayName: string;
  quantAnalysis: Record<string, any>;
  qualAnalysis: Record<string, any>;
  totalScore: number;
  quantScore: number | null;
  qualScore: number | null;
  /** Honest-aggregation extras (plan 0.3): band + coverage, stated in the report. */
  fitLow?: number;
  fitHigh?: number;
  coverage?: number;
  asOf?: string;
  /** Set when part of the pipeline could not run (e.g. metrics outage) — stated prominently in the report. */
  degraded?: string;
  partial: boolean;
  plan?: AnalysisPlan;
  /** Condensed raw tool observations, so the model can plot real observed series. */
  toolEvidence?: string;
}

export async function synthesizeReport(input: SynthesisInput): Promise<AnalysisReport> {
  const { apiKey, keyRef } = keyPool.pickKey(input.modelId, input.llmKeys as Record<string, string | undefined>);
  const model = buildModel(input.modelId, input.llmKeys, apiKey);

  const provider = providerFor(input.modelId);
  const started = Date.now();
  const fallback = () => {
    log.warn("[agent]", "using deterministic fallback report (LLM synthesis failed)");
    const fb = buildFallbackReport(input);
    void keyPool.recordUsage({ provider, keyRef, modelId: input.modelId, requests: 1 });
    return fb;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await generateObject({
        model,
        schema: AnalysisReportSchema,
        system: REPORT_SYNTHESIS_SYSTEM_PROMPT,
        prompt: buildReportSynthesisPrompt({
          agentPersona: input.agentPersona,
          agentDisplayName: input.agentDisplayName,
          totalScore: input.totalScore,
          quantScore: input.quantScore ?? 0,
          qualScore: input.qualScore ?? 0,
          fitLow: input.fitLow,
          fitHigh: input.fitHigh,
          coverage: input.coverage,
          asOf: input.asOf,
          degraded: input.degraded,
          quantAnalysis: input.quantAnalysis,
          qualAnalysis: input.qualAnalysis,
          partial: input.partial,
          planOutline: input.plan?.report,
          toolEvidence: input.toolEvidence,
        }),
        temperature: 0.1,
      });

      keyPool.recordUsage({
        provider,
        keyRef,
        modelId: input.modelId,
        requests: 1,
        tokensIn: res.usage?.inputTokens,
        tokensOut: res.usage?.outputTokens,
      });

      log.info("[agent]", `Synthesized report in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return { ...res.object, source: res.object.source ?? "llm" };
    } catch (e: any) {
      log.warn("[agent]", `report synthesis attempt ${attempt + 1} failed:`, e?.message || e);
      if (attempt === 0) {
        keyPool.markFailure(provider, keyRef);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  return fallback();
}

/**
 * Hard gate that guarantees the persisted report never contains invented or
 * illogical figures. Every numeric table cell and chart data point must trace
 * to the known source values, and every chart must clear semantic guards
 * (≥2 series, radar ≥2 axes, line/area ≥2 points). Blocks that fail are
 * dropped; the remaining report stays structurally valid.
 */
export function sanitizeReport(report: AnalysisReport, known: Set<number>): { report: AnalysisReport; dropped: string[] } {
  const knownOk = (n: number): boolean => {
    for (const k of known) if (Math.abs(n - k) <= 0.5) return true;
    return false;
  };

  const dropped: string[] = [];
  const blocks: ReportBlock[] = [];

  for (const block of report.blocks) {
    const label = block.type === "chart" ? block.title || "chart" : block.type === "table" ? block.title || "table" : block.type;

    if (block.type === "table") {
      let ok = true;
      for (const row of block.rows) {
        for (const cell of row) {
          if (typeof cell === "number" && !knownOk(cell)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) {
        dropped.push(`${label}: table contains an ungrounded number`);
        continue;
      }
      blocks.push(block);
      continue;
    }

    if (block.type === "chart") {
      const data = block.data || [];
      if (data.length < 2) {
        dropped.push(`${label}: chart of a single scalar`);
        continue;
      }
      if (block.chartType === "radar" && data.length < 3) {
        dropped.push(`${label}: radar needs ≥3 axes`);
        continue;
      }
      let ok = true;
      let dataPoints = 0;
      for (const row of data) {
        for (const [field, val] of Object.entries(row)) {
          if (field === "name" || field === "label") continue;
          if (typeof val === "number") {
            dataPoints++;
            if (block.chartType === "pie" && val < 0) {
              ok = false;
              break;
            }
            if (!knownOk(val)) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) break;
      }
      if (!ok) {
        dropped.push(`${label}: chart data not traceable to scored values`);
        continue;
      }
      if ((block.chartType === "line" || block.chartType === "area") && dataPoints < 2) {
        dropped.push(`${label}: line/area needs ≥2 data points`);
        continue;
      }
      blocks.push(block);
      continue;
    }

    blocks.push(block);
  }

  return { report: { ...report, blocks }, dropped };
}

// ============================================================================
// 4. Score summary tables — rendered by CODE, not the model (plan 0.2 / D2)
// ============================================================================
// Every cell is transcribed from the already-scored data by deterministic code.
// The model never authors these tables, so weights can't be rescaled, rows
// can't be dropped, and no totals row can be invented. (The LLM may still
// choose narrative emphasis in the synthesized report; the numbers are ours.)

function fmtThreshold(e: { operator?: string; threshold?: any; value_upper?: any }): string {
  const sym: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between" };
  const s = sym[e.operator || ""] || e.operator || "";
  const t = e.threshold ?? "?";
  const upper = e.operator === "between" && e.value_upper != null ? ` and ${e.value_upper}` : "";
  return `${s} ${t}${upper}`.trim();
}

export function buildScoreTables(input: {
  quantAnalysis: Record<string, any>;
  qualAnalysis: Record<string, any>;
  quantScore: number | null;
  qualScore: number | null;
  totalScore: number | null;
  coverage?: number;
}): ScoreTable[] {
  const tables: ScoreTable[] = [];

  const quantRows: ScoreTableRow[] = Object.entries(input.quantAnalysis || {}).map(([key, e]: [string, any]) => ({
    label: e.metric_name || key,
    rule: fmtThreshold(e),
    value: e.price_unavailable ? "N/A (no live price)" : e.value == null ? UNSCORED_LABEL : String(e.value),
    weight: e.weightage,
    score: typeof e.score_0_100 === "number" ? e.score_0_100 : e.score == null ? null : Math.round(e.score * 100) / 100,
    note: e.price_unavailable ? "price data unavailable" : e.unscored_reason ? String(e.unscored_reason).replace(/_/g, " ") : undefined,
  }));
  if (quantRows.length) {
    tables.push({
      title: "Quantitative criteria",
      columns: ["Criterion", "Rule", "Actual", "Wgt", "Score"],
      rows: quantRows,
    });
  }

  const qualRows: ScoreTableRow[] = Object.entries(input.qualAnalysis || {}).map(([key, p]: [string, any]) => {
    const counts = p.checklist_counts || countVerdicts(p.checklist || []);
    const parts: string[] = [];
    if (counts.YES) parts.push(`${counts.YES}Y`);
    if (counts.PARTIAL) parts.push(`${counts.PARTIAL}P`);
    if (counts.NO) parts.push(`${counts.NO}N`);
    if (counts["INSUFFICIENT DATA"]) parts.push(`${counts["INSUFFICIENT DATA"]} insuff.`);
    return {
      label: key,
      value: parts.join(" / ") || undefined,
      weight: p.weightage,
      score: typeof p.score_0_100 === "number" ? p.score_0_100 : p.score == null ? null : Math.round(p.score * 100) / 100,
      note: p.error ? "scoring failed" : p.coverage != null ? `coverage ${p.coverage}%` : undefined,
    };
  });
  if (qualRows.length) {
    tables.push({
      title: "Qualitative parameters",
      columns: ["Parameter", "Verdicts", "Wgt", "Score"],
      rows: qualRows,
    });
  }

  const totalsRow = (label: string, score: number | null): ScoreTableRow => ({
    label,
    score,
    note: score == null ? UNSCORED_LABEL : undefined,
  });
  tables.push({
    title: "Aggregate",
    columns: ["Dimension", "Score"],
    rows: [
      totalsRow("Quantitative", input.quantScore),
      totalsRow("Qualitative", input.qualScore),
      totalsRow("Overall", input.totalScore),
      {
        label: "Coverage",
        score: null,
        note: input.coverage != null ? `${input.coverage}%` : "—",
      },
    ],
  });

  return tables;
}

function countVerdicts(checklist: { verdict: string }[]): Record<string, number> {
  const counts: Record<string, number> = { YES: 0, PARTIAL: 0, NO: 0, "INSUFFICIENT DATA": 0 };
  for (const c of checklist || []) {
    const v = String(c.verdict || "").toUpperCase();
    if (v in counts) counts[v] += 1;
  }
  return counts;
}

/** Convert deterministic ScoreTables into report table blocks (strings/numbers only). */
export function scoreTablesToBlocks(tables: ScoreTable[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const t of tables) {
    blocks.push({
      type: "table",
      title: t.title,
      columns: t.columns,
      rows: t.rows.map((r) => {
        const cells: (string | number)[] = [r.label];
        if (t.columns.includes("Rule")) cells.push(r.rule ?? "—");
        if (t.columns.includes("Actual") || t.columns.includes("Verdicts")) cells.push(r.value ?? "—");
        if (t.columns.includes("Wgt")) cells.push(r.weight ?? "—");
        cells.push(r.score == null ? UNSCORED_LABEL : Math.round(r.score * 10) / 10);
        if (t.columns.includes("Note")) cells.push(r.note ?? "");
        return cells;
      }),
      sourceKeys: ["scored_data"],
    });
  }
  return blocks;
}

export interface MarkdownTable {
  columns: string[];
  rows: (string | number)[][];
}

/** Parse GitHub-style pipe tables out of an LLM's markdown output. */
export function parseMarkdownTables(md: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  const lines = String(md || "").split("\n");
  const isPipe = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
  const cellsOf = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim());
  const isSeparator = (l: string) => {
    const cells = cellsOf(l);
    return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
  };
  const toCell = (raw: string): string | number => {
    const t = raw.replace(/\*+/g, "").replace(/`/g, "").trim();
    const numeric = t.replace(/,/g, "").replace(/%$/, "").trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(numeric)) {
      const v = Number(numeric);
      if (Number.isFinite(v)) return Math.round(v * 100) / 100;
    }
    return t;
  };

  let i = 0;
  while (i < lines.length) {
    if (!isPipe(lines[i])) {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && isPipe(lines[i])) {
      block.push(lines[i].trim());
      i++;
    }
    const columns = cellsOf(block[0]).map((c) => c.replace(/\*+/g, "").trim());
    if (columns.length === 0) continue;
    let rows = block.slice(1);
    if (rows.length && isSeparator(rows[0])) rows = rows.slice(1);
    const parsed: MarkdownTable = {
      columns,
      rows: rows.map((l) => cellsOf(l).map(toCell)),
    };
    if (parsed.rows.length) tables.push(parsed);
  }
  return tables;
}


