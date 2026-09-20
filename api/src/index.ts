import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { fetchUserKeys, ensureUserSettings } from "./provision.js";
import { getModelIds, getAvailableModelsForUser } from "./models.js";
import { getSources, searchStocks } from "./discovery.js";
import { getMetricsCatalog, buildFieldList, getFlatCatalog, mergeCatalogFields, normalizeQuantRules, type MetricDef } from "./metrics.js";
import { createRun, checkAndFailStaleRun, type RunRequest } from "./run.js";
import { keyPool } from "./keypool.js";
import { draftParameters, type LlmKeys } from "./agent.js";
import { processBuilderTurn, extractDocumentSignals, type BuilderRequest } from "./builder.js";
import { getSchemaDescriptor } from "./schema.js";
import { getPreset, listPresets, buildSeedAgents } from "./presets.js";
import { agentFromRow, buildAgentConfig, validateConfig, type AgentRow } from "./agentstore.js";
import { parseMd } from "./mdconfig.js";
import { extractText } from "./upload.js";
import { VoyagerClient, toCountrySource } from "./voyager.js";
import multer from "multer";
import { isDataFresh, FRESHNESS_FUNDAMENTAL_MS } from "./freshness.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { log, paint } from "./logger.js";
import { buildReportPdf } from "./pdf.js";
import { initTelemetry } from "./telemetry.js";
import { serve } from "inngest/express";
import { inngest, analysisRunFn } from "./inngest.js";
import { traceHub, nextSeq, type TraceEvent } from "./trace.js";

// Initialize Langfuse telemetry before any AI SDK calls.
await initTelemetry();

const METHOD_COLORS: Record<string, string> = {
  GET: "1;32",
  POST: "1;33",
  PUT: "1;34",
  PATCH: "1;35",
  DELETE: "1;31",
  OPTIONS: "1;36",
};

const normalizeEval = (ev: any): any =>
  ev ? { ...ev, quantitative: normalizeQuantRules(ev.quantitative || []) } : ev;

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

// Inngest endpoint for durable orchestration functions
app.use("/api/inngest", serve({ client: inngest, functions: [analysisRunFn] }));

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
    // Merge instead of replace: llm_keys_encrypted carries unrelated keys (e.g. tavily)
    // plus the client only ever sees masked values, so a full replace would drop or corrupt them.
    if (llm_keys === null) {
      patch.llm_keys_encrypted = {};
    } else if (llm_keys !== undefined && typeof llm_keys === "object") {
      const { data: existing } = await db.from("user_settings").select("llm_keys_encrypted").eq("user_id", userId).single();
      const encrypted: Record<string, string> = { ...((existing?.llm_keys_encrypted as Record<string, string>) || {}) };
      for (const [k, v] of Object.entries(llm_keys as Record<string, string>)) {
        encrypted[k] = v ? encrypt(String(v)) : "";
      }
      patch.llm_keys_encrypted = encrypted;
    }

    const { data } = await db.from("user_settings").select("user_id").eq("user_id", userId).single();
    if (data) {
      await db.from("user_settings").update(patch).eq("user_id", userId);
    } else {
      await db.from("user_settings").insert({ user_id: userId, ...patch });
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/user/settings/llm-key/:keyName", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const keyName = String(req.params.keyName);
    const db = getDb();

    const { data } = await db.from("user_settings").select("llm_keys_encrypted").eq("user_id", userId).single();
    if (!data || !data.llm_keys_encrypted || !data.llm_keys_encrypted[keyName]) {
      return res.status(404).json({ error: "Key not found" });
    }

    const updated = { ...data.llm_keys_encrypted } as Record<string, string>;
    delete updated[keyName];

    await db.from("user_settings").update({ llm_keys_encrypted: updated, updated_at: new Date().toISOString() }).eq("user_id", userId);
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
    const docs = data || [];

    // Plant the built-in default profiles for anyone who doesn't have them yet
    // (unless they deliberately deleted a default). Check the insert error so
    // we never return rows that didn't actually persist — a phantom seed list
    // made fresh accounts show defaults that 404'd on open/save.
    const hasDefault = docs.some((a: any) => a.source === "default");
    if (!hasDefault) {
      const { data: settings } = await db
        .from("user_settings")
        .select("defaults_deleted")
        .eq("user_id", userId)
        .single();
      const defaultsDeleted = settings?.defaults_deleted === true;
      if (!defaultsDeleted) {
        const seeds = buildSeedAgents(userId);
        const { error: insErr } = await db.from("agents").insert(seeds);
        if (insErr) {
          log.error("[agents]", `default agent seeding failed for ${userId}: ${insErr.message}`);
        } else {
          docs.push(...seeds);
        }
      }
    }

    docs.sort((a: any, b: any) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    // Surface parsed markdown content (list omits `md` to keep payloads small).
    res.json(docs.map((row: AgentRow) => ({ ...row, ...(agentFromRow(row).config || {}) })));
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
    res.json((data || []).map((row: AgentRow) => ({ ...row, ...(agentFromRow(row).config || {}) })));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/**
 * Endpoint for the Raw Markdown editor: validate md without saving.
 * Returns { valid, parsed?, issues: [{line, message, severity}] }.
 */
app.post("/agents/validate-md", requireAuth, async (req, res) => {
  try {
    const md = String(req.body?.md || "");
    if (!md.trim()) return res.status(400).json({ valid: false, issues: [{ line: 1, message: "empty markdown", severity: "error" }] });
    const { agent, issues } = parseMd(md);
    if (!agent) return res.json({ valid: false, parsed: null, issues });
    const check = validateConfig(agent);
    const all = check.ok ? issues : check.issues.concat(issues);
    const hasErrors = all.some((i) => i.severity === "error");
    if (hasErrors) return res.json({ valid: false, parsed: agent, issues: all });
    res.json({ valid: true, parsed: agent, issues: all });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/agents", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const id = req.body?.id || req.body?._id || randomUUID();
    let built;
    try {
      built = buildAgentConfig(req.body || {});
    } catch (e: any) {
      if (e.issues) return res.status(400).json({ error: e.message, issues: e.issues });
      throw e;
    }
    const { config, md } = built;
    const now = new Date().toISOString();
    const doc = {
      id,
      user_id: userId,
      name: config.name,
      persona: config.persona,
      configuration: config.configuration,
      asset_evaluation: config.asset_evaluation,
      macro_evaluation: config.macro_evaluation,
      md_config: md,
      created_at: now,
      updated_at: now,
    };
    const { error } = await db.from("agents").insert(doc);
    if (error) throw error;
    res.status(201).json({ ...doc, md, ...config });
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
    // Markdown-first: surface parsed config, the raw md, and any parse warnings.
    const row = data as AgentRow;
    if (row.md_config?.trim()) {
      const { config, issues, md } = agentFromRow(row);
      res.json({ ...row, ...(config || {}), md, md_issues: issues });
    } else {
      row.asset_evaluation = normalizeEval(row.asset_evaluation);
      row.macro_evaluation = normalizeEval(row.macro_evaluation);
      const { md } = agentFromRow(row);
      res.json({ ...row, md, md_issues: [] });
    }
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

    let built;
    try {
      built = buildAgentConfig(req.body || {}, existing as AgentRow);
    } catch (e: any) {
      if (e.issues) {
        console.error("[PUT /agents] 400 – body:", JSON.stringify(req.body, null, 2));
        console.error("[PUT /agents] 400 – issues:", JSON.stringify(e.issues, null, 2));
        return res.status(400).json({ error: e.message, issues: e.issues });
      }
      throw e;
    }
    const { config, issues, md } = built;

    // Pick ONLY valid table columns to prevent PostgREST unknown column errors (503)
    const doc: Record<string, any> = {
      id: existing.id,
      user_id: userId,
      name: config.name,
      persona: config.persona,
      configuration: config.configuration,
      asset_evaluation: config.asset_evaluation,
      macro_evaluation: config.macro_evaluation,
      md_config: md,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await db.from("agents").update(doc).eq("id", id).eq("user_id", userId);
    if (error) throw error;
    res.json({ ...doc, ...config, md, md_issues: issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/agents/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const id = req.params.id;
    // Remember if the user deletes a default profile so it doesn't get
    // re-seeded on the next list fetch ("unless they chose to delete it").
    const { data: existing } = await db.from("agents").select("source").eq("id", id).eq("user_id", userId).single();
    const { error } = await db.from("agents").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    if (existing?.source === "default") {
      const { data: hasRow } = await db.from("user_settings").select("user_id").eq("user_id", userId).single();
      const q = hasRow
        ? db.from("user_settings").update({ defaults_deleted: true }).eq("user_id", userId)
        : db.from("user_settings").insert({ user_id: userId, defaults_deleted: true });
      const { error: setErr } = await q;
      if (setErr) log.error("[agents]", `failed to mark defaults_deleted for ${userId}: ${setErr.message}`);
    }
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
      web_search: body.web_search === undefined ? undefined : !!body.web_search,
      web_sources: Array.isArray(body.web_sources) ? body.web_sources : undefined,
      reqId: (req as any)._reqId,
    };
    const result = await createRun(runReq);
    res.status(202).json(result);
  } catch (e: any) {
    console.error("POST /analysis ERROR:", e);
    res.status(503).json({ error: e.message, stack: e.stack });
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
    const isFresh = await isDataFresh(userId, symbol, cs.source);
    res.json({
      ...data,
      symbol,
      keyed: true,
      is_fresh: isFresh,
      freshness_threshold_ms: FRESHNESS_FUNDAMENTAL_MS,
      pull_supported: cs.source === "nse",
    });
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
    res.status(200).json({
      symbol,
      available: false,
      keyed: true,
      error: message,
      is_fresh: false,
      pull_supported: cs.source === "nse",
    });
  }
});

app.get("/analysis/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    // Fast-path staleness check on every poll
    await checkAndFailStaleRun(String(req.params.id));
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

// Server-generated PDF export of the analysis report (same plots as the UI).
app.get("/analysis/:id/pdf", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("analysis_runs").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Analysis not found" });
    if (!data.quantitative_analysis && !data.qualitative_analysis && !data.report) {
      return res.status(409).json({ error: "No analysis to export" });
    }
    const pdf = await buildReportPdf(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent((data.share_name || data.symbol || "analysis").replace(/\s+/g, "-"))}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (e: any) {
    log.error("[pdf]", e.message);
    res.status(503).json({ error: `PDF generation failed: ${e.message}` });
  }
});

// Live SSE stream of the analysis trace (reasoning thoughts, tool calls,
// decisions) for a single run. Also replays events already buffered.
app.get("/analysis/:id/stream", requireAuth, async (req, res) => {
  const runId = String(req.params.id);
  const db = getDb();
  const { data, error } = await db.from("analysis_runs").select("id").eq("id", runId).eq("user_id", (req as AuthedRequest).user.id).single();
  if (error || !data) return res.status(404).json({ error: "Analysis not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  const unsubscribe = traceHub.subscribe(runId, (event) => send({ type: "trace", event }));
  send({ type: "ready", runId });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

// ---- reference data ----
app.get("/sources", (_req, res) => {
  res.json(getSources());
});

app.get("/models", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    const models = await getAvailableModelsForUser(llmKeys);
    res.json(models);
  } catch (e: any) {
    // Fallback to static list on error
    res.json(getModelIds());
  }
});

// The quota-aware default model for a user with no explicit pick.
app.get("/models/default", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    res.json({ model_id: keyPool.getDefaultModel(llmKeys) });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/models/validate", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const modelId = String(req.body?.model_id || "");
    if (!modelId) {
      return res.status(400).json({ valid: false, error: "model_id is required" });
    }

    const provider = modelId.split("/")[0];
    const { llmKeys } = await fetchUserKeys(userId);

    // Ollama doesn't need a key
    if (provider === "ollama") {
      return res.json({ valid: true });
    }

    // Resolve the key (user key, else server pool) — rejects when no key exists.
    const { apiKey } = keyPool.pickKey(modelId, llmKeys);

    // Try a minimal generateText call to validate the key + model access
    const { buildModel } = await import("./agent.js");
    const { generateText } = await import("ai");
    const model = buildModel(modelId, llmKeys as any, apiKey);
    await generateText({
      model,
      prompt: "Hi",
      maxOutputTokens: 1,
      abortSignal: AbortSignal.timeout(15_000),
    });

    res.json({ valid: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    let error = msg;
    if (/401|unauthorized|invalid.*key/i.test(msg)) {
      error = "API key is invalid or expired.";
    } else if (/403|forbidden|insufficient/i.test(msg)) {
      error = "API key doesn't have access to this model. Check your plan or permissions.";
    } else if (/429|rate.limit|quota/i.test(msg)) {
      error = "Rate limit or quota exceeded for this API key.";
    } else if (/404|not.found|does not exist/i.test(msg)) {
      error = "Model not found. It may have been deprecated or is not available on your plan.";
    } else if (/timeout|abort/i.test(msg)) {
      error = "Validation timed out. The provider may be temporarily unavailable.";
    }
    res.json({ valid: false, error });
  }
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

// ── live metric fields (drives the agent criteria builder) ────────────
const METRIC_FIELDS_TTL_MS = 24 * 60 * 60 * 1000;
// Liquid, long-listed symbols per source — used to discover which fields the
// /financial-metrics snapshot exposes. Falls back through the chain.
const REPRESENTATIVE_SYMBOLS: Record<string, { symbol: string; country: string }[]> = {
  nse: [
    { symbol: "RELIANCE", country: "in" },
    { symbol: "TCS", country: "in" },
  ],
  sec: [
    { symbol: "AAPL", country: "us" },
    { symbol: "MSFT", country: "us" },
  ],
};
const metricFieldsCache = new Map<string, { fields: MetricDef[]; fetched_at: number }>();

async function loadMetricFields(sourceLower: string, userId: string): Promise<MetricDef[]> {
  const cached = metricFieldsCache.get(sourceLower);
  if (cached && Date.now() - cached.fetched_at < METRIC_FIELDS_TTL_MS) return cached.fields;

  let fields: MetricDef[] | null = null;
  const { voyagerKey } = await fetchUserKeys(userId);
  if (voyagerKey) {
    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);
    for (const { symbol } of REPRESENTATIVE_SYMBOLS[sourceLower] || []) {
      try {
        const sample = await voyager.get("/financial-metrics", {
          symbol,
          source: sourceLower,
          consolidated: true,
          filing_type: "ttm",
        });
        const list = buildFieldList(sample);
        if (list.length > 0) {
          fields = list;
          break;
        }
      } catch {
        // try next representative symbol
      }
    }
  }
  if (!fields) fields = getFlatCatalog();
  fields = mergeCatalogFields(fields);
  metricFieldsCache.set(sourceLower, { fields, fetched_at: Date.now() });
  return fields;
}

app.get("/metrics/fields", requireAuth, async (req, res) => {
  try {
    const source = String(req.query.source || "NSE").toLowerCase();
    const userId = (req as AuthedRequest).user.id;
    res.json({ fields: await loadMetricFields(source, userId) });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ── builder agent routes ──────────────────────────────────────────────

app.get("/agent-schema", (_req, res) => {
  res.json(getSchemaDescriptor());
});

app.get("/builder/presets", (_req, res) => {
  res.json(listPresets());
});

app.get("/builder/preset/:key", (req, res) => {
  const preset = getPreset(req.params.key);
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json(preset);
});

app.post("/builder/draft", requireAuth, async (req, res) => {
  let requestedModel = "";
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);

    const body = req.body || {};
    requestedModel = body.model_id || keyPool.getDefaultModel(llmKeys);

    const builderReq: BuilderRequest = {
      session_id: body.session_id ? String(body.session_id) : undefined,
      user_id: userId,
      model_id: requestedModel,
      llm_keys: llmKeys as LlmKeys,
      messages: Array.isArray(body.messages) ? body.messages : [],
      agent_draft: body.agent_draft || {},
      metrics: Array.isArray(body.metrics) ? body.metrics : [],
      document_texts: Array.isArray(body.document_texts) ? body.document_texts : [],
      user_response: body.user_response || undefined,
    };

    // Stream the turn's trace events (thinking, tool calls) to the same SSE hub
    // the analysis pipeline uses, so the builder UI shows live agent activity.
    const builderSessionKey = builderReq.session_id ? `builder:${builderReq.session_id}` : undefined;
    if (builderSessionKey) traceHub.reset(builderSessionKey);
    const response = await processBuilderTurn(builderReq, {
      onTrace: (ev) => {
        if (!builderSessionKey) return;
        const base = { seq: nextSeq(), ts: Date.now(), key: "builder" } as const;
        const emit = (event: TraceEvent) => traceHub.publish(builderSessionKey, event);
        switch (ev.type) {
          case "thought":
            emit({ ...base, type: "thought", text: ev.text });
            break;
          case "tool_call":
            emit({ ...base, type: "tool_call", tool: ev.tool, args: ev.args });
            break;
          case "tool_result":
            emit({ ...base, type: "tool_result", tool: ev.tool, status: ev.status, result: ev.result, duration_ms: ev.duration_ms });
            break;
          case "decision":
            emit({ ...base, type: "decision", score: ev.score, text: ev.text });
            break;
        }
      },
    });
    if (builderSessionKey) {
      traceHub.publish(builderSessionKey, {
        seq: nextSeq(), ts: Date.now(), type: "log", key: "builder", text: "turn complete",
      });
    }
    res.json(response);
  } catch (e: any) {
    console.error("[builder/draft] FAILED:", e?.name, e?.message);
    if (e?.cause) console.error("[builder/draft] cause:", e.cause?.message || e.cause);
    if (e?.stack) console.error("[builder/draft] stack:", e.stack);
    const detail = e?.message || "Builder draft failed";
    res.status(502).json({ error: `Model "${requestedModel}": ${detail}` });
  }
});

// Live SSE stream of the builder agent's trace events (thinking, tool calls)
// for one conversational session. Replays events already buffered.
app.get("/builder/:sessionId/stream", requireAuth, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const key = `builder:${sessionId}`;
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  const unsubscribe = traceHub.subscribe(key, (event) => send({ type: "trace", event }));
  send({ type: "ready", sessionId });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/builder/upload", requireAuth, upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const results = await Promise.all(
      files.map((f) => extractText(f.buffer, f.originalname, f.mimetype)),
    );
    res.json({ documents: results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Document extraction failed" });
  }
});

app.post("/builder/extract-signals", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    const modelId = keyPool.getDefaultModel(llmKeys);

    const documents = req.body?.documents;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "No documents provided" });
    }

    const signals = await extractDocumentSignals(modelId, llmKeys as LlmKeys, documents);
    res.json(signals);
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "Signal extraction failed" });
  }
});

// Draft qualitative parameters from an investor's persona text via their LLM key.
app.post("/agents/draft-parameters", requireAuth, async (req, res) => {
  try {
    const persona = String(req.body?.persona || "").trim();
    if (!persona) {
      return res.status(400).json({
        error: "Write your Philosophy & Mindset first — drafts are generated from it.",
      });
    }
    const { llmKeys } = await fetchUserKeys((req as AuthedRequest).user.id);
    // Quota-aware default: server farm if available, else the user's key, else curated list.
    const modelId = keyPool.getDefaultModel(llmKeys);
    const section = req.body?.section === "macro_evaluation" ? "macro_evaluation" : "asset_evaluation";
    const count = Math.min(Math.max(Number(req.body?.count) || 5, 1), 8);
    const parameters = await draftParameters(modelId, llmKeys as LlmKeys, persona, section, count);
    res.json({ parameters });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "Draft generation failed" });
  }
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
