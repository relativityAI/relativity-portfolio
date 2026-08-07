import { generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "./config.js";
import { buildTools, extractToolCalls, ToolContext } from "./tools.js";

export interface LlmKeys {
  openai?: string;
  gemini?: string;
  anthropic?: string;
  cerebras?: string;
  groq?: string;
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
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: config.ollamaUrl,
      })(name);
    default:
      throw new Error(`Unknown model provider: ${provider}`);
  }
}

const SYSTEM_PROMPT = `You are a strict, evidence-based checklist auditor. Your job is to score a single qualitative investment question for a stock.

Rules:
- Gather evidence using the available tools before concluding. Never rely on memory or assumptions.
- Relevant tools include: financial metrics, financial statements, announcements, shareholdings, company documents (transcripts, presentations, PDFs), and optionally live web search.
- If data is missing or unavailable, say so explicitly and score conservatively.
- Be objective. Follow the checklist given in the user message, one item at a time.
- Your response must be markdown with these sections in order:
  SCORE JUSTIFICATION
  CHECKLIST (each item with PASS / PARTIAL / FAIL)
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
  parameter: { parameter: string; content?: string; weightage?: number },
  documents: string[],
  webSearch: boolean,
  webSources: string[],
): Promise<QualResult> {
  const started = Date.now();
  try {
    const model = buildModel(modelId, keys);
    const tools = buildTools(toolCtx);

    const userPrompt = [
      `Company: ${toolCtx.shareName || toolCtx.symbol} (${toolCtx.symbol}) on ${toolCtx.source.toUpperCase()} (${toolCtx.country}).`,
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
    const score = parseFinalScore(text);
    return {
      score,
      analysis: text,
      toolCalls: extractToolCalls(result.steps as any),
    };
  } catch (e: any) {
    return {
      score: 50,
      analysis: "",
      toolCalls: [],
      error: String(e?.message || e),
    };
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed > 90_000) {
      console.warn(`[agent] ${modelId} took ${(elapsed / 1000).toFixed(1)}s`);
    }
  }
}

export function parseFinalScore(text: string): number {
  const m = text.match(/FINAL_SCORE\s*[:：]\s*(\d{1,3})/i);
  if (!m) return 50;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

export interface QualParamEntry {
  score: number;
  weightage: number;
  analysis: string;
  error?: string;
}

export async function runQualitativeAll(
  modelId: string,
  keys: LlmKeys,
  toolCtx: ToolContext,
  profile: any,
  documents: string[],
  webSearch: boolean,
  webSources: string[],
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<{
  qualitative_analysis: Record<string, QualParamEntry>;
  qualitative_tool_calls: Record<string, Record<string, unknown>[]>;
  qualitative_score: number | null;
}> {
  const params = [
    ...(profile?.asset_evaluation?.qualitative || []),
    ...(profile?.macro_evaluation?.qualitative || []),
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
      { parameter: label, content: p.content, weightage: p.weightage },
      documents,
      webSearch,
      webSources,
    );
    qualitative_analysis[label] = {
      score: res.score,
      weightage: typeof p.weightage === "number" ? p.weightage : 5,
      analysis: res.analysis,
      error: res.error,
    };
    qualitative_tool_calls[label] = res.toolCalls;
    done += 1;
    onProgress?.(done, total, label);
  }

  const entries = Object.values(qualitative_analysis);
  const qualitative_score =
    entries.length > 0
      ? entries.reduce((s, e) => s + e.score * e.weightage, 0) /
        entries.reduce((s, e) => s + e.weightage, 0)
      : null;

  return { qualitative_analysis, qualitative_tool_calls, qualitative_score };
}
