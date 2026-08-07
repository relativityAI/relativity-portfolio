import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { connectDb, db, toPlain } from "./db.js";
import { getModelIds } from "./models.js";
import { getSources, searchStocks } from "./discovery.js";
import { getMetricsCatalog } from "./metrics.js";
import { createRun, RunRequest } from "./run.js";
import type { LlmKeys } from "./agent.js";
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
    const keys = Object.entries(extractKeys(req))
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(",");
    const voyager = (req.headers["x-voyager-url"] as string)?.trim() ? "custom" : "default";

    const parts = [
      paint(req.method, methodColor(req.method)),
      req.originalUrl,
      "->",
      paint(String(res.statusCode), statusColor(res.statusCode)),
      paint(`(${ms}ms, ${bytes ? (bytes / 1024).toFixed(1) + "KB" : "no body"})`, ms >= 1000 ? "1;33" : "2"),
      paint(`ip=${req.ip || "-"}`, "2"),
      paint(`keys=${keys || "none"}`, "2"),
      paint(`voyager=${voyager}`, "2"),
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
// Only POST /analysis creates a token-heavy run; reads/polls must not be
// throttled or the UI's status polling exhausts the budget immediately.
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

function extractKeys(req: express.Request): LlmKeys {
  const h = req.headers;
  return {
    openai: (h["x-llm-openai-key"] as string) || undefined,
    gemini: (h["x-llm-gemini-key"] as string) || undefined,
    anthropic: (h["x-llm-anthropic-key"] as string) || undefined,
    cerebras: (h["x-llm-cerebras-key"] as string) || undefined,
    groq: (h["x-llm-groq-key"] as string) || undefined,
    tavily: (h["x-llm-tavily-key"] as string) || undefined,
  };
}

function voyagerUrl(req: express.Request): string {
  const header = req.headers["x-voyager-url"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return config.voyagerUrl;
}

// Match a doc by string id, ObjectId-hex id, or legacy analysis_id.
function idFilter(id: string): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ analysis_id: id }, { _id: id }];
  if (/^[0-9a-fA-F]{24}$/.test(id)) conditions.push({ _id: new ObjectId(id) });
  return { $or: conditions };
}

// ---- health ----
app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await db().command({ ping: 1 });
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.json({ ok: 1, db: dbOk });
});

app.get("/health/voyager", async (req, res) => {
  const base = voyagerUrl(req).replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/list`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    res.json({ ok: r.ok });
  } catch {
    res.json({ ok: false });
  }
});

// ---- agents ----
app.get("/agents", async (_req, res) => {
  try {
    const docs = await db().collection("agents").find().toArray();
    docs.sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    res.json(docs.map(toPlain));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/agents/search", async (req, res) => {
  try {
    const q = String(req.query.query || "");
    const docs = await db()
      .collection("agents")
      .find({ name: { $regex: q, $options: "i" } })
      .limit(25)
      .toArray();
    res.json(docs.map(toPlain));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/agents", async (req, res) => {
  try {
    const doc = {
      _id: undefined as any,
      name: String(req.body?.name || ""),
      source: req.body?.source || "",
      persona: req.body?.persona || {},
      configuration: req.body?.configuration || {},
      asset_evaluation: req.body?.asset_evaluation || { qualitative: [], quantitative: [] },
      macro_evaluation: req.body?.macro_evaluation || { qualitative: [], quantitative: [] },
      created_at: new Date().toISOString(),
    };
    const id = doc._id ?? randomUUID();
    doc._id = id;
    await db().collection("agents").insertOne(doc);
    res.status(201).json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/agents/:id", async (req, res) => {
  try {
    const doc = await db().collection("agents").findOne(idFilter(req.params.id));
    if (!doc) return res.status(404).json({ error: "Agent not found" });
    res.json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/agents/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filter = idFilter(id);
    const existing = await db().collection("agents").findOne(filter);
    if (!existing) return res.status(404).json({ error: "Agent not found" });
    const { _id, id: _id2, created_at, ...rest } = req.body || {};
    const doc = {
      ...existing,
      ...rest,
      _id: existing._id,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db().collection("agents").replaceOne(filter as any, doc);
    res.json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/agents/:id", async (req, res) => {
  try {
    await db().collection("agents").deleteOne(idFilter(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- analysis runs ----
app.post("/analysis", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.symbol || !body.agent_name) {
      return res.status(400).json({ error: "symbol and agent_name are required" });
    }
    const runReq: RunRequest = {
      symbol: String(body.symbol),
      share_name: body.share_name ? String(body.share_name) : undefined,
      agent_name: String(body.agent_name),
      model: body.model ? String(body.model) : undefined,
      source: body.source ? String(body.source) : undefined,
      documents: Array.isArray(body.documents) ? body.documents : undefined,
      web_search: !!body.web_search,
      web_sources: Array.isArray(body.web_sources) ? body.web_sources : undefined,
      voyagerUrl: voyagerUrl(req),
      keys: extractKeys(req),
      reqId: (req as any)._reqId,
    };
    const result = await createRun(runReq);
    res.status(202).json(result);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/analysis", async (_req, res) => {
  try {
    const docs = await db()
      .collection("analysis_runs")
      .find()
      .project({
        _id: 1,
        analysis_id: 1,
        symbol: 1,
        share_name: 1,
        agent_name: 1,
        agent: 1,
        status: 1,
        total_score: 1,
        quantitative_score: 1,
        qualitative_score: 1,
        created_at: 1,
        updated_at: 1,
        duration: 1,
        model: 1,
        source: 1,
        error: 1,
      })
      .toArray();
    docs.sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    res.json(docs.map(toPlain));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/analysis/:id", async (req, res) => {
  try {
    const doc = await db().collection("analysis_runs").findOne(idFilter(req.params.id));
    if (!doc) return res.status(404).json({ error: "Analysis not found" });
    res.json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/analysis/:id", async (req, res) => {
  try {
    await db().collection("analysis_runs").deleteOne(idFilter(req.params.id));
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
    `config: mongo=${config.mongodbUrl} db=${config.mongodbDb} voyager=${config.voyagerUrl} rateLimit=${config.rateLimitPerMin}/min logLevel=${process.env.LOG_LEVEL || "info"}`,
  );
  try {
    await connectDb();
    log.info("[api]", "mongodb connected");
  } catch (e) {
    log.warn("[api]", "mongodb NOT connected:", (e as Error).message);
  }
});

async function shutdown() {
  try {
    server.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
