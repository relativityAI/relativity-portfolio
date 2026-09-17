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

// ── Dynamic model discovery ──────────────────────────────────────────

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
};

async function fetchProviderModels(
  provider: string,
  apiKey: string,
): Promise<string[]> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return [];

  // Check cache
  const cached = providerModelCache.get(provider);
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
    const rawIds = endpoint.extractModels(data);

    // Add provider prefix if not already present
    const prefixed = rawIds.map((id: string) =>
      id.startsWith(`${endpoint.prefix}/`) ? id : `${endpoint.prefix}/${id}`,
    );

    providerModelCache.set(provider, { models: prefixed, fetchedAt: Date.now() });
    log.info("[models]", `${provider}: discovered ${prefixed.length} models`);
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

  // No keys anywhere — fall back to the full curated list so the UI stays useful.
  if (allProviders.length === 0) return getModelIds();

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
  const liveResults = await Promise.all(fetches);
  const liveModels = new Set(liveResults.flat());

  // Curated models include Ollama (keyless) plus everything above; dedupe and keep
  // ordering: explicit env models first, curated by priority, live-only models alpha.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...explicitModels, ...curatedModels, ...getModels().filter((m) => m.id.split("/")[0] === "ollama").map((m) => m.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of [...liveModels].filter((id) => !seen.has(id)).sort()) {
    ordered.push(id);
  }
  return ordered;
}
