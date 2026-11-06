import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { fetchUserKeys, ensureUserSettings } from "./provision.js";
import { getModelIds, getAvailableModelsForUser } from "./models.js";
import { getSources, searchStocks } from "./discovery.js";
import { tickerLogoUrl } from "./tickerLogos.js";
import { getMetricsCatalog, buildFieldList, getFlatCatalog, mergeCatalogFields, normalizeQuantRules, type MetricDef } from "./metrics.js";
import { keyPool } from "./keypool.js";
import { buildModel, draftParameters, type LlmKeys } from "./agent.js";
import { classifyModelError } from "./modelcheck.js";
import { processBuilderTurn, extractDocumentSignals, type BuilderRequest } from "./builder.js";
import { getSchemaDescriptor } from "./schema.js";
import { getToolCatalog } from "./tools.js";
// Artifact files (src/skills/artifacts/{index,xlsx}.ts) are mid-write by a
// sibling session; import them lazily so a missing builder can't take the
// whole server down. Restore static imports when they land.
// ponytail: per-call dynamic import (uncached, unbundled) only on the two
// artifact paths — loader runs once per request, not in a hot loop.
import type { WorkbookRecipe } from "./skills/artifacts/types.js";
import { getPreset, listPresets } from "./presets.js";
import { agentFromRow, buildAgentConfigV3, type AgentRow } from "./agentstore.js";
import { fixAgentMarkdown, parseAgentMd, serializeAgentMd, validateAgentV3 } from "./agentmd.js";
import { listAllSkillsForUser, saveCustomSkill, deleteCustomSkill, loadBuiltinSkills, serializeSkill, normalizeSkillFiles, getBuiltinSkillFiles, getCustomSkillFiles, type SkillFiles } from "./skills/store.js";
import { fixSkillMarkdown, parseSkillMarkdown, slugifySkillName } from "./skills/parse.js";
import { fetchSkillMarkdown, listRepoSkills, listSkillRepos, resolveSkillPath } from "./skills/repos.js";
import { skillDraftTurn, type SkillDraftRequest } from "./skills/draft.js";
import {
  // Harness module — one interface (see src/harness/index.ts).
  listAgents as listHarnessAgents,
  createAgent as createHarnessAgent,
  updateAgent as updateHarnessAgent,
  deleteAgent as deleteHarnessAgent,
  getAgent as getHarnessAgent,
  DEFAULT_HARNESS_AGENT,
  loadOutputTemplates,
  type ReportDocument,
  type Verdict,
} from "./harness/index.js";
import { installHarnessAdapters, harnessToView, viewToHarnessPatch } from "./harness-adapters.js";
import { runHarnessSymbol, startStaleRunSweeper } from "./runs.js";
import { extractText } from "./upload.js";
import { VoyagerClient, toCountrySource } from "./voyager.js";
import multer from "multer";
import { isDataFresh, FRESHNESS_FUNDAMENTAL_MS } from "./freshness.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { log, paint } from "./logger.js";
import { buildReportPdf, isUuid } from "./pdf.js";
import { initTelemetry } from "./telemetry.js";
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

// Harness persistence: install the Supabase adapters (agent/skill
// repositories) before any route can serve a request.
installHarnessAdapters();

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

    // Keep the access log out of the default INFO stream — the UI polls
    // /health and friends constantly. Errors always log; slow calls log at
    // INFO; routine 2xx/3xx only surface with LOG_LEVEL=debug.
    if (res.statusCode >= 400) {
      const resp = (res as any)._jsonBody;
      const errStr = resp ? JSON.stringify(resp) : "";
      log.error(`[http:${reqId}]`, `${msg}${errStr ? ` ${paint(`resp=${errStr.slice(0, 500)}`, "1;35")}` : ""}`);
    } else if (ms >= 1000) {
      log.info(`[http:${reqId}]`, msg);
    } else {
      log.debug(`[http:${reqId}]`, msg);
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
/* ── Console agent CRUD — harness-native ───────────────────────────────────
 * Harness agents live in the same `agents` table, flagged by
 * configuration.harness_version. These endpoints project a harness definition
 * into the shape the console expects (persona.philosophy, skills[]) and route
 * writes back into `configuration`, so the console edits the new format with
 * no separate data path. Legacy v3 rows stay readable via the fallbacks. */

app.get("/agents", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    let agents = await listHarnessAgents(userId);
    if (agents.length === 0) {
      await createHarnessAgent(userId, DEFAULT_HARNESS_AGENT);
      agents = await listHarnessAgents(userId);
    }
    agents.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0));
    res.json(agents.map(harnessToView));
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
    const out = [];
    for (const row of (data || []) as AgentRow[]) {
      const { config } = await agentFromRow(row);
      out.push({ ...row, ...(config || {}) });
    }
    res.json(out);
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
    const { agent, issues } = parseAgentMd(md);
    if (!agent) {
      return res.json({
        valid: false,
        parsed: null,
        issues,
        fixed: issues.some((i) => i.severity === "error") ? fixAgentMarkdown(md) : null,
      });
    }
    const check = validateAgentV3(agent);
    const all = check.ok ? issues : check.issues.concat(issues);
    const hasErrors = all.some((i) => i.severity === "error");
    res.json({
      valid: !hasErrors,
      parsed: agent,
      issues: all,
      fixed: hasErrors ? fixAgentMarkdown(md) : null,
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/agents", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const patch = viewToHarnessPatch(req.body || {});
    const created = await createHarnessAgent(userId, {
      name: patch.name || "Untitled Agent",
      soulPrompt: patch.soulPrompt,
      skillIds: patch.skillIds,
      allowedTools: patch.allowedTools,
      modelId: patch.modelId,
      outputTemplateId: patch.outputTemplateId ?? null,
    });
    res.status(201).json(harnessToView(created));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/agents/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const harness = await getHarnessAgent(userId, String(req.params.id));
    if (harness) return res.json(harnessToView(harness));
    // Legacy fallback: markdown-first v3 config for pre-harness rows.
    const db = getDb();
    const { data, error } = await db.from("agents").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Agent not found" });
    const row = data as AgentRow;
    const { config, issues, md } = await agentFromRow(row);
    res.json({ ...row, ...(config || {}), md, md_issues: issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/agents/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);

    // Harness rows write straight back into `configuration`.
    const harness = await getHarnessAgent(userId, id);
    if (harness) {
      const updated = await updateHarnessAgent(userId, id, viewToHarnessPatch(req.body || {}));
      if (!updated) return res.status(404).json({ error: "Agent not found" });
      return res.json(harnessToView(updated));
    }

    const db = getDb();
    const { data: existing, error: fetchErr } = await db.from("agents").select("*").eq("id", id).eq("user_id", userId).single();
    if (fetchErr || !existing) return res.status(404).json({ error: "Agent not found" });

    let built;
    try {
      built = buildAgentConfigV3(req.body || {}, existing as AgentRow);
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
    const { data: existing } = await db.from("agents").select("source, preset_key").eq("id", id).eq("user_id", userId).single();
    const { error } = await db.from("agents").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    if (existing?.source === "default") {
      // Scope the suppression to the deleted preset only. The old boolean flag
      // nuked ALL four presets on any single delete — irreversible and
      // undisclosed. Re-seeding is per-preset below; this just records intent.
      const presetKey = String(existing.preset_key || "");
      const { data: settings } = await db
        .from("user_settings")
        .select("defaults_deleted, deleted_preset_keys")
        .eq("user_id", userId)
        .single();
      const prior: string[] = Array.isArray(settings?.deleted_preset_keys) ? settings.deleted_preset_keys : [];
      const deletedKeys = prior.includes(presetKey) && presetKey ? prior : [...prior, presetKey].filter(Boolean);
      const patch: Record<string, unknown> = { deleted_preset_keys: deletedKeys };
      // Back-compat: also set the legacy boolean once every preset is gone, so
      // a pre-migration server reading only `defaults_deleted` still behaves.
      if (deletedKeys.length >= 4) patch.defaults_deleted = true;
      const { data: hasRow } = await db.from("user_settings").select("user_id").eq("user_id", userId).single();
      const q = hasRow
        ? db.from("user_settings").update(patch).eq("user_id", userId)
        : db.from("user_settings").insert({ user_id: userId, ...patch });
      const { error: setErr } = await q;
      if (setErr) log.error("[agents]", `failed to record deleted preset for ${userId}: ${setErr.message}`);
    }
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- skills (built-in library + per-user custom skills) ----

/** List every skill available to the user: built-ins plus their own customs. */
app.get("/skills", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const skills = await listAllSkillsForUser(userId);
    res.json(skills.map((s) => ({ ...s, markdown: undefined })));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- GitHub skill sources (config/skill-repos.json) ----
// Registered before GET /skills/:id so "repos" is never read as a skill id.

/** The configured GitHub repositories skills can be downloaded from. */
app.get("/skills/repos", requireAuth, (_req, res) => {
  res.json(listSkillRepos());
});

/** SKILL.md files a repo ships — name and description peeked from frontmatter. */
app.get("/skills/repos/:id/skills", requireAuth, async (req, res) => {
  try {
    res.json(await listRepoSkills(String(req.params.id)));
  } catch (e: any) {
    res.status(e?.status || 503).json({ error: e.message });
  }
});

/** Download one SKILL.md from a repo into the signed-in user's library. */
app.post("/skills/repos/:id/import", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const path = String(req.body?.path || "");
    const target = await resolveSkillPath(String(req.params.id), path);
    if (!target) return res.status(404).json({ error: "That skill file was not found in the repository." });

    const markdown = await fetchSkillMarkdown(target.repo, target.branch, target.path);
    let { skill, issues } = await saveCustomSkill(userId, markdown);
    let repaired = false;
    if (!skill) {
      // Foreign skills occasionally trip our spec (name case, long description)
      // — repair with the directory name as fallback, same as validate does.
      const dirName = slugifySkillName(target.path.split("/").at(-2) || "skill");
      const fixed = fixSkillMarkdown(markdown, dirName);
      if (fixed) {
        ({ skill, issues } = await saveCustomSkill(userId, fixed));
        repaired = !!skill;
      }
    }
    if (!skill) {
      return res.status(400).json({ error: "That skill file failed validation.", issues });
    }
    res.json({ skill, issues, repaired });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Full markdown of one skill (builtin or custom) for the editor. */
app.get("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const skills = await listAllSkillsForUser(userId);
    const skill = skills.find((s) => s.id === req.params.id);
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    const markdown = skill.markdown || serializeSkill(skill);
    const files = (skill.source === "custom"
      ? await getCustomSkillFiles(userId, skill.id)
      : getBuiltinSkillFiles(skill.id)) ?? { "SKILL.md": markdown };
    res.json({ ...skill, markdown, files });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Validate skill markdown without saving (editor live-check). */
app.post("/skills/validate", requireAuth, async (req, res) => {
  try {
    const md = String(req.body?.markdown || "");
    if (!md.trim()) {
      return res.json({ valid: false, issues: [{ line: 1, message: "empty markdown", severity: "error" }] });
    }
    const { skill, issues } = parseSkillMarkdown(md, "custom");
    const hasErrors = issues.some((i) => i.severity === "error");
    const fixed = hasErrors ? fixSkillMarkdown(md, String(req.body?.fallbackName || "")) : null;
    res.json({ valid: !!skill, parsed: skill, issues, fixed });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Pull {markdown, files} from a skills write body. A whole-tree `files`
 *  payload wins over a bare `markdown` one; both are rejected when unusable. */
function skillWriteBody(body: any): { ok: true; markdown: string; files?: SkillFiles } | { ok: false; error: string } {
  if (body?.files !== undefined) {
    const files = normalizeSkillFiles(body.files);
    if (!files) {
      return { ok: false, error: "Invalid files: SKILL.md is required and non-empty, folder paths end with \"/\" and hold no content, and no path may be absolute or contain \"..\"." };
    }
    return { ok: true, markdown: files["SKILL.md"], files };
  }
  const markdown = String(body?.markdown || "");
  if (!markdown.trim()) return { ok: false, error: "markdown is required" };
  return { ok: true, markdown };
}

/** Create or update a custom skill from markdown (or a whole file tree). */
app.post("/skills", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const body = skillWriteBody(req.body);
    if (!body.ok) return res.status(400).json({ error: body.error });
    const { skill, issues } = await saveCustomSkill(userId, body.markdown, body.files);
    if (!skill) {
      const hard = issues.filter((i) => i.severity === "error");
      return res.status(400).json({ error: "skill failed validation", issues: hard.length ? hard : issues });
    }
    res.status(201).json({ skill, issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Update a skill's markdown. Works for custom skills (saved in place) and
// built-ins (fork-on-save: the user's edit is stored as a custom skill with
// the same id, which shadows the builtin for this user from then on).
app.put("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);
    const body = skillWriteBody(req.body);
    if (!body.ok) return res.status(400).json({ error: body.error });
    const markdown = body.markdown;

    const { skill: parsed, issues } = parseSkillMarkdown(markdown, "custom");
    if (!parsed) {
      const hard = issues.filter((i) => i.severity === "error");
      return res.status(400).json({ error: "skill failed validation", issues: hard.length ? hard : issues });
    }
    if (parsed.id !== id) {
      return res.status(400).json({
        error: `The document's name ("${parsed.id}") does not match the skill being edited ("${id}"). Fix the name line in the frontmatter.`,
        issues,
      });
    }
    const { skill } = await saveCustomSkill(userId, markdown, body.files);
    res.json({ skill, issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    if (loadBuiltinSkills().some((s) => s.id === req.params.id)) {
      return res.status(400).json({ error: "Built-in skills cannot be deleted" });
    }
    await deleteCustomSkill(userId, String(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- AI skill authoring (conversational, validated drafts) ----
app.post("/skills/draft", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const body = req.body || {};
    const { llmKeys } = await fetchUserKeys(userId);
    const draftReq: SkillDraftRequest = {
      user_id: userId,
      model_id: String(body.model_id || keyPool.getDefaultModel(llmKeys)),
      llm_keys: llmKeys,
      messages: Array.isArray(body.messages) ? body.messages : [],
      requirements: typeof body.requirements === "string" ? body.requirements : "",
      current_draft: typeof body.current_draft === "string" ? body.current_draft : "",
    };
    const out = await skillDraftTurn(draftReq);
    res.json(out);
  } catch (e: any) {
    console.error("[skills/draft] FAILED:", e?.name, e?.message);
    if (e?.stack) console.error("[skills/draft] stack:", e.stack);
    const friendly =
      /No API key|api key/i.test(String(e?.message))
        ? e.message
        : `Skill drafting failed: ${e?.message || "unknown error"}. Try again or pick a different model.`;
    res.status(503).json({ error: friendly });
  }
});

// ---- analysis runs (authenticated, scoped to the signed-in user) ----
// POST /analysis is the live analysis entry point: it runs a harness agent
// (SOUL + skills + budget) and returns the typed ReportDocument.

app.post("/analysis", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    const agentId = String(body.agent_id || body.agentId || "").trim();
    const source = String(body.source || "NSE").toUpperCase();
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    if (source !== "NSE" && source !== "SEC") return res.status(400).json({ error: "source must be NSE or SEC" });
    // Request contract: 1 prompt (optional) + multiple skills (optional ids).
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined;
    const skillIds = Array.isArray(body.skills) && body.skills.length ? body.skills.map(String) : undefined;

    const userId = (req as AuthedRequest).user.id;
    // agent_id is optional: no agent → the seeded default agent (the CLI
    // resolves its persona the same way — config defaults, no --agent flag).
    let agent = agentId ? await getHarnessAgent(userId, agentId) : null;
    if (agentId && !agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent) {
      const seeded = await listHarnessAgents(userId);
      agent = seeded[0] ?? (await createHarnessAgent(userId, DEFAULT_HARNESS_AGENT));
    }

    // Budget overrides (--max-steps / --max-tokens): only present keys are
    // forwarded, so an absent flag keeps the agent's own budget.
    const budgetOverride: { maxSteps?: number; maxTokens?: number } = {};
    for (const [key, raw] of [["maxSteps", body.max_steps], ["maxTokens", body.max_tokens]] as const) {
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) budgetOverride[key] = n;
    }

    // Placeholder row so the UI can redirect to the result page instantly; the
    // run continues in the background, streaming its trace to the SSE hub and
    // updating this row when it finishes (or ERROR if it throws).
    const runId = randomUUID();
    const { error: phErr } = await getDb().from("analysis_runs").insert({
      id: runId,
      user_id: userId,
      status: "RUNNING",
      symbol,
      share_name: symbol,
      agent_name: agent.name,
      model: body.model ? String(body.model) : agent.modelId || null,
      source,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (phErr) throw new Error(phErr.message);

    runHarnessSymbol(
      userId,
      // agent.id, NOT the raw request agent_id: when the UI omits it the
      // resolved default agent above is the one that must run — an empty id
      // makes runHarnessSymbol return null and the row hangs RUNNING forever.
      agent.id,
      symbol,
      source,
      body.model ? String(body.model) : undefined,
      body.output_template_id ? String(body.output_template_id) : undefined,
      runId,
      prompt,
      skillIds,
      budgetOverride,
    ).then((result) => {
      // Belt: a null resolution (agent row vanished mid-run) must fail the row
      // instead of leaving the UI on an eternal spinner.
      if (!result) throw new Error("run did not start: agent not found");
    }).catch(async (e: any) => {
      console.error("background analysis run failed:", e);
      await getDb().from("analysis_runs")
        .update({ status: "ERROR", error: e?.message || "run failed", updated_at: new Date().toISOString() })
        .eq("id", runId);
    });
    res.json({ id: runId, status: "RUNNING" });
  } catch (e: any) {
    console.error("POST /analysis ERROR:", e);
    res.status(503).json({ error: e?.message || "Analysis failed" });
  }
});

app.get("/analysis", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db
      .from("analysis_runs")
      .select("id, symbol, share_name, agent_name, run_mode, skill_id, status, total_score, quantitative_score, qualitative_score, created_at, updated_at, duration, model, source, error, coverage, fit_low, fit_high, report->verdict")
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
      error: "No Voyager data key is available for your account. Add one in Settings → Data provider to enable live data.",
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
      pull_supported: true,
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
      pull_supported: true,
    });
  }
});

// Cancel a saved run that is still marked pending or running.
app.post("/analysis/:id/cancel", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);
    const { data } = await db
      .from("analysis_runs")
      .select("status")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (!data) return res.status(404).json({ error: "Analysis not found" });
    const s = String(data.status || "").toUpperCase();
    if (s !== "PENDING" && s !== "RUNNING") {
      return res.status(409).json({ error: `Run already ${s.toLowerCase()}; nothing to cancel` });
    }
    const { error } = await db
      .from("analysis_runs")
      .update({ status: "CANCELED", error: "Canceled by the user.", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    res.json({ canceled: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/analysis/:id", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("analysis_runs").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Analysis not found" });
    // Harness runs store their typed ReportDocument in `report`; the result
    // view reads `report_document`, so surface it under that name.
    if ((data as any).report?.schema === "relativity/report.v1" || (data as any).report?.schema === "relativity/report.v2") (data as any).report_document = (data as any).report;
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
    // Legacy runs stored the agent's UUID in agent_name. Resolve it to the real
    // agent name for the report header/footer (and fall back to the masked
    // label inside the PDF builder if the agent no longer exists).
    if (data.agent_name && isUuid(data.agent_name)) {
      const { data: agentRow } = await db
        .from("agents")
        .select("name")
        .eq("user_id", userId)
        .or(`id.eq.${data.agent_name},name.eq.${data.agent_name}`)
        .maybeSingle();
      (data as any).agent_display_name = agentRow?.name || "";
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

// Download a skill artifact. The recipe is already stored with the analysis run;
// the binary is built here, per request, so no file is ever persisted or cached.
app.get("/analysis/:id/artifact/:artifactId", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = (req as AuthedRequest).user.id;
    const { data, error } = await db.from("analysis_runs").select("*").eq("id", req.params.id).eq("user_id", userId).single();
    if (error || !data) return res.status(404).json({ error: "Analysis not found" });

    const outputs: any[] = Array.isArray(data.skill_outputs) ? data.skill_outputs : [];
    const skillId = String(req.params.artifactId).split(":")[0];
    const wanted = String(req.params.artifactId);
    const artifact = outputs
      .flatMap((output: any) => (Array.isArray(output?.artifacts) ? output.artifacts : []))
      .find((a: any) => a?.id === wanted || a?.skill_id === skillId);
    if (!artifact) return res.status(404).json({ error: "Artifact not found" });
    if (!artifact.recipe) {
      return res.status(409).json({ error: artifact.note || "This workbook could not be built" });
    }

    const { renderXlsx } = await import("./skills/artifacts/xlsx.js");
    const buffer = await renderXlsx(artifact.recipe as WorkbookRecipe);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", String(buffer.length));
    const filename = String(artifact.recipe.filename || "workbook.xlsx").replace(/[^\w.\- ]+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (e: any) {
    log.error("[artifact]", e.message);
    res.status(503).json({ error: `Workbook generation failed: ${e.message}` });
  }
});

// Live SSE stream of the analysis trace (reasoning thoughts, tool calls,
// decisions) for a single run. Also replays events already buffered.
app.get("/analysis/:id/stream", requireAuth, async (req, res) => {
  const runId = String(req.params.id);
  const db = getDb();
  const { data, error } = await db.from("analysis_runs").select("trace").eq("id", runId).eq("user_id", (req as AuthedRequest).user.id).single();
  if (error || !data) return res.status(404).json({ error: "Analysis not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  // Replay the persisted trace first: a subscriber that connects late (or after
  // a restart that emptied the in-memory hub) still sees the reasoning so far.
  let lastSeq = 0;
  for (const event of (data.trace || []) as { seq?: number }[]) {
    send({ type: "trace", event });
    if (typeof event.seq === "number" && event.seq > lastSeq) lastSeq = event.seq;
  }

  // Then live events, skipping anything already replayed from the DB.
  const unsubscribe = traceHub.subscribe(runId, (event) => {
    if (typeof event.seq === "number" && event.seq <= lastSeq) return;
    send({ type: "trace", event });
  });
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
    // One classifier for every provider (see modelcheck.ts): maps the real
    // failure — bad key, exhausted Gemini free quota (400 RESOURCE_EXHAUSTED,
    // not 429!), rate limit, unknown model, outage — to a message and a
    // machine-readable reason the UI can act on.
    const failure = classifyModelError(e);
    res.json({ valid: false, error: failure.message, reason: failure.reason, retryable: failure.retryable, needs_key: failure.needsKey });
  }
});

app.get("/stocks/search", (req, res) => {
  const q = String(req.query.query || "");
  const source = String(req.query.source || "");
  res.json(searchStocks(q, source || undefined));
});

// Company logo for a ticker: resolve symbol → domain (search API), then
// redirect to the CDN. No logo bytes are stored here. Open on purpose — an
// <img> tag carries no Authorization header, like /stocks/search above.
// The redirect target is always under the fixed CDN host, so the symbol
// can never aim it anywhere else.
app.get("/logo/:symbol", async (req, res) => {
  try {
    const url = await tickerLogoUrl(String(req.params.symbol || ""));
    res.setHeader("Cache-Control", url ? "public, max-age=86400" : "public, max-age=600");
    if (!url) return res.status(404).end();
    res.redirect(url);
  } catch {
    res.status(404).end();
  }
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

// Read-only catalog of the tools an agent's skills can call, with their
// descriptions — powers the console Tools reference and the skill editor's
// data-source picker. Static; no auth-sensitive data.
app.get("/tool-catalog", (_req, res) => {
  res.json(getToolCatalog());
});

// ---- harness agents (v2, skill-driven custom agents) ----
app.get("/harness/agents", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    let agents = await listHarnessAgents(userId);
    if (agents.length === 0) {
      // Seed the built-in technical agent for anyone with none, so the new
      // analysis dropdown is never empty (mirrors the legacy preset seeding).
      // ponytail: no deletion tracking — delete every harness agent and this
      // reseeds. Add a suppression flag if that turns out to matter.
      await createHarnessAgent(userId, DEFAULT_HARNESS_AGENT);
      agents = await listHarnessAgents(userId);
    }
    res.json(agents);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/harness/agents", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: "name is required" });
    res.status(201).json(await createHarnessAgent((req as AuthedRequest).user.id, body));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/harness/agents/:id", requireAuth, async (req, res) => {
  try {
    const updated = await updateHarnessAgent((req as AuthedRequest).user.id, String(req.params.id), req.body || {});
    if (!updated) return res.status(404).json({ error: "Agent not found" });
    res.json(updated);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/harness/agents/:id", requireAuth, async (req, res) => {
  try {
    await deleteHarnessAgent((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Run a custom harness agent against a symbol and return its ReportDocument.
app.post("/harness/agents/:id/run", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined;
    const skillIds = Array.isArray(body.skills) && body.skills.length ? body.skills.map(String) : undefined;
    const result = await runHarnessSymbol(
      userId,
      String(req.params.id),
      symbol,
      String(body.source || "NSE").toUpperCase(),
      body.model ? String(body.model) : undefined,
      body.output_template_id ? String(body.output_template_id) : undefined,
      undefined,
      prompt,
      skillIds,
    );
    if (!result) return res.status(404).json({ error: "Agent not found" });
    res.json({ id: result.runId, status: result.status, document: result.document, errors: result.errors });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// The report format list (edit src/harness/config/prompts/AGENTS.md frontmatter — live without restart).
app.get("/harness/templates", requireAuth, async (_req, res) => {
  try {
    res.json(
      loadOutputTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description, default: !!t.default })),
    );
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/harness/runs/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await getDb()
      .from("analysis_runs")
      .select("id, agent_name, symbol, status, report, trace, created_at")
      .eq("id", String(req.params.id))
      .eq("user_id", (req as AuthedRequest).user.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Run not found" });
    res.json({ ...data, report_document: (data as any).report });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
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
    `config: supabase=${config.supabaseUrl ? "set" : "unset"} voyager=${config.voyagerUrl} mcp=${config.mcpVoyagerUrl || "off"} rateLimit=${config.rateLimitPerMin}/min logLevel=${process.env.LOG_LEVEL || "info"}`,
  );
  // Runs execute in-process, so nothing survives a restart: anything left
  // PENDING/RUNNING from a previous process is dead. Clear it, then keep
  // sweeping hangs.
  startStaleRunSweeper();
});

async function shutdown() {
  try {
    server.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
