import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── server-side LLM key pools (multiple keys per provider for rotation) ──

export const LLM_PROVIDERS = ["openai", "gemini", "anthropic", "cerebras", "groq", "openrouter"] as const;

/** Parse a comma-separated env value into a trimmed, non-empty array. */
export function parseCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Server-provided LLM keys per provider. Sources, in order:
 *   PROVIDER_API_KEYS  -> "k1,k2" (multiple keys → rotation/quota pool)
 *   PROVIDER_API_KEY   -> legacy single-key fallback
 */
export function parseServerKeys(env: Record<string, string | undefined> = process.env as any): Record<string, string[]> {
  const pools: Record<string, string[]> = {};
  for (const p of LLM_PROVIDERS) {
    const upper = p.toUpperCase();
    const keys = parseCsv(env[`${upper}_API_KEYS`]);
    const legacy = env[`${upper}_API_KEY`];
    if (keys.length) pools[p] = keys;
    else if (legacy) pools[p] = [legacy];
  }
  return pools;
}

/**
 * Explicit model lists for keyed providers (PROVIDER_MODELS). When empty for a
 * keyed provider, the curated models.yaml entries for that provider are used.
 */
export function parseServerModels(env: Record<string, string | undefined> = process.env as any): Record<string, string[]> {
  const models: Record<string, string[]> = {};
  for (const p of LLM_PROVIDERS) {
    const list = parseCsv(env[`${p.toUpperCase()}_MODELS`]);
    if (list.length) models[p] = list;
  }
  return models;
}

export const DEFAULT_DAILY_REQUESTS: Record<string, number> = {
  gemini: 1500,
  groq: 7200,
  cerebras: 1440,
  openrouter: 1000,
  openai: 500,
  anthropic: 500,
};

/** Per-provider daily request caps used by the quota algorithm ({PROVIDER}_DAILY_REQUESTS). */
export function parseDailyCaps(env: Record<string, string | undefined> = process.env as any): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const p of LLM_PROVIDERS) {
    const n = Number(env[`${p.toUpperCase()}_DAILY_REQUESTS`]);
    caps[p] = Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_REQUESTS[p];
  }
  return caps;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  // Supabase
  supabaseProjectUrl: process.env.SUPABASE_PROJECT_URL || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  // AES-256-GCM key for encrypting stored API keys (64 hex chars = 32 bytes)
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  // Voyager
  voyagerUrl: process.env.VOYAGER_URL || "https://voyager-1hpq.onrender.com",
  voyagerAdminKey: process.env.VOYAGER_ADMIN_KEY || "",
  voyagerRpm: Number(process.env.VOYAGER_RPM || 60),
  // Server-side LLM key pools + model lists + daily caps (multiple keys per provider)
  serverKeys: parseServerKeys(),
  serverModels: parseServerModels(),
  dailyCaps: parseDailyCaps(),
  // Paths
  assetsDir: path.resolve(__dirname, "..", "assets"),
  modelsFile: path.resolve(__dirname, "..", "config", "models.yaml"),
  // Limits
  maxToolSteps: 10,
  rateLimitPerMin: 10,
  tavilyUrl: "https://api.tavily.com/search",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1",
};
