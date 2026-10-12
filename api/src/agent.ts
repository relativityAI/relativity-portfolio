import { generateText } from "ai";
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
import { config } from "./config.js";
import { getToolCatalog } from "./tools.js";
import { log } from "./logger.js";
import { keyPool } from "./keypool.js";
import { buildDraftParametersPrompt } from "./prompts.js";

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
  layoutSections: z.array(z.any()).optional(),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
