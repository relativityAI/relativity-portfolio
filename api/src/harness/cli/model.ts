/**
 * CLI model builder — turns a `provider/model` id plus environment keys into
 * a LanguageModel. The harness core never builds models (callers own the
 * model); this is the CLI's composition root, so provider wiring lives here
 * and the API keeps its own key-pool-backed builder (src/agent.ts).
 *
 * Keys are read from the usual env names, singular or plural (the plural
 * `*_API_KEYS` form the API's key pool uses — first entry wins).
 */

import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { openCodeBaseURL, openCodeHeaders } from "../opencode.js";

/** provider → env vars checked in order; plural vars hold comma-separated keys. */
const KEY_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEYS", "GOOGLE_API_KEYS"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEYS"],
  cerebras: ["CEREBRAS_API_KEY", "CEREBRAS_API_KEYS"],
  groq: ["GROQ_API_KEY", "GROQ_API_KEYS"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_API_KEYS"],
  mistral: ["MISTRAL_API_KEY", "MISTRAL_API_KEYS"],
  nvidia: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NVIDIA_API_KEYS"],
  cohere: ["COHERE_API_KEY", "COHERE_API_TOKEN", "COHERE_API_KEYS"],
  zai: ["ZAI_API_KEY", "Z_AI_API_KEY", "ZAI_API_KEYS"],
  opencode: ["OPENCODE_API_KEY", "OPENCODE_API_KEYS"],
};

const PROVIDER_LABEL: Record<string, string> = {
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
  opencode: "OpenCode",
};

export function envKey(provider: string): string | undefined {
  for (const name of KEY_ENV[provider] ?? []) {
    const raw = process.env[name];
    if (!raw?.trim()) continue;
    const first = raw.split(",")[0].trim();
    if (first) return first;
  }
  return undefined;
}

const COMPAT_BASE_URL: Record<string, string> = {
  cerebras: "https://api.cerebras.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  cohere: "https://api.cohere.com/compatibility/v1",
  zai: "https://api.z.ai/api/paas/v4",
};

/**
 * Build a model from `provider/name` (e.g. `groq/openai/gpt-oss-120b`,
 * `gemini/gemini-3.5-flash-lite`). Throws loudly when the provider's key is
 * missing — a keyless request would 401 at the provider and burn the run's
 * budget retrying something that can never succeed.
 */
export function buildModelFromEnv(modelId: string): LanguageModel {
  const provider = modelId.split("/")[0];
  const name = modelId.slice(modelId.indexOf("/") + 1);

  if (provider === "ollama") {
    return createOpenAICompatible({ name: "ollama", baseURL: process.env.OLLAMA_URL || "http://localhost:11434/v1" })(name);
  }

  const key = envKey(provider);
  if (!key) {
    throw new Error(
      `No API key for "${PROVIDER_LABEL[provider] || provider}" — set ${KEY_ENV[provider]?.[0] ?? `${provider.toUpperCase()}_API_KEY`} (or pick another --model).`,
    );
  }

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: key })(name);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: key })(name);
    case "anthropic":
      return createAnthropic({ apiKey: key })(name);
    case "opencode":
      // Go plan: every text model is served via chat completions (Console
      // translates other API families), and the session header is mandatory.
      return createOpenAICompatible({
        name: "opencode",
        apiKey: key,
        baseURL: openCodeBaseURL(),
        headers: openCodeHeaders(),
      })(name);
    default: {
      const baseURL = COMPAT_BASE_URL[provider];
      if (!baseURL) throw new Error(`Unknown model provider: ${provider} (expected one of ${Object.keys(KEY_ENV).join(", ")}, ollama)`);
      return createOpenAICompatible({ name: provider, apiKey: key, baseURL })(name);
    }
  }
}
