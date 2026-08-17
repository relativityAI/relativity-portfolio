import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { getModelIds } from "./models.js";
import { getSources, searchStocks } from "./discovery.js";
import { getMetricsCatalog } from "./metrics.js";
import { createRun, RunRequest } from "./run.js";
import { VoyagerClient, toCountrySource } from "./voyager.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { log, paint } from "./logger.js";

const METHOD_COLORS: Record<string, string> = {
  GET: "1;32",
  POST: "1;33",
  PUT: "1;34",
  PATCH: "1;35",
  DELETE: "1;31",
  OPTIONS: "1;36",
};

function methodColor(method: string): string {
  return METHOD_COLORS[method] || "37";
}

function statusColor(code: number): string {
  if (code >= 500) return "1;31";
  if (code >= 400) return "1;33";
  if (code >= 300) return "36";
  return "1;32";
}

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ---- request context: id + response-body capture (for error logging) ----
app.use((req, res, next) => {
  (req as any)._reqId = randomUUID().slice(0, 8);
  res.setHeader("X-Rel-Request-Id", (req as any)._reqId);

  const json = res.json.bind(res);
  (res as any).json = (body: unknown) => {
    (res as any)._jsonBody = body;
    return json(body);
  };
  next();
});

// ---- access log: every call, every detail ----
app.use((req, res, next) => {
  const t = Date.now();
  res.on("finish", () => {
    const reqId = (req as any)._reqId || "-";
    const ms = Date.now() - t;
    const bytes = Number(res.getHeader("content-length") || 0);

    const parts = [
      paint(req.method, methodColor(req.method)),
      req.originalUrl,
      "->",
      paint(String(res.statusCode), statusColor(res.statusCode)),
      paint(`(${ms}ms, ${bytes ? (bytes / 1024).toFixed(1) + "KB" : "no body"})`, ms >= 1000 ? "1;33" : "2"),
      paint(`ip=${req.ip || "-"}`, "2"),
    ];

    if (req.method === "POST" && req.path === "/analysis") {
      const b = req.body || {};
      parts.push(
        paint(
          `body=${JSON.stringify({
            symbol: b.symbol,
            share_name: b.share_name,
            agent_name: b.agent_name,
            model: b.model,
            web_search: !!b.web_search,
            documents: (b.documents || []).length,
            web_sources: (b.web_sources || []).length,
          })}`,
          "36",
        ),
      );
    }

    const msg = parts.join(" ");

    if (res.statusCode >= 400) {
      const resp = (res as any)._jsonBody;
      const errStr = resp ? JSON.stringify(resp) : "";
      log.error(`[http:${reqId}]`, `${msg}${errStr ? ` ${paint(`resp=${errStr.slice(0, 500)}`, "1;35")}` : ""}`);
    } else {
      log.info(`[http:${reqId}]`, msg);
    }
  });
  next();
});

// ---- simple per-IP rate limiter (agent runs are token-heavy) ----
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
app.use((req, _res, next) => {
  if (req.method === "OPTIONS") return next();
  if (req.method !== "POST" || req.path !== "/analysis") return next();
  const ip = req.ip || "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= config.rateLimitPerMin) {
    _res.status(429).json({ error: `Rate limit reached (${config.rateLimitPerMin}/min)` });
    return;
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
});

// ── helpers ────────────────────────────────────────────────────────────

/** Fetch decrypted user settings (Voyager + LLM keys) from Supabase. */
async function fetchUserKeys(userId: string): Promise<{ voyagerKey: string; llmKeys: Record<string, string> }> {
  const db = getDb();
  const { data } = await db.from("user_settings").select("voyager_key_encrypted, llm_keys_encrypted").eq("user_id", userId).single();
  if (!data) return { voyagerKey: "", llmKeys: {} };
  let voyagerKey = "";
  try {
    voyagerKey = data.voyager_key_encrypted ? decrypt(data.voyager_key_encrypted) : "";
  } catch { voyagerKey = ""; }
  let llmKeys: Record<string, string> = {};
  if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
    for (const [k, v] of Object.entries(data.llm_keys_encrypted as Record<string, string>)) {
      try { llmKeys[k] = decrypt(v); } catch { llmKeys[k] = ""; }
    }
  }
  return { voyagerKey, llmKeys };
}

/** Auto-provision a Voyager key for a new user via Voyager's admin API. */
async function provisionVoyagerKey(userId: string): Promise<string | null> {
  if (!config.voyagerAdminKey) {
    log.warn("[provision]", "VOYAGER_ADMIN_KEY not set, skipping auto-provision");
    return null;
  }
  try {
    const res = await fetch(`${config.voyagerUrl}/admin/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.voyagerAdminKey },
      body: JSON.stringify({ label: `user:${userId}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.error("[provision]", `Voyager key provision failed: ${res.status}`);
      return null;
    }
    const { key } = await res.json() as { key: string };
    return key || null;
  } catch (e: any) {
    log.error("[provision]", `Voyager key provision error: ${e.message}`);
    return null;
  }
}

/** Ensure user_settings row exists; auto-provision Voyager key on first login. */
async function ensureUserSettings(userId: string): Promise<void> {
  const db = getDb();
  const { data } = await db.from("user_settings").select("user_id").eq("user_id", userId).single();
  if (data) return;
  const voyagerKey = await provisionVoyagerKey(userId);
  await db.from("user_settings").insert({
    user_id: userId,
    voyager_key_encrypted: voyagerKey ? encrypt(voyagerKey) : null,
    llm_keys_encrypted: {},
  });
  log.info("[provision]", `Created user_settings for ${userId} (voyager=${voyagerKey ? "provisioned" : "pending"})`);
}

// ── routes ─────────────────────────────────────────────────────────────

// ---- health ----
app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    const db = getDb();
    const { error } = await db.from("agents").select("id").limit(1);
    dbOk = !error;
  } catch {
    dbOk = false;
  }
  res.json({ ok: 1, db: dbOk });
});

app.get("/health/voyager", requireAuth, async (req, res) => {
  const base = config.voyagerUrl.replace(/\/+$/, "");
  const { voyagerKey } = await fetchUserKeys((req as AuthedRequest).user.id);
  const keyed = !!voyagerKey;
  try {
    const r = await fetch(`${base}/healthz`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    res.json({ ok: r.ok, base, keyed });
  } catch {
    res.json({ ok: false, base, keyed });
  }
});

// ── user settings (encrypted API keys) ────────────────────────────────

app.get("/user/settings", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const db = getDb();
    const { data } = await db.from("user_settings").select("voyager_key_encrypted, llm_keys_encrypted").eq("user_id", userId).single();
    if (!data) return res.json({ voyager_key: null, llm_keys: {} });

    let voyagerKeyMasked: string | null = null;
    if (data.voyager_key_encrypted) {
      try {
        const raw = decrypt(data.voyager_key_encrypted);
        voyagerKeyMasked = raw.length > 8 ? raw.slice(0, 3) + "****" + raw.slice(-4) : "****";
      } catch { voyagerKeyMasked = "****"; }
    }

    const llmKeysMasked: Record<string, string> = {};
    if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
      for (const [k, v] of Object.entries(data.llm_keys_encrypted as Record<string, string>)) {
        try {
          const raw = decrypt(v);
          llmKeysMasked[k] = raw.length > 8 ? raw.slice(0, 3) + "****" + raw.slice(-4) : "****";
        } catch { llmKeysMasked[k] = "****"; }
      }
    }

    res.json({ voyager_key: voyagerKeyMasked, llm_keys: llmKeysMasked });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/user/settings", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { voyager_key, llm_keys } = req.body || {};
    const db = getDb();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (voyager_key !== undefined) {
      patch.voyager_key_encrypted = voyager_key ? encrypt(String(voyager_key)) : null;
    }
    if (llm_keys !== undefined && typeof llm_keys === "object") {
      const encrypted: Record<string, string> = {};
      for (const [k, v] of Object.entries(llm_keys as Record<string, string>)) {
        encrypted[k] = v ? encrypt(String(v)) : "";
      }
      patch.llm_keys_encrypted = encrypted;
    }

    const { data: existing } = await db.from("user_settings").select("user_id").eq("user_id", userId).single();
    if (existing) {
      await db.from("user_settings").update(patch).eq("user_id", userId);
    } else {
      await db.from("user_settings").insert({ user_id: userId, ...patch });
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- agents (authenticated, scoped to the signed-in user) ----
app.get("/agents", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("agents").select("*").eq("user_id", userId);
    if (error) throw error;
    const docs = (data || []).sort((a: any, b: any) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    res.json(docs);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/agents/search", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const q = String(req.query.query || "");
    const { data, error } = await db.from("agents").select("*").eq("user_id", userId).ilike("name", `%${q}%`).limit(25);
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/agents", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const id = randomUUID();
    const doc = {
      id,
      user_id: userId,
      name: String(req.body?.name || ""),
      source: req.body?.source || "NSE",
      persona: req.body?.persona || {},
      configuration: req.body?.configuration || {},
      asset_evaluation: req.body?.asset_evaluation || { qualitative: [], quantitative: [] },
      macro_evaluation: req.body?.macro_evaluation || { qualitative: [], quantitative: [] },
      created_at: new Date().toISOString(),
    };
    const { error } = await db.from("agents").insert(doc);
    if (error) throw error;
    res.status(201).json(doc);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/agents/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("agents").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Agent not found" });
    res.json(data);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/agents/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const id = req.params.id;
    const { data: existing, error: fetchErr } = await db.from("agents").select("*").eq("id", id).eq("user_id", userId).single();
    if (fetchErr || !existing) return res.status(404).json({ error: "Agent not found" });
    const { id: _id, _id: __id, user_id: _uid, created_at: _ca, ...rest } = req.body || {};
    const doc = {
      ...existing,
      ...rest,
      id: existing.id,
      user_id: userId,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("agents").update(doc).eq("id", id).eq("user_id", userId);
    if (error) throw error;
    res.json(doc);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/agents/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { error } = await db.from("agents").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- analysis runs (authenticated, scoped to the signed-in user) ----
app.post("/analysis", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.symbol || !body.agent_name) {
      return res.status(400).json({ error: "symbol and agent_name are required" });
    }
    const userId = (req as AuthedRequest).user.id;
    const { voyagerKey, llmKeys } = await fetchUserKeys(userId);
    const runReq: RunRequest = {
      userId,
      symbol: String(body.symbol),
      share_name: body.share_name ? String(body.share_name) : undefined,
      agent_name: String(body.agent_name),
      model: body.model ? String(body.model) : undefined,
      source: body.source ? String(body.source) : undefined,
      documents: Array.isArray(body.documents) ? body.documents : undefined,
      web_search: !!body.web_search,
      web_sources: Array.isArray(body.web_sources) ? body.web_sources : undefined,
      reqId: (req as any)._reqId,
    };
    const result = await createRun(runReq);
    res.status(202).json(result);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/analysis", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db
      .from("analysis_runs")
      .select("id, symbol, share_name, agent_name, status, total_score, quantitative_score, qualitative_score, created_at, updated_at, duration, model, source, error")
      .eq("user_id", userId);
    if (error) throw error;
    const docs = (data || []).sort((a: any, b: any) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    res.json(docs);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Read-only Voyager pull status / data availability for a stock.
app.get("/analysis/data-status", requireAuth, async (req, res) => {
  const symbol = String(req.query.symbol || "");
  const source = String(req.query.source || "NSE");
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  const userId = (req as AuthedRequest).user.id;
  const { voyagerKey: key } = await fetchUserKeys(userId);
  if (!key) {
    return res.json({
      symbol,
      available: false,
      keyed: false,
      error: "No Voyager API key configured. A key will be generated automatically on your first login.",
    });
  }
  const cs = toCountrySource(source);
  const voyager = new VoyagerClient(config.voyagerUrl, key, config.voyagerRpm);
  try {
    const data = await voyager.getPullStatus(symbol, cs.country, cs.source);
    res.json({ ...data, symbol, keyed: true });
  } catch (e: any) {
    const status = e?.status;
    const message =
      status === 401
        ? "Voyager API key is invalid or expired."
        : status === 403
          ? "Insufficient permission: the Voyager key needs the data:read scope."
          : status === 429
            ? "Rate limit exceeded for the Voyager API key."
            : `Voyager data check failed: ${e?.message || String(e)}`;
    res.status(200).json({ symbol, available: false, keyed: true, error: message });
  }
});

app.get("/analysis/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("analysis_runs").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Analysis not found" });
    res.json(data);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/analysis/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { error } = await db.from("analysis_runs").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- reference data ----
app.get("/sources", (_req, res) => {
  res.json(getSources());
});

app.get("/models", (_req, res) => {
  res.json(getModelIds());
});

app.get("/stocks/search", (req, res) => {
  const q = String(req.query.query || "");
  const source = String(req.query.source || "");
  res.json(searchStocks(q, source || undefined));
});

app.get("/metrics", (req, res) => {
  const source = String(req.query.source || "");
  res.json(getMetricsCatalog(source || undefined));
});

const server = app.listen(config.port, async () => {
  log.info("[api]", `listening on :${config.port}`);
  log.info(
    "[api]",
    `config: supabase=${config.supabaseUrl ? "set" : "unset"} voyager=${config.voyagerUrl} rateLimit=${config.rateLimitPerMin}/min logLevel=${process.env.LOG_LEVEL || "info"}`,
  );
});

async function shutdown() {
  try {
    server.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
