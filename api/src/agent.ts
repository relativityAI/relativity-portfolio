import { generateText, isStepCount, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { aggregateWeightedScores } from "./scoring.js";
import { config } from "./config.js";
import { buildTools, extractToolCalls, ToolContext } from "./tools.js";
import type { DataAdequacy } from "./quant.js";
import { log } from "./logger.js";
import {
  QUALITATIVE_SCORING_SYSTEM_PROMPT,
  buildScoreRecoveryPrompt,
  buildDraftParametersPrompt,
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

export function buildModel(modelId: string, keys: LlmKeys) {
  const provider = providerFor(modelId);
  const name = modelNameFor(modelId);
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: keys.openai || process.env.OPENAI_API_KEY })(name);
    case "gemini":
      return createGoogleGenerativeAI({
        apiKey: keys.gemini || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
      })(name);
    case "anthropic":
      return createAnthropic({ apiKey: keys.anthropic || process.env.ANTHROPIC_API_KEY })(name);
    case "cerebras":
      return createOpenAICompatible({
        name: "cerebras",
        apiKey: keys.cerebras || process.env.CEREBRAS_API_KEY,
        baseURL: "https://api.cerebras.ai/v1",
      })(name);
    case "groq":
      return createOpenAICompatible({
        name: "groq",
        apiKey: keys.groq || process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      })(name);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        apiKey: keys.openrouter || process.env.OPENROUTER_API_KEY,
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
  const model = buildModel(modelId, keys);
  const scope =
    section === "macro_evaluation"
      ? "market-level / macro qualitative factors a stock picker should monitor"
      : "company-level qualitative parameters for judging individual stocks";
  const result = await generateText({
    model,
    prompt: buildDraftParametersPrompt(persona, count, scope),
    temperature: 0.4,
    maxOutputTokens: 1500,
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
): Promise<QualResult> {
  const started = Date.now();
  try {
    const model = buildModel(modelId, keys);
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

    const result = await generateText({
      model,
      instructions: QUALITATIVE_SCORING_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.1,
      maxOutputTokens: 8192,
      stopWhen: isStepCount(config.maxToolSteps),
      tools,
      abortSignal: AbortSignal.timeout(PARAM_TIMEOUT_MS),
    });

    const text = result.text || "";
    let { score, found } = parseFinalScoreResult(text);
    if (!found && text.trim()) {
      ({ score, found } = await recoverScore(model, text));
    }
    const calls = extractToolCalls(result.steps as any);

    const steps = result.steps || [];
    const lastStep = steps[steps.length - 1] as any;
    const maxTurnsReached =
      steps.length >= config.maxToolSteps && !!lastStep && lastStep.finishReason === "tool-calls";
    const error = found ? undefined : maxTurnsReached ? "Max tool-call turns reached" : "FINAL_SCORE not found";

    const usage: any = result.usage;
    log.info(
      "[agent]",
      `${modelId} "${parameter.parameter}" -> score=${score} toolCalls=${calls.length} steps=${steps.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return {
      score: error ? 0 : score,
      analysis: text,
      toolCalls: calls,
      error,
      tokens: usage
        ? { input: usage.inputTokens ?? undefined, output: usage.outputTokens ?? undefined }
        : undefined,
    };
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError" || /abort/i.test(String(e?.name));
    log.error("[agent]", `${modelId} "${parameter.parameter}" failed:`, e?.message || e);
    return {
      score: 0,
      analysis: "",
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
    let res = await runQualitative(
      modelId,
      keys,
      toolCtx,
      { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
      documents,
      webSearch,
      adequacy,
      investorContext,
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
