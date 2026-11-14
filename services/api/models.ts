import { readFileSync } from "node:fs";
import YAML from "yaml";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface ModelEntry {
  id: string;
  provider: string;
  name: string;
  priority: number;
}

let cache: ModelEntry[] | null = null;

export function getModels(): ModelEntry[] {
  if (!cache) {
    const raw = readFileSync(config.modelsFile, "utf8");
    const parsed = YAML.parse(raw) as { models: ModelEntry[] };
    cache = (parsed.models || [])
      .slice()
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
  return cache;
}

export function getModelIds(): string[] {
  return getModels().map((m) => m.id);
}

/**
 * Providers that work WITHOUT any API key: local Ollama plus the free-tier
 * cloud providers (no credit card needed — just a free signup key, which the
 * server pool supplies). Users with no keys of their own can still pick these.
 */
const KEYLESS_PROVIDERS = new Set(["ollama", "groq", "gemini", "cerebras", "openrouter", "mistral", "nvidia", "cohere", "zai"]);

export function isKeylessProvider(provider: string): boolean {
  return KEYLESS_PROVIDERS.has(provider);
}

// ── Dynamic model discovery ──────────────────────────────────────────

/**
 * OpenRouter `:free` models that exist in the catalog but are unusable here,
 * excluded from both the curated YAML list and live free-tier discovery:
 *   * thinkingmachines/inkling* — HTTP 403, restricted to OpenRouter's own
 *     agentic harness apps (coding agents / productivity apps on openrouter.ai)
 *   * nvidia/nemotron-3.5-content-safety — guardrail/moderation model, not a
 *     general chat model
 */
const OPENROUTER_FREE_EXCLUDED = new Set([
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "nvidia/nemotron-3.5-content-safety:free",
]);

const PROVIDER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const providerModelCache = new Map<string, { models: string[]; fetchedAt: number }>();

interface ProviderEndpoint {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  extractModels: (data: any) => string[];
  prefix: string;
}

const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !m.id.includes("embedding") && !m.id.includes("tts") && !m.id.includes("whisper") && !m.id.includes("dall-e") && !m.id.includes("moderation"))
        .map((m: any) => m.id),
    prefix: "openai",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: () => ({}),
    extractModels: (d) =>
      (d?.models || [])
        .filter((m: any) => m.name && m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: any) => {
          const name = String(m.name).replace(/^models\//, "");
          return name;
        }),
    prefix: "gemini",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "groq",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "cerebras",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "openrouter",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (k) => ({
      "x-api-key": k,
      "anthropic-version": "2023-06-01",
    }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "anthropic",
  },
  // Free-tier providers (no credit card needed for an API key).
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !m.id.includes("embed") && !m.id.includes("ocr") && !m.id.includes("moderation") && m.capabilities?.completion_chat !== false)
        .map((m: any) => m.id),
    prefix: "mistral",
  },
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => {
          const id = String(m.id || "");
          // NIM serves embedding/rerank/vision-only endpoints too; keep chat models.
          return id && !/embed|rerank|nv-embed|clip|ocr|guard|nemoretriever/i.test(id);
        })
        .map((m: any) => m.id),
    prefix: "nvidia",
  },
  cohere: {
    url: "https://api.cohere.ai/compatibility/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !/embed|rerank/i.test(String(m.id)))
        .map((m: any) => m.id),
    prefix: "cohere",
  },
  zai: {
    url: "https://api.z.ai/api/paas/v4/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || d?.models || [])
        .map((m: any) => String(m.id || m.model || ""))
        .filter(Boolean),
    prefix: "zai",
  },
};

async function fetchProviderModels(
  provider: string,
  apiKey: string,
  opts: {
    /** Keep only raw (unprefixed) model ids matching this predicate. */
    filter?: (id: string) => boolean;
    /** Cache key when one provider is fetched with different filters. */
    cacheKey?: string;
  } = {},
): Promise<string[]> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return [];

  const cacheKey = opts.cacheKey ?? provider;
  // Check cache
  const cached = providerModelCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PROVIDER_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    let url = endpoint.url;
    // Gemini uses query param for auth
    if (provider === "gemini") {
      url += `?key=${apiKey}`;
    }

    const res = await fetch(url, {
      headers: {
        ...endpoint.headers(apiKey),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn("[models]", `${provider} model list failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const rawIds = endpoint.extractModels(data).filter((id) => !opts.filter || opts.filter(id));

    // Add provider prefix if not already present
    const prefixed = rawIds.map((id: string) =>
      id.startsWith(`${endpoint.prefix}/`) ? id : `${endpoint.prefix}/${id}`,
    );

    providerModelCache.set(cacheKey, { models: prefixed, fetchedAt: Date.now() });
    log.info("[models]", `${cacheKey}: discovered ${prefixed.length} models`);
    return prefixed;
  } catch (e: any) {
    log.warn("[models]", `${provider} model list error: ${e?.message || e}`);
    return [];
  }
}

/**
 * Get available models for a user based on their configured API keys plus the
 * server's own key pools (config.serverKeys).
 * Providers the server is keyed for use their explicit PROVIDER_MODELS list
 * (or the curated YAML list); user-keyed providers keep curated + live discovery.
 * OpenRouter additionally live-discovers its `:free` tier with the server key so
 * keyless users see every free model (unless OPENROUTER_MODELS pins the list).
 * Curated models appear first (sorted by priority), dynamic models after (sorted alpha).
 */
export async function getAvailableModelsForUser(
  llmKeys: Record<string, string>,
): Promise<string[]> {
  const userProviders = Object.entries(llmKeys)
    .filter(([k, v]) => k !== "tavily" && !!v)
    .map(([k]) => k);
  const serverProviders = Object.keys(config.serverKeys).filter((p) => config.serverKeys[p]?.length);
  const allProviders = [...new Set([...serverProviders, ...userProviders])];

  // No keys anywhere — expose ONLY the keyless/server-free providers (ollama +
  // free-tier providers the server is NOT keyed for still need a user key, so
  // they stay hidden too). Previously this returned the full curated list,
  // which included paid models (OpenAI/Anthropic) users without keys could
  // never actually call.
  if (allProviders.length === 0) {
    return [
      ...getModels().filter((m) => isKeylessProvider(m.id.split("/")[0])).map((m) => m.id),
    ];
  }

  // Provider models for a keyed provider: explicit PROVIDER_MODELS env list,
  // else the curated YAML entries for that provider (in priority order).
  const explicitModels: string[] = [];
  const curatedModels: string[] = [];
  for (const provider of allProviders) {
    const envList = config.serverModels[provider];
    if (envList?.length) {
      explicitModels.push(...envList);
      continue;
    }
    curatedModels.push(
      ...getModels()
        .filter((m) => m.id.split("/")[0] === provider)
        .map((m) => m.id),
    );
  }

  // Live discovery only for providers the USER is keyed for (their key queries the API).
  const fetches = userProviders.map(async (provider) => {
    const key = llmKeys[provider];
    if (!key) return [];
    return fetchProviderModels(provider, key);
  });

  // OpenRouter's free catalog churns constantly (new `:free` models weekly),
  // while models.yaml can only be updated by hand — so also discover the free
  // tier with the server's key. That keeps every usable no-cost model in the
  // dropdown for keyless users even before the curated list is edited. Users
  // with their own OpenRouter key already get the full catalog above, and
  // models nobody can actually call here are filtered out (OPENROUTER_FREE_EXCLUDED).
  // An explicit OPENROUTER_MODELS env list wins over both (no discovery).
  const serverOpenrouterKey = config.serverKeys.openrouter?.[0];
  if (serverOpenrouterKey && !userProviders.includes("openrouter") && !config.serverModels.openrouter?.length) {
    fetches.push(
      fetchProviderModels("openrouter", serverOpenrouterKey, {
        filter: (id) => id.endsWith(":free") && !OPENROUTER_FREE_EXCLUDED.has(id),
        cacheKey: "openrouter:free",
      }),
    );
  }

  const liveResults = await Promise.all(fetches);
  const liveModels = new Set(liveResults.flat());

  // Curated models include Ollama (keyless) plus everything above; dedupe and keep
  // ordering: explicit env models first, curated by priority, live-only models alpha.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [
    ...explicitModels,
    ...curatedModels,
    ...getModels()
      .filter((m) => {
        const provider = m.id.split("/")[0];
        return isKeylessProvider(provider) && !allProviders.includes(provider);
      })
      .map((m) => m.id),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of [...liveModels].filter((id) => !seen.has(id)).sort()) {
    ordered.push(id);
  }
  return ordered;
}
