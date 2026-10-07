import { generateText, generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible as _createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { sanitizeSSEFetch } from "./sse.js";

// All OpenAI-compatible gateways go through one fetch wrapper — see sse.ts.
const sanitizeFetch = sanitizeSSEFetch();
const createOpenAICompatible = (o: Parameters<typeof _createOpenAICompatible>[0]) =>
  _createOpenAICompatible({ fetch: sanitizeFetch, ...o });
import { aggregateWeightedScores, scoreChecklist } from "./scoring.js";
import { config } from "./config.js";
import { buildTools, getToolCatalog, ToolContext } from "./tools.js";
import type { DataAdequacy } from "./quant.js";
import { log } from "./logger.js";
import { runAgentTurn, retryLlmCall, type HarnessOptions } from "./harness.js";
import { keyPool } from "./keypool.js";
import {
  QUALITATIVE_SCORING_SYSTEM_PROMPT,
  ANALYSIS_PLAN_SYSTEM_PROMPT,
  buildAnalysisPlanPrompt,
  buildScoreRecoveryPrompt,
  buildDraftParametersPrompt,
  buildVerdictRecoveryPrompt,
  REPORT_SYNTHESIS_SYSTEM_PROMPT,
  SKILL_REPORT_SYNTHESIS_SYSTEM_PROMPT,
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
  mistral?: string;
  nvidia?: string;
  cohere?: string;
  zai?: string;
  tavily?: string;
}

function providerFor(modelId: string): string {
  return modelId.split("/")[0];
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  groq: "Groq",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  nvidia: "NVIDIA NIM",
  cohere: "Cohere",
  zai: "Z.AI",
  ollama: "Ollama",
};

/**
 * Every provider except local Ollama requires an API key. buildModel must
 * fail LOUDLY when none is configured — otherwise the provider call goes out
 * with no Authorization header, the provider answers 401, and the harness
 * surfaces only the generic "No output generated" while the run burns its
 * full time budget retrying a request that can never succeed.
 */
export function assertProviderKeyAvailable(provider: string, key: string | undefined): void {
  if (provider === "ollama") return;
  if (!key || !String(key).trim()) {
    throw new Error(
      `No API key configured for "${PROVIDER_LABELS[provider] || provider}" — add one in Settings or pick a model from a provider that has a key.`,
    );
  }
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
  mistral: process.env.MISTRAL_API_KEY,
  nvidia: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
  cohere: process.env.COHERE_API_KEY || process.env.COHERE_API_TOKEN,
  zai: process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY,
};

export function buildModel(modelId: string, keys: LlmKeys, apiKey?: string) {
  const provider = providerFor(modelId);
  const name = modelNameFor(modelId);
  const key = apiKey || keys[provider as keyof LlmKeys] || LEGACY_ENV_KEYS[provider];
  assertProviderKeyAvailable(provider, key);
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
    // Free-tier providers (no credit card needed for an API key). All expose
    // OpenAI-compatible chat endpoints.
    case "mistral":
      return createOpenAICompatible({
        name: "mistral",
        apiKey: key,
        baseURL: "https://api.mistral.ai/v1",
      })(name);
    case "nvidia":
      return createOpenAICompatible({
        name: "nvidia",
        apiKey: key,
        baseURL: "https://integrate.api.nvidia.com/v1",
      })(name);
    case "cohere":
      return createOpenAICompatible({
        name: "cohere",
        apiKey: key,
        baseURL: "https://api.cohere.ai/compatibility/v1",
      })(name);
    case "zai":
      return createOpenAICompatible({
        name: "zai",
        apiKey: key,
        baseURL: "https://api.z.ai/api/paas/v4",
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

// Last-resort score recovery is a STRUCTURED verdict (plan: no regex parsers):
// a typed generateObject attempt first, never a giant integer-scrape net.
const ScoreRecoverySchema = z.object({
  score: z.number().min(0).max(100),
});

async function recoverScore(
  model: LanguageModel,
  analysis: string,
): Promise<{ score: number; found: boolean }> {
  try {
    const res = await generateObject({
      model,
      schema: ScoreRecoverySchema,
      prompt: buildScoreRecoveryPrompt(analysis),
      temperature: 0,
      maxOutputTokens: 32,
    });
    const s = res.object?.score;
    return Number.isFinite(s) ? { score: Math.max(0, Math.min(100, Math.round(s))), found: true } : { score: 0, found: false };
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
// line. Emits a typed verdict (score + text) instead of a markdown FINAL_SCORE
// to regex-scrape (plan: no regex parsers).
const VerdictSchema = z.object({
  score: z.number().min(0).max(100),
  verdictText: z.string().describe("Short structured markdown summary for the report."),
});

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
      const res = await generateObject({
        model,
        schema: VerdictSchema,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 4096,
        abortSignal: AbortSignal.timeout(60_000),
      });
      const v = res.object;
      if (v && typeof v.score === "number" && Number.isFinite(v.score) && v.verdictText?.trim()) {
        return {
          text: `${v.verdictText.trim()}\n\nFINAL_SCORE: ${Math.round(v.score)}`,
          score: Math.max(0, Math.min(100, Math.round(v.score))),
          found: true,
        };
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
export function investorProfileLine(persona?: any): string {
  const parts: string[] = [];
  const phil = persona?.philosophy || persona?.philosophy_and_mindset;
  if (phil?.trim()) parts.push(`Philosophy: ${String(phil).trim().slice(0, 2000)}`);
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
      const res = await retryLlmCall(
        "analysis planning",
        (signal) =>
          generateObject({
            model,
            schema: AnalysisPlanSchema,
            system: ANALYSIS_PLAN_SYSTEM_PROMPT,
            prompt: buildAnalysisPlanPrompt(input),
            temperature: 0.2,
            maxOutputTokens: 2048,
            abortSignal: signal,
          }),
        {
          attempts: 3,
          delayMs: 1500,
          onError: (msg) => {
            if (/quota|rate.?limit|429|exceeded|resource.?exhausted/i.test(msg)) keyPool.markFailure(provider, keyRef);
          },
          check: (r) => !!r?.object?.params,
        },
      );
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
  const investorContext = investorProfileLine(agent?.persona);

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
  z.object({ type: z.literal("chart"), chartType: z.enum(["bar", "line", "radar", "area", "scatter", "pie", "candlestick"]), title: z.string().optional(), data: z.array(z.record(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
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
/**
 * A chart whose numeric series are all identical carries no signal — same
 * data reads better as a table (plots must be relevant, not decorative).
 */
function isFlatChart(data: Record<string, string | number>[]): boolean {
  const values: number[] = [];
  for (const row of data) {
    for (const [field, val] of Object.entries(row)) {
      if (field === "name" || field === "label") continue;
      if (typeof val === "number" && Number.isFinite(val)) values.push(val);
    }
  }
  return values.length >= 2 && values.every((v) => v === values[0]);
}

/** Drop a flat/degenerate chart but keep its data as a table block. */
function chartToTable(block: Extract<ReportBlock, { type: "chart" }>): ReportBlock {
  const data = block.data || [];
  const first = data[0] || {};
  const nameKey = first.name != null ? "name" : first.label != null ? "label" : null;
  const valueKeys = Object.keys(first).filter((k) => k !== "name" && k !== "label");
  const columns = [nameKey === "label" ? "Label" : "Name", ...valueKeys];
  const rows: (string | number)[][] = data.map((d) => [
    nameKey ? String((d as any)[nameKey] ?? "") : "",
    ...valueKeys.map((k) => (d as any)[k] ?? ""),
  ]);
  return {
    type: "table",
    title: block.title ? `${block.title} (data)` : "Chart data",
    columns,
    rows,
    sourceKeys: block.sourceKeys,
  };
}

export function sanitizeReport(report: AnalysisReport, known: Set<number>): { report: AnalysisReport; dropped: string[] } {
  const knownOk = (n: number): boolean => {
    for (const k of known) if (Math.abs(n - k) <= 0.5) return true;
    return false;
  };

  const dropped: string[] = [];
  const blocks: ReportBlock[] = [];

  for (const block of report.blocks) {
    const label = block.type === "chart" ? block.title || "chart" : block.type === "table" ? block.title || "table" : block.type;

    // Code-assembled blocks (sourceKeys prefixed "code:") are deterministic
    // transcriptions of real data feeds — price history, indicator series,
    // the computed aggregate. Their figures are provenance, not model output,
    // so the numeric-integrity gate does not apply: the gate exists to catch
    // numbers the LLM could have invented, and these never pass through the
    // LLM at all. The tables/charts below the skill reports section are all
    // code-assembled by design (D2/D5).
    const codeAssembled =
      (block.type === "table" || block.type === "chart") &&
      (block.sourceKeys || []).some((k) => typeof k === "string" && k.startsWith("code:"));
    if (codeAssembled) {
      blocks.push(block);
      continue;
    }

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
      if (isFlatChart(data)) {
        dropped.push(`${label}: flat chart converted to table`);
        blocks.push(chartToTable(block));
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
      sourceKeys: Object.values(input.quantAnalysis || {}).map((e: any) => e.metric_name || "metric") ,
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
      sourceKeys: Object.keys(input.qualAnalysis || {}),
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
      sourceKeys: t.sourceKeys?.length ? t.sourceKeys : ["scored_data"],
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



// ============================================================================
// 4. Skill-pipeline report synthesis (v3)
// One synthesis pass over the structured per-skill outputs. The narrative is
// the model's job; every number it may cite is provided pre-computed, and the
// sanitizeReport gate still drops ungrounded figures.
// ============================================================================

export interface SkillSynthesisInput {
  modelId: string;
  llmKeys: LlmKeys;
  agentPersona: string;
  agentDisplayName: string;
  /** Structured outputs from each skill analyst (findings + verdicts). */
  outputs: import("./skills/types.js").SkillOutput[];
  /** Null when the aggregate score was suppressed (coverage below the reliability floor). */
  totalScore: number | null;
  fitLow?: number;
  fitHigh?: number;
  coverage?: number;
  asOf?: string;
  degraded?: string;
  toolEvidence?: string;
  /**
   * Deterministic facts pack (WS-1): price, SMA/RSI/MACD/ATR/Bollinger/VWAP
   * and the level map, computed in code. The synthesis must quote these
   * exactly — never invent or recompute a figure.
   */
  factsPack?: string;
  /**
   * Code-derived stance (WS-3): per-timeframe + overall with confidence.
   * The synthesis must use this as the hero headline — never "alignment".
   */
  stance?: { short: string; medium: string; long: string; overall: string; confidence: number };
  /** Sampling temperature. The gate retry passes a higher value so it is a real second opinion, not a reroll. */
  temperature?: number;
  /** Consistency-gate issues the previous draft was rejected for (retry pass only). */
  fixIssues?: string[];
}

/**
 * Deterministic "Sources & citations" section, appended to EVERY skills-pipeline
 * report (LLM-synthesized or fallback). Built by CODE from the analysts'
 * recorded citations and raw tool observations — the unvarnished data the
 * analysis ran on, with the external URL where one exists. Not model output.
 */
/** Display domain of a URL ("nseindia.com"), or null when unparsable. */
function domainOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** One-line human summary of a JSON payload (first few key: value pairs). */
/**
 * One human-readable row pulled from an observation payload: a web story
 * (title / publisher / date / snippet) or a flattened key-value readout for
 * non-web feeds. Parsing mirrors the UI's SourceDataPanel so both ends agree
 * on what "readable" means — the model prompt's verbatim evidence, not a
 * JSON dump, is what reaches the report here.
 */
interface ObservationSummary {
    kind: "web" | "feed";
    items: { title: string | null; date: string | null; snippet: string | null }[];
}

function parseObservation(raw: string): ObservationSummary | null {
    if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
    try {
        const j = JSON.parse(raw);
        const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.results) ? j.results : [];
        if (arr.length > 0) {
            const items: ObservationSummary["items"] = [];
            for (const it of arr.slice(0, 6)) {
                if (!it || typeof it !== "object") continue;
                const title = typeof it.title === "string" && it.title.trim() ? it.title.trim() : null;
                const snippet = typeof it.content === "string" ? it.content.replace(/\s+/g, " ").trim().slice(0, 200) : null;
                if (!title && !snippet) continue;
                items.push({
                    title: title ? (title.length > 120 ? `${title.slice(0, 117)}…` : title) : null,
                    date: typeof it.published_date === "string" && it.published_date ? shortDateLabel(it.published_date) : null,
                    snippet,
                });
            }
            if (items.length > 0) return { kind: "web", items };
        }
        // Data feed: flattened key: value pairs, skipping URLs and long strings.
        const flat: string[] = [];
        const visit = (v: unknown, prefix = ""): void => {
            if (flat.length >= 6) return;
            if (v == null) return;
            if (typeof v === "object") {
                for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 10)) visit(val, prefix ? `${prefix}.${k}` : k);
            } else if (typeof v === "number" || typeof v === "boolean") {
                flat.push(`${prefix}: ${v}`);
            } else if (typeof v === "string") {
                const sv = v.replace(/\s+/g, " ").trim();
                if (sv.length <= 60 && !/^https?:/.test(sv)) flat.push(`${prefix}: ${sv}`);
            }
        };
        visit(j);
        if (flat.length > 0) return { kind: "feed", items: [{ title: null, date: null, snippet: flat.join(" · ") }] };
        return null;
    } catch {
        return null;
    }
}

/** Compact date label for an observation row ("26 Sep 2026"). */
function shortDateLabel(raw: string): string {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Deterministic "Sources" section appended to every skills-pipeline report.
 * One compact table per evidence class — web stories and feed reads — with
 * each row carrying its tool, the readable content, and the source key so
 * the report's citation numbering resolves against it.
 */
export function buildSourcesBlocks(outputs: import("./skills/types.js").SkillOutput[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const withEvidence = outputs.filter(
    (o) => (o.citations?.length || o.raw_observations?.length) && !o.error,
  );
  if (!withEvidence.length) return blocks;

  blocks.push({ type: "heading", level: 2, text: "Sources" });

  // ── Web stories: one table across all skills. Row = title / publisher /
  // date / snippet, with the URL in sourceKeys so the citation list links it. ──
  const storyRows: (string | number)[][] = [];
  const storyUrls: string[] = [];
  const feedRows: (string | number)[][] = [];
  for (const out of withEvidence) {
    for (const c of out.citations || []) {
      if (c.url) {
        const domain = domainOfUrl(c.url);
        storyRows.push([c.label || domain || "web source", domain || "", c.value || "", out.skill_name]);
        if (!storyUrls.includes(c.url)) storyUrls.push(c.url);
      } else if (c.value || c.label) {
        feedRows.push([c.label || c.source || "feed", c.source || "", c.value || "", out.skill_name]);
      }
    }
    for (const obs of (out.raw_observations || []).slice(0, 12)) {
      if (obs.status !== "ok") continue;
      const parsed = parseObservation(obs.result || "");
      if (!parsed) continue;
      if (parsed.kind === "web") {
        for (const item of parsed.items.slice(0, 3)) {
          if (!obs.url && !item.title) continue;
          const domain = obs.url ? domainOfUrl(obs.url) : "";
          storyRows.push([item.title || item.snippet?.slice(0, 80) || "web source", domain, item.date || "", out.skill_name].map((v) => v ?? ""));
          if (obs.url && !storyUrls.includes(obs.url)) storyUrls.push(obs.url);
        }
      } else {
        const readout = parsed.items[0]?.snippet || "";
        if (readout) feedRows.push([obs.tool, obs.tool, readout.slice(0, 140), out.skill_name]);
      }
    }
  }

  if (storyRows.length) {
    blocks.push({
      type: "table",
      title: "Web stories read",
      columns: ["Story", "Publisher", "Date", "Skill"],
      rows: storyRows,
      sourceKeys: storyUrls.length ? storyUrls : ["skill_outputs"],
    });
  }
  if (feedRows.length) {
    blocks.push({
      type: "table",
      title: "Data-feed reads",
      columns: ["Tool", "Feed", "Value returned", "Skill"],
      rows: feedRows,
      sourceKeys: ["skill_outputs"],
    });
  }
  return blocks;
}

/** Deterministic fallback for the skills pipeline: code-assembled narrative. */
export function buildSkillFallbackReport(input: SkillSynthesisInput): AnalysisReport {
  const blocks: ReportBlock[] = [];
  blocks.push({ type: "heading", level: 2, text: "Summary" });
  blocks.push({
    type: "paragraph",
    text: input.totalScore != null
      ? `${input.agentDisplayName} evaluated this company through ${input.outputs.length} skill${input.outputs.length === 1 ? "" : "s"}. The total score is ${input.totalScore} with coverage ${input.coverage ?? 0}%.`
      : `${input.agentDisplayName} evaluated this company through ${input.outputs.length} skill${input.outputs.length === 1 ? "" : "s"}. The total score was suppressed — coverage ${input.coverage ?? 0}% is below the reliability floor, so no headline number is reported. Read the per-skill verdicts instead.`,
  });
  if (input.degraded) blocks.push({ type: "callout", tone: "caution", text: `Degraded: ${input.degraded}` });

  for (const out of input.outputs) {
    blocks.push({ type: "heading", level: 3, text: out.skill_name });
    for (const f of (out.findings || []).slice(0, 4)) {
      blocks.push({
        type: "paragraph",
        text: `${f.title}: ${f.detail}`,
        citedKeys: (f.citations || []).map((c: any) => c.url || c.source).filter(Boolean) as string[],
      });
    }
    if (out.verdicts?.length) {
      blocks.push({
        type: "table",
        title: `${out.skill_name} verdicts`,
        columns: ["Anchor", "Verdict", "Evidence", "Source"],
        rows: out.verdicts.map((v) => [
          v.anchor,
          v.verdict,
          v.evidence,
          (v.citations || []).map((c: any) => c.url || c.source).filter(Boolean).join("; ") || "—",
        ]),
        sourceKeys: ["skill_outputs"],
      });
    }
    if (out.error) blocks.push({ type: "callout", tone: "caution", text: `${out.skill_name}: ${out.error}` });
  }

  blocks.push(...buildSourcesBlocks(input.outputs));

  return {
    heroPct: input.totalScore != null ? Math.round(input.totalScore * 10) / 10 : 0,
    heroLabel: input.stance
      ? `${input.stance.overall} · ${input.stance.confidence}% confidence`
      : `Alignment with ${input.agentDisplayName}`,
    blocks,
    partial: true,
    source: "fallback",
  };
}

/**
 * Synthesis is bounded by retryLlmCall's per-attempt timeout (harness.ts), not
 * here: without it a hung provider stream blocks the run until the stale-run
 * sweeper kills it, leaving a report that was already computed but never
 * written.
 * ponytail: 3 attempts x 120s is the real ceiling. Raise it only if synthesis
 * genuinely needs longer than 2 minutes; raise STALE_RUN_THRESHOLD_MS with it.
 */

export async function synthesizeSkillReport(input: SkillSynthesisInput): Promise<AnalysisReport> {
  const { apiKey, keyRef } = keyPool.pickKey(input.modelId, input.llmKeys as Record<string, string | undefined>);
  const model = buildModel(input.modelId, input.llmKeys, apiKey);
  const provider = input.modelId.split("/")[0];
  const started = Date.now();

  const fallback = () => {
    log.warn("[agent]", "using deterministic fallback report (skill synthesis failed)");
    void keyPool.recordUsage({ provider, keyRef, modelId: input.modelId, requests: 1 });
    return buildSkillFallbackReport(input);
  };

  // Citations ride as structured metadata only. They are NOT printed into the
  // prompt prose (the model was copying them into sentences as "(Source: ...)"
  // litter); the report renderer attaches them to the right sentences itself.
  const skillSummaries = input.outputs
    .map((out) => {
      const verdicts = (out.verdicts || [])
        .map((v) => `- ${v.anchor}: ${v.verdict} — ${v.evidence}`)
        .join("\n");
      const findings = (out.findings || [])
        .map((f) => `- ${f.title}: ${f.detail}`)
        .join("\n");
      const citeLines = [
        ...(out.findings || []).flatMap((f: any) => (f.citations || []).map((c: any) => `${out.skill_name} | ${f.title} | ${c.source ?? c.url ?? ""} | ${c.value ?? ""}`)),
        ...(out.verdicts || []).flatMap((v: any) => (v.citations || []).map((c: any) => `${out.skill_name} | ${v.anchor} | ${c.source ?? c.url ?? ""} | ${c.value ?? ""}`)),
      ].filter((l: string) => l.trim().split("|").length >= 3);
      return [
        `### ${out.skill_name} (${out.category})`,
        out.error ? `Status: ${out.error}` : "Status: ok",
        findings ? `Findings:\n${findings}` : "",
        verdicts ? `Verdicts:\n${verdicts}` : "",
        citeLines.length ? `CITATION TABLE (attach these to the matching sentences via citedKeys — never print them in prose):\n${citeLines.slice(0, 80).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const prompt = [
    `Company analysis by the investor agent "${input.agentDisplayName}".`,
    input.agentPersona ? `Investor persona:\n${input.agentPersona.slice(0, 2000)}` : "",
    "",
    input.totalScore != null
      ? `AGGREGATE (computed in code — state these exactly): total score ${input.totalScore}, uncertainty band ${input.fitLow ?? "?"}–${input.fitHigh ?? "?"}, coverage ${input.coverage ?? 0}%.`
      : `AGGREGATE (computed in code): the total score was SUPPRESSED — coverage ${input.coverage ?? 0}% is below the reliability floor. Say so plainly and do NOT state or invent any headline number; the uncertainty band is ${input.fitLow ?? "?"}–${input.fitHigh ?? "?"}.`,
    input.degraded ? `Degraded run note: ${input.degraded}` : "",
    input.fixIssues?.length
      ? `A previous draft of this report was REJECTED by an automated consistency check against the figures above. Correct exactly these and do not repeat them:\n${input.fixIssues.map((i) => `- ${i}`).join("\n")}`
      : "",
    "",
    "FACTS — computed in code, quote these exactly:",
    input.factsPack || "(no facts pack available)",
    "The lines beginning READING are the pipeline's own INTERPRETATION of those figures and are authoritative. " +
      "Quote the READING verdict verbatim instead of deriving your own reading: a timeframe is only 'oversold' when its zone says oversold, " +
      "MACD level and momentum must both be stated when they disagree, 'regime' names the actual trend state, and a price below VWAP is weakness. " +
      "Never contradict a READING line — if you believe it is wrong, say the figures are inconsistent and stop.",
    "Every number you write must appear in this facts pack, the per-skill outputs below, or the aggregate line above. Never compute, estimate, or 'fill in' a figure. If a needed figure is marked INSUFFICIENT, say so.",
    "",
    input.stance
      ? `STANCE (computed in code — use this as the headline, never "alignment" or "fit"): overall ${input.stance.overall}, confidence ${input.stance.confidence}%. Per timeframe: short ${input.stance.short}, medium ${input.stance.medium}, long ${input.stance.long}.`
      : "",
    "",
    "PER-SKILL STRUCTURED OUTPUTS (already produced by focused analyst runs):",
    skillSummaries.slice(0, 60000),
    "",
    "TASK: Write the final client-facing report. Requirements:",
    "- Open with the headline: what this investor should think of this company, through the lens of their skills and persona.",
    "- One section per skill summarizing its findings and verdict outcome. You may quote the findings and verdicts verbatim — do not invent new numbers, do not recompute anything.",
    "- NEVER print citations inline in the prose. Do not write '(Source: tool)', '(Citation: ...)', or paste URLs into sentences. Citation metadata is attached separately by the system; the reader sees it rendered. Write clean sentences only.",
    "- State the aggregate total, band, and coverage, and what INSUFFICIENT/unscored items mean for confidence.",
    "- End with a short synthesis: where the skills agree, where they disagree, and the single most important thing to watch next.",
    "- Every number you mention must appear in the material above. No exceptions.",
    "- Do NOT write a separate \"Data Sources\", \"Sources\", \"Tools used\", or similar section or table. The pipeline renders the Sources section automatically from the tools actually called, their responses, and their URLs. Enumerating tools or sources in your prose or tables is redundant and will be stripped.",
  ]
    .filter(Boolean)
    .join("\n");

  // Resilience: the executive-summary pass is one shot per run, so a
  // single provider hiccup used to leave the whole report empty. Retry
  // transient failures (rotating the key pool on quota/rate errors)
  // before degrading to the deterministic fallback.
  const res = await retryLlmCall(
    "skill report synthesis",
    (signal) =>
      generateObject({
        model,
        schema: AnalysisReportSchema,
        system: SKILL_REPORT_SYNTHESIS_SYSTEM_PROMPT,
        prompt,
        temperature: input.temperature ?? 0.1,
        abortSignal: signal,
      }),
    {
      attempts: 3,
      delayMs: 1500,
      onError: (msg) => {
        log.warn("[agent]", "skill report synthesis attempt failed:", msg);
        if (/quota|rate.?limit|429|exceeded|resource.?exhausted/i.test(msg)) keyPool.markFailure(provider, keyRef);
      },
      check: (r) => !!r?.object?.blocks,
    },
  ).catch((e: any) => {
    log.warn("[agent]", "skill report synthesis failed after retries:", e?.message || e);
    return null;
  });

  if (!res) return fallback();

  keyPool.recordUsage({
    provider,
    keyRef,
    modelId: input.modelId,
    requests: 1,
    tokensIn: (res.usage as any)?.inputTokens,
    tokensOut: (res.usage as any)?.outputTokens,
  });
  log.info("[agent]", `Skill report synthesized in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const report = { ...res.object, source: (res.object.source ?? "llm") as "llm" | "fallback" };
  // The Sources section is appended by CODE after this return — a model
  // that still emitted its own source/tools listing would render it
  // twice. Strip it here so only the authoritative section survives.
  report.blocks = stripSourceListingBlocks(report.blocks);
  return report;
}

/**
 * Deterministic backstop against redundant source listings: the LLM
 * sometimes emits its own "Data sources" / "Tools used" section even
 * though buildSourcesBlocks renders the authoritative one from the
 * tools actually called. Matches headings and tables whose entire
 * subject is the source/tool inventory — never a table that merely
 * cites a source in a cell.
 */
export function stripSourceListingBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const SOURCE_HEADING = /^\s*(data\s+)?sources?\s*(used)?\s*$/i;
  const SOURCE_TABLE = /\b(data\s+)?sources?\s*(used)?\b|tools?\s+used\b/i;
  return blocks.filter((b) => {
    if (b.type === "heading" && SOURCE_HEADING.test(b.text)) return false;
    if (b.type === "table" && b.title && SOURCE_TABLE.test(b.title)) {
      // Only drop when the table's columns are about the tooling itself
      // (tool / source / url), not when it merely cites sources as data.
      const cols = b.columns.join(" ").toLowerCase();
      if (/tool|source|url|provider|feed/.test(cols)) return false;
    }
    return true;
  });
}
