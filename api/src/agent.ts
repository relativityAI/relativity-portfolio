import { generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "./config.js";
import { buildTools, extractToolCalls, ToolContext } from "./tools.js";
import { log } from "./logger.js";

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

function buildModel(modelId: string, keys: LlmKeys) {
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

const SYSTEM_PROMPT = `You are a strict, evidence-based checklist auditor. Your job is to score a single qualitative investment requirement for a company (asset evaluation) or for the broader market (macro evaluation).

Rules:
- Gather evidence using the available tools before concluding. Never rely on memory or assumptions.
- Relevant tools include: financial metrics, financial statements, announcements, shareholdings, company documents (transcripts, presentations, PDFs), and optionally live web search.
- Decompose the requirement into the smallest number of distinct, checkable criteria — one per distinct investor requirement in the guidelines.
- Grade each criterion against gathered evidence only, using this fixed rubric:
  - Yes: fully met -> 1 credit
  - Partial: partially met -> 0.5 credit
  - No: not met -> 0 credit
  - Insufficient Data: cannot be assessed -> excluded from scoring (counts neither for nor against)
- Score objectively: no praise, no criticism, no holistic judgment. Only "does the evidence match the checklist".
- Prefer primary and newer sources. Treat conflicting sources as Insufficient Data.
- If data is missing or unavailable, mark the affected criterion as Insufficient Data and say so explicitly.
- FINAL_SCORE = (credits earned / number of assessable criteria) * 100, an integer between 0 and 100. If no criterion is assessable, FINAL_SCORE = 0.
- Your response must be markdown with these sections in order:
  SCORE JUSTIFICATION
  CHECKLIST (each item with YES / PARTIAL / NO / INSUFFICIENT DATA)
  RISKS
  CONCLUSION
  FINAL_SCORE: <integer between 0 and 100>
- The FINAL_SCORE line must be the last line of your response and contain only the integer.`;

export interface QualResult {
  score: number;
  analysis: string;
  toolCalls: Record<string, unknown>[];
  error?: string;
}

export async function runQualitative(
  modelId: string,
  keys: LlmKeys,
  toolCtx: ToolContext,
  parameter: { parameter: string; content?: string; weightage?: number; section?: string },
  documents: string[],
  webSearch: boolean,
  webSources: string[],
): Promise<QualResult> {
  const started = Date.now();
  try {
    const model = buildModel(modelId, keys);
    const tools = buildTools(toolCtx);

    const isMacro = parameter.section === "macro_evaluation";
    const contextLines = isMacro
      ? [
          `Market: ${toolCtx.source.toUpperCase()} (${toolCtx.country}).`,
          "",
          "This is a MACRO / market-level evaluation. Judge the state of the broader market that the analyzed company trades in — market direction, index levels, breadth, leadership, and macro conditions — not the company itself. Use web search and market data tools for recent market context.",
        ]
      : [
          `Company: ${toolCtx.shareName || toolCtx.symbol} (${toolCtx.symbol}) on ${toolCtx.source.toUpperCase()} (${toolCtx.country}).`,
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
- If web search is enabled you may use it for recent context.`,
      documents?.length ? `Relevant documents available on the exchange: ${documents.join(", ")}` : "",
      webSearch ? "Web search is enabled." : "Web search is disabled.",
      webSources?.length ? `Preferred web sources: ${webSources.join(", ")}` : "",
      ``,
      `End with the FINAL_SCORE line.`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.1,
      stopWhen: stepCountIs(config.maxToolSteps),
      tools,
    });

    const text = result.text || "";
    const { score, found } = parseFinalScoreResult(text);
    const calls = extractToolCalls(result.steps as any);

    const steps = result.steps || [];
    const lastStep = steps[steps.length - 1] as any;
    const maxTurnsReached =
      steps.length >= config.maxToolSteps && !!lastStep && lastStep.finishReason === "tool-calls";
    const error = found ? undefined : maxTurnsReached ? "Max tool-call turns reached" : "FINAL_SCORE not found";

    log.info(
      "[agent]",
      `${modelId} "${parameter.parameter}" -> score=${score} toolCalls=${calls.length} steps=${steps.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return {
      score: error ? 0 : score,
      analysis: text,
      toolCalls: calls,
      error,
    };
  } catch (e: any) {
    log.error("[agent]", `${modelId} "${parameter.parameter}" failed:`, e?.message || e);
    return {
      score: 0,
      analysis: "",
      toolCalls: [],
      error: String(e?.message || e),
    };
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed > 90_000) {
      log.warn(`[agent] ${modelId} took ${(elapsed / 1000).toFixed(1)}s`);
    }
  }
}

export function parseFinalScoreResult(text: string): { score: number; found: boolean } {
  const m = text.match(/FINAL_SCORE\s*[:：]\s*(\d{1,3})/i);
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
}

export async function runQualitativeAll(
  modelId: string,
  keys: LlmKeys,
  toolCtx: ToolContext,
  agent: any,
  documents: string[],
  webSearch: boolean,
  webSources: string[],
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
  for (const p of params) {
    const label = p.parameter || "Qualitative Parameter";
    const res = await runQualitative(
      modelId,
      keys,
      toolCtx,
      { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
      documents,
      webSearch,
      webSources,
    );
    qualitative_analysis[label] = {
      score: res.score,
      weightage: typeof p.weightage === "number" ? p.weightage : 5,
      analysis: res.analysis,
      error: res.error,
      section: p.section,
    };
    qualitative_tool_calls[label] = res.toolCalls;
    done += 1;
    onProgress?.(done, total, label);
  }

  const entries = Object.values(qualitative_analysis);
  const scored = entries.filter((e) => !e.error);
  const weightSum = scored.reduce((s, e) => s + e.weightage, 0);
  const qualitative_score =
    weightSum > 0
      ? Math.round((scored.reduce((s, e) => s + e.score * e.weightage, 0) / weightSum) * 100) / 100
      : 0;

  return { qualitative_analysis, qualitative_tool_calls, qualitative_score };
}
