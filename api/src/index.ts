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

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const t = Date.now();
  res.on("finish", () => {
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t}ms)`);
  });
  next();
});

// ---- simple per-IP rate limiter (agent runs are token-heavy) ----
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
app.use((req, _res, next) => {
  if (req.method === "OPTIONS") return next();
  if (!req.path.startsWith("/analysis")) return next();
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

// ---- profiles ----
app.get("/profiles", async (_req, res) => {
  try {
    const docs = await db().collection("profiles").find().toArray();
    docs.sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    res.json(docs.map(toPlain));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/profiles/search", async (req, res) => {
  try {
    const q = String(req.query.query || "");
    const docs = await db()
      .collection("profiles")
      .find({ name: { $regex: q, $options: "i" } })
      .limit(25)
      .toArray();
    res.json(docs.map(toPlain));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/profiles", async (req, res) => {
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
    await db().collection("profiles").insertOne(doc);
    res.status(201).json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/profiles/:id", async (req, res) => {
  try {
    const doc = await db().collection("profiles").findOne(idFilter(req.params.id));
    if (!doc) return res.status(404).json({ error: "Profile not found" });
    res.json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/profiles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filter = idFilter(id);
    const existing = await db().collection("profiles").findOne(filter);
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    const { _id, id: _id2, created_at, ...rest } = req.body || {};
    const doc = {
      ...existing,
      ...rest,
      _id: existing._id,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db().collection("profiles").replaceOne(filter as any, doc);
    res.json(toPlain(doc));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/profiles/:id", async (req, res) => {
  try {
    await db().collection("profiles").deleteOne(idFilter(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- analysis runs ----
app.post("/analysis", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.symbol || !body.profile_name) {
      return res.status(400).json({ error: "symbol and profile_name are required" });
    }
    const runReq: RunRequest = {
      symbol: String(body.symbol),
      share_name: body.share_name ? String(body.share_name) : undefined,
      profile_name: String(body.profile_name),
      model: body.model ? String(body.model) : undefined,
      documents: Array.isArray(body.documents) ? body.documents : undefined,
      web_search: !!body.web_search,
      web_sources: Array.isArray(body.web_sources) ? body.web_sources : undefined,
      voyagerUrl: voyagerUrl(req),
      keys: extractKeys(req),
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
        profile_name: 1,
        profile: 1,
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
  console.log(`[api] listening on :${config.port}`);
  try {
    await connectDb();
    console.log("[api] mongodb connected");
  } catch (e) {
    console.warn("[api] mongodb NOT connected:", (e as Error).message);
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
