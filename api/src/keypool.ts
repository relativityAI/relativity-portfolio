/**
 * Server-side LLM key farm + default-model selection.
 *
 * Providers keyed in env (config.serverKeys) get a pooled set of API keys.
 * Every model call picks a key from the pool (or the user's own key when they
 * configured one) and every call is tallied so the quota-aware default-model
 * algorithm knows which providers/keys are exhausted before choosing one.
 *
 * Usage counters live in process memory (single instance — Render free tier).
 * A throttled background flush persists daily aggregates to the `api_usage`
 * table, which the admin panel reads.
 */
import { getModels } from "./models.js";
import { getDb } from "./db.js";
import { log } from "./logger.js";
import { config, DEFAULT_DAILY_REQUESTS } from "./config.js";

export interface KeyPoolConfig {
  /** provider -> server API keys (ordered; index = keyRef suffix). */
  serverKeys: Record<string, string[]>;
  /** provider -> explicit model ids. Empty for a keyed provider → YAML curated list used. */
  serverModels?: Record<string, string[]>;
  /** provider -> daily request cap for the quota algorithm. */
  dailyCaps?: Record<string, number>;
  /** Optional override of the curated model list per provider (tests). */
  modelsByProvider?: (provider: string) => string[];
  /** Key cooldown after a failure, ms. Default 60s. */
  cooldownMs?: number;
}

export interface PickResult {
  apiKey: string;
  /** "user" | "server:0" | "none" (keyless provider like ollama). */
  keyRef: string;
}

export interface UsageRecord {
  provider: string;
  keyRef: string;
  modelId: string;
  requests?: number;
  tokensIn?: number;
  tokensOut?: number;
  failures?: number;
}

interface KeyUsage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  failures: number;
  lastFailAt: number;
  lastUseSeq: number;
}

interface ProviderState {
  keys: KeyUsage[];
  userRequests: number;
  userFailures: number;
  pickSeq: number;
}

interface UsageRow {
  day: string;
  provider: string;
  key_ref: string;
  model_id: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  failures: number;
}

export class KeyPool {
  private readonly cooldownMs: number;
  private readonly stateMap = new Map<string, ProviderState>();
  private readonly usageKeyMap = new Map<string, UsageRow>();
  private currentDay = "";
  private lastDefault: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly cfg: KeyPoolConfig) {
    this.cooldownMs = cfg.cooldownMs ?? 60_000;
    // Throttled persistence: batch aggregated rows and flush once a minute.
    this.flushTimer = setInterval(() => void this.flushUsage(), 60_000);
    this.flushTimer.unref?.();
  }

  // ── day rollover ─────────────────────────────────────────────────────────
  private day(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  private ensureDay(): void {
    const d = this.day();
    if (d === this.currentDay) return;
    this.currentDay = d;
    this.lastDefault = null;
    for (const st of this.stateMap.values()) {
      st.keys.forEach((k) => {
        k.requests = 0;
        k.tokensIn = 0;
        k.tokensOut = 0;
        k.failures = 0;
        k.lastFailAt = 0;
        k.lastUseSeq = 0;
      });
      st.userRequests = 0;
      st.userFailures = 0;
      st.pickSeq = 0;
    }
  }

  private state(provider: string): ProviderState {
    let st = this.stateMap.get(provider);
    if (!st) {
      const n = this.cfg.serverKeys[provider]?.length || 0;
      st = {
        keys: Array.from({ length: n }, () => ({ requests: 0, tokensIn: 0, tokensOut: 0, failures: 0, lastFailAt: 0, lastUseSeq: 0 })),
        userRequests: 0,
        userFailures: 0,
        pickSeq: 0,
      };
      this.stateMap.set(provider, st);
    }
    return st;
  }

  /** Count per-key/day usage over the server pool (for quota scoring). */
  serverRequests(provider: string): number {
    return this.state(provider).keys.reduce((s, k) => s + k.requests, 0);
  }

  modelProvider(modelId: string): string {
    return modelId.split("/")[0];
  }

  private providersFor(userKeys: Record<string, string | undefined>): string[] {
    const out = new Set<string>();
    for (const p of Object.keys(this.cfg.serverKeys)) if (this.cfg.serverKeys[p]?.length) out.add(p);
    for (const [p, v] of Object.entries(userKeys || {})) {
      if (p !== "tavily" && v && !out.has(p)) out.add(p);
    }
    return [...out];
  }

  // ── key selection (rotation + quota + cooldown) ──────────────────────────
  pickKey(modelId: string, userKeys: Record<string, string | undefined> = {}): PickResult {
    const provider = this.modelProvider(modelId);
    const userKey = userKeys[provider];
    if (userKey) {
      return { apiKey: userKey, keyRef: "user" };
    }
    if (!this.cfg.serverKeys[provider]?.length) {
      // Keyless providers (ollama) need no key; otherwise reject.
      if (provider === "ollama") return { apiKey: "", keyRef: "none" };
      throw new Error(`No API key for "${provider}". Add one in Settings, or pick a different model.`);
    }
    this.ensureDay();
    const st = this.state(provider);
    const pool = this.cfg.serverKeys[provider];
    const cap = this.cfg.dailyCaps?.[provider] ?? DEFAULT_DAILY_REQUESTS[provider];
    const now = Date.now();
    const seq = ++st.pickSeq;

    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const u = st.keys[i];
      const used = u.requests / cap;
      const failPenalty = Math.min(0.5, u.failures / (u.requests + 1));
      const cooldownPenalty = u.lastFailAt && now - u.lastFailAt < this.cooldownMs ? 0.5 : 0;
      // Least-recently-used rotation: the stalest key gets a small bonus so
      // equal-scoring keys round-robin instead of all tying on the lowest index.
      const staleness = (seq - u.lastUseSeq) / seq;
      const score = 1 - used - failPenalty - cooldownPenalty + 0.05 * staleness;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    // Every key is in cooldown (transient outage): degrade gracefully to the
    // least-recently-failed key rather than surfacing a hard error.
    if (best < 0) {
      let oldest = 0;
      for (let i = 1; i < pool.length; i++) {
        if (st.keys[i].lastFailAt < st.keys[oldest].lastFailAt) oldest = i;
      }
      best = oldest;
    }

    st.keys[best].lastUseSeq = seq;
    return { apiKey: pool[best], keyRef: `server:${best}` };
  }

  // ── default model selection (quota + health + priority + rotation) ───────
  private modelsFor(provider: string): string[] {
    if (this.cfg.serverModels?.[provider]?.length) return this.cfg.serverModels[provider];
    if (this.cfg.modelsByProvider) return this.cfg.modelsByProvider(provider);
    return getModels()
      .filter((m) => m.id.split("/")[0] === provider)
      .map((m) => m.id);
  }

  private providerQuota(provider: string): number {
    const cap = this.cfg.dailyCaps?.[provider] ?? DEFAULT_DAILY_REQUESTS[provider];
    return Math.max(0, 1 - this.serverRequests(provider) / cap);
  }

  private providerHealth(provider: string): number {
    const st = this.state(provider);
    const req = this.serverRequests(provider) + st.userRequests;
    const fail = st.keys.reduce((s, k) => s + k.failures, 0) + st.userFailures;
    return 1 - Math.min(0.5, fail / (req + 1));
  }

  /**
   * Algorithm for the default model when the user has not picked one:
   *   priority (curated/env order) + quota remaining + key health + user-key bonus − recency.
   * Higher priority/fresher quota wins; ties rotate away from the last default.
   */
  getDefaultModel(userKeys: Record<string, string | undefined> = {}): string {
    this.ensureDay();
    const providers = this.providersFor(userKeys);
    if (!providers.length) return getModels()[0]?.id || "";

    const hasUser = (p: string) => !!userKeys[p] && p !== "tavily";
    const candidates: string[] = [];
    for (const p of providers) {
      for (const m of this.modelsFor(p)) {
        if (!candidates.includes(m)) candidates.push(m);
      }
    }
    if (!candidates.length) return "";

    let best = "";
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const m = candidates[i];
      const p = this.modelProvider(m);
      const priority = 1 - i / candidates.length;
      const quota = this.providerQuota(p);
      const health = this.providerHealth(p);
      const viaUser = hasUser(p) ? 0.1 : 0;
      const recency = m === this.lastDefault ? 0.05 : 0;
      const score = 0.55 * priority + 0.3 * quota + 0.15 * health + viaUser - recency;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    this.lastDefault = best;
    return best;
  }

  // ── failure + usage accounting ───────────────────────────────────────────
  /** Mark a provider key as failed; puts it in cooldown and tallies a failure. */
  markFailure(provider: string, keyRef: string): void {
    if (keyRef === "none") return;
    this.ensureDay();
    const st = this.state(provider);
    if (keyRef.startsWith("server:")) {
      const i = Number(keyRef.slice("server:".length));
      if (Number.isInteger(i) && i >= 0 && i < st.keys.length) {
        st.keys[i].lastFailAt = Date.now();
      }
    }
    // Counting happens once, in recordUsage.
    this.recordUsage({ provider, keyRef, modelId: "", failures: 1 });
  }

  /** Count a model call and its tokens; persisted (batched) to api_usage. */
  recordUsage(rec: UsageRecord): void {
    this.ensureDay();
    const st = this.state(rec.provider);
    const req = rec.requests || 0;
    const tokensIn = rec.tokensIn || 0;
    const tokensOut = rec.tokensOut || 0;
    const failures = rec.failures || 0;
    if (rec.keyRef === "user") {
      st.userRequests += req;
      st.userFailures += failures;
    } else if (rec.keyRef.startsWith("server:")) {
      const i = Number(rec.keyRef.slice("server:".length));
      if (Number.isInteger(i) && i >= 0 && i < st.keys.length) {
        st.keys[i].requests += req;
        st.keys[i].tokensIn += tokensIn;
        st.keys[i].tokensOut += tokensOut;
        st.keys[i].failures += failures;
      }
    }

    const combos = `${this.currentDay}\u0000${rec.provider}\u0000${rec.keyRef}\u0000${rec.modelId}`;
    const row = this.usageKeyMap.get(combos) as UsageRow | undefined;
    this.usageKeyMap.set(combos, {
      day: this.currentDay,
      provider: rec.provider,
      key_ref: rec.keyRef,
      model_id: rec.modelId,
      requests: (row?.requests || 0) + req,
      tokens_in: (row?.tokens_in || 0) + tokensIn,
      tokens_out: (row?.tokens_out || 0) + tokensOut,
      failures: (row?.failures || 0) + failures,
    } as UsageRow);
  }

  /** Persist batched usage rows to the api_usage table. Fire-and-forget safe. */
  async flushUsage(): Promise<void> {
    if (this.usageKeyMap.size === 0) return this.flushing;
    const run = this.flushing.then(async () => {
      const rows = [...this.usageKeyMap.values()];
      this.usageKeyMap.clear();
      try {
        const { error } = await getDb().from("api_usage").upsert(rows, {
          onConflict: "day,provider,key_ref,model_id",
        });
        if (error) log.warn("[keypool]", `api_usage persist failed: ${error.message}`);
      } catch (e: any) {
        log.warn("[keypool]", `api_usage persist error: ${e?.message || e}`);
        // Keep the rows so a later flush retries them.
        for (const r of rows) this.usageKeyMap.set(`${r.day}\u0000${r.provider}\u0000${r.key_ref}\u0000${r.model_id}`, r);
      }
    });
    this.flushing = run;
    return run;
  }
}

/** Process-wide singleton: pooled server keys + the default-model algorithm. */
export const keyPool = new KeyPool({
  serverKeys: config.serverKeys,
  serverModels: config.serverModels,
  dailyCaps: config.dailyCaps,
});