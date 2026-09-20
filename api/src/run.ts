import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { loadAgent } from "./agentstore.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, toCountrySource, pullLastPulled, pullRecordCount, type PullStatus } from "./voyager.js";
import { runQuantitative, runQuantitativeLLM, applyQuantOverlay, fetchMetricsSnapshot, assessDataAdequacy, unscoredQuantResult, type DataAdequacy } from "./quant.js";
import { runQualitativeAll, synthesizeReport, sanitizeReport, planAnalyze, normalizeQuantScale, parseQualStructure, buildScoreTables, scoreTablesToBlocks } from "./agent.js";
import { getAnalystToolCatalog } from "./tools.js";
import { combinePillars } from "./scoring.js";
import { keyPool } from "./keypool.js";
import { ensureFreshData } from "./freshness.js";
import type { LlmKeys, TraceCallback } from "./agent.js";
import { log } from "./logger.js";
import { inngest } from "./inngest.js";
import { TraceCollector, traceHub } from "./trace.js";

// ── Numeric integrity (spec Section 3) ────────────────────────────────────
// Every number in a synthesized report's table cells and chart data points
// must trace back to a value actually provided to the LLM. collectKnownValues
// gathers that full set; sanitizeReport() in agent.ts enforces it as a hard
// gate (dropping ungrounded blocks), not just a logged warning.

export function collectKnownValues(
  quantAnalysis: Record<string, any>,
  qualAnalysis: Record<string, any>,
  totalScore: number,
  quantScore: number,
  qualScore: number,
  toolCalls?: Record<string, unknown[]>,
): Set<number> {
  const known = new Set<number>();
  known.add(Math.round(totalScore * 10) / 10);
  known.add(Math.round(quantScore * 10) / 10);
  known.add(Math.round(qualScore * 10) / 10);

  for (const v of Object.values(quantAnalysis || {})) {
    if (typeof v?.score_0_100 === "number") known.add(Math.round(v.score_0_100 * 10) / 10);
    if (typeof v?.score === "number") known.add(Math.round(v.score * 10) / 10);
    if (typeof v?.value === "number") known.add(Math.round(v.value * 10) / 10);
    if (typeof v?.threshold === "number") known.add(Math.round(v.threshold * 10) / 10);
    if (typeof v?.weightage === "number") known.add(Math.round(v.weightage * 10) / 10);
  }
  for (const v of Object.values(qualAnalysis || {})) {
    if (typeof v?.score_0_100 === "number") known.add(Math.round(v.score_0_100 * 10) / 10);
    if (typeof v?.score === "number") known.add(Math.round(v.score * 10) / 10);
    if (typeof v?.weightage === "number") known.add(Math.round(v.weightage * 10) / 10);
  }
  collectToolNumbers(toolCalls, known);
  return known;
}

/** Ground charts in whatever the tools actually returned, not just final scores. */
function collectToolNumbers(toolCalls: Record<string, unknown[]> | undefined, known: Set<number>): void {
  const visit = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      known.add(Math.round(v * 10) / 10);
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (v && typeof v === "object") {
      for (const val of Object.values(v)) visit(val);
    }
  };
  for (const calls of Object.values(toolCalls || {})) {
    for (const call of Array.isArray(calls) ? calls : []) {
      if (call && typeof call === "object") {
        visit((call as any).result);
        visit((call as any).args);
      }
    }
  }
}

/** Condense what the analysis tools actually pulled for the synthesis prompt. */
export function toolEvidenceDigest(toolCalls: Record<string, unknown[]> | undefined): string {
  const lines: string[] = [];
  for (const [param, calls] of Object.entries(toolCalls || {})) {
    for (const c of Array.isArray(calls) ? calls : []) {
      if (!c || typeof c !== "object") continue;
      const rec = c as any;
      if (rec.status === "ERR") continue;
      let out: string;
      try {
        out = typeof rec.result === "string" ? rec.result : JSON.stringify(rec.result ?? {});
      } catch {
        out = String(rec.result);
      }
      if (out && out !== "{}") lines.push(`[${param}] ${rec.tool_name || rec.tool || "tool"}: ${out.slice(0, 800)}`);
    }
  }
  return lines.join("\n").slice(0, 60000);
}

export interface RunRequest {
  userId: string;
  symbol: string;
  share_name?: string;
  agent_name: string;
  model?: string;
  source?: string;
  documents?: string[];
  /** undefined = not specified (auto), true/false = explicit user choice. */
  web_search?: boolean;
  web_sources?: string[];
  reqId?: string;
}

// Hard cap on the data-availability check. Voyager cold-sleeps on Render's free
// tier; the first call can take minutes to boot + retry. The check is advisory
// (the pull step re-confirms), so past this budget we record it as unconfirmed
// and move the run on instead of visibly hanging on this step.
const DATA_CHECK_TIMEOUT_MS = 60_000;

/** Resolve with the promise's value, or reject if it takes longer than `ms`. */
export async function withDeadline<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(msg)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  detail?: string;
}

const STEP_DEFS: { key: string; label: string }[] = [
  { key: "agent", label: "Load agent configuration" },
  { key: "data", label: "Check data availability" },
  { key: "pull", label: "Ensure fresh data" },
  { key: "quantitative", label: "Quantitative scoring" },
  { key: "qualitative", label: "Qualitative scoring" },
  { key: "scorecard", label: "Summarize scoring tables" },
  { key: "finalize", label: "Finalize report" },
];

export function initialSteps(): RunStep[] {
  return STEP_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    status: "pending",
    started_at: null,
    finished_at: null,
    duration_ms: null,
  }));
}

export function startStep(steps: RunStep[], key: string): RunStep[] {
  return steps.map((s) =>
    s.key === key
      ? { ...s, status: "running", started_at: new Date().toISOString(), finished_at: null, duration_ms: null, detail: undefined }
      : s,
  );
}

export function finishStep(steps: RunStep[], key: string, status: StepStatus, detail?: string): RunStep[] {
  return steps.map((s) => {
    if (s.key !== key) return s;
    const finished_at = new Date().toISOString();
    const duration_ms = s.started_at ? Date.now() - +new Date(s.started_at) : null;
    return { ...s, status, finished_at, duration_ms, detail: detail ?? s.detail };
  });
}

function failRunningStep(steps: RunStep[]): RunStep[] {
  const idx = steps.findIndex((s) => s.status === "running");
  if (idx < 0) return steps;
  const finished_at = new Date().toISOString();
  const duration_ms = steps[idx].started_at ? Date.now() - +new Date(steps[idx].started_at) : null;
  const next = steps.slice();
  next[idx] = { ...next[idx], status: "failed", finished_at, duration_ms };
  return next;
}

// Persists step transitions through the run's serialized write queue.
class StepTracker {
  steps: RunStep[] = initialSteps();

  constructor(
    private readonly save: () => Promise<void>,
    private readonly onChange?: (key: string, s: RunStep) => void,
  ) {}

  async begin(key: string): Promise<void> {
    this.steps = startStep(this.steps, key);
    this.onChange?.(key, this.steps.find((s) => s.key === key)!);
    await this.save();
  }

  async end(key: string, status: StepStatus, detail?: string): Promise<void> {
    this.steps = finishStep(this.steps, key, status, detail);
    this.onChange?.(key, this.steps.find((s) => s.key === key)!);
    await this.save();
  }

  setDetail(key: string, detail: string): void {
    const s = this.steps.find((x) => x.key === key);
    if (s && s.status === "running") {
      s.detail = detail;
      void this.save();
    }
  }
}

// ── web search resolution ──────────────────────────────────────────────
// Explicit user choice wins; otherwise auto-enable when internal data is
// inadequate and a Tavily key exists.

export function resolveWebSearch(
  requested: boolean | undefined,
  adequacy: DataAdequacy,
  tavilyKey?: string,
): { effective: "user" | "auto" | "off"; note?: string } {
  if (requested === true) {
    if (tavilyKey) return { effective: "user" };
    return { effective: "off", note: "Web search was requested but no Tavily API key is configured." };
  }
  if (requested === false) return { effective: "off" };
  if (adequacy !== "adequate") {
    if (tavilyKey) {
      return { effective: "auto", note: `Web search auto-enabled: internal data is ${adequacy}.` };
    }
    return {
      effective: "off",
      note: `Internal data is ${adequacy}; add a Tavily API key in Settings to enable automatic web search.`,
    };
  }
  return { effective: "off" };
}

// ── run orchestration ──────────────────────────────────────────────────

// Maximum age (ms) before a RUNNING/PENDING run is considered stale and auto-failed.
const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check if a run is stale (stuck in RUNNING/PENDING with no progress for >10min)
 * and mark it FAILED if so. Returns true if the run was marked stale.
 */
export async function checkAndFailStaleRun(runId: string): Promise<boolean> {
  const db = getDb();
  const { data } = await db.from("analysis_runs").select("status, updated_at, created_at, steps").eq("id", runId).single();
  if (!data) return false;
  const s = (data.status || "").toUpperCase();
  if (s !== "PENDING" && s !== "RUNNING") return false;

  const lastTouch = data.updated_at || data.created_at;
  if (!lastTouch) return false;
  const age = Date.now() - new Date(lastTouch).getTime();
  if (age < STALE_RUN_THRESHOLD_MS) return false;

  // Run is stale — mark it FAILED
  log.warn(`[run ${runId}]`, `marking stale run as FAILED (age=${Math.round(age / 1000)}s)`);
  await db.from("analysis_runs").update({
    status: "FAILED",
    error: `Analysis timed out — no progress for ${Math.round(age / 60000)} minutes. This usually means the backend execution was interrupted. Please try again.`,
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
  return true;
}

export async function createRun(req: RunRequest): Promise<{ analysis_id: string }> {
  const db = getDb();

  // Dedupe: one active run per user + symbol. The UI guard makes accidental
  // double-submits unlikely, but a double-click, retry, or two tabs can still
  // slip a second request through — and both would burn LLM + data-pull quota
  // on the same analysis. Redirect to the existing run instead of starting a
  // duplicate. (The Inngest path additionally serializes same-symbol runs via
  // its concurrency key; this covers the local runner and the window before
  // the first run flips out of PENDING.)
  const { data: active, error: activeErr } = await db
    .from("analysis_runs")
    .select("id")
    .eq("user_id", req.userId)
    .eq("symbol", req.symbol)
    .in("status", ["PENDING", "RUNNING"])
    .limit(1)
    .maybeSingle();
  if (activeErr) throw activeErr;
  if (active?.id) {
    log.info(`[run]`, `dedupe: active run ${active.id} already exists for ${req.symbol}, returning it`);
    return { analysis_id: active.id };
  }

  const runId = randomUUID();
  const run = {
    id: runId,
    user_id: req.userId,
    status: "PENDING",
    symbol: req.symbol,
    share_name: req.share_name || req.symbol,
    agent_name: req.agent_name,
    model: req.model || getModelIds()[0],
    documents: req.documents || [],
    web_search: req.web_search ?? false,
    web_sources: req.web_sources || [],
    source: null,
    created_at: new Date().toISOString(),
    duration: null,
    error: null,
    steps: initialSteps(),
    data_availability: null,
    data_adequacy: null,
    web_search_effective: null,
    web_search_note: null,
    price_data: null,
    quantitative_analysis: {},
    qualitative_analysis: {},
    qualitative_tool_calls: {},
    quantitative_score: null,
    qualitative_score: null,
    total_score: null,
    fit_low: null,
    fit_high: null,
    coverage: null,
    report: null,
    trace: [],
  };
  let insertError: any = null;
  try {
    const { error } = await db.from("analysis_runs").insert(run);
    insertError = error;
  } catch (e: any) {
    insertError = e;
  }
  if (insertError) {
    if (isMissingColumnError(insertError)) {
      // Migration 010 not applied yet: retry without the new columns so run
      // creation still succeeds (coverage/band data is dropped until then).
      warnMissingColumns("createRun");
      const retryRun: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(run)) {
        if (!KNOWN_OPTIONAL_COLUMNS.has(k)) retryRun[k] = v;
        // Optional columns are simply dropped for the retry — the columns
        // don't exist yet, and run creation must not depend on them.
      }
      const { error: retryError } = await db.from("analysis_runs").insert(retryRun);
      if (retryError) throw retryError;
    } else {
      throw insertError;
    }
  }

  // Inngest is used in production when INNGEST_EVENT_KEY is set.
  // In development (no key), always run locally to avoid silent hangs.
  const useInngest = !!process.env.INNGEST_EVENT_KEY;

  if (useInngest) {
    try {
      await inngest.send({
        name: "analysis/run.requested",
        data: { ...req, runId },
      });
      log.info(`[run ${runId}]`, "dispatched event to Inngest");
    } catch (e: any) {
      log.warn(`[run ${runId}]`, "Inngest dispatch failed, falling back to local runner:", e?.message);
      executeRun(runId, req).catch((err) => {
        log.error(`[run ${runId}]`, "background execution failed:", err);
      });
    }
  } else {
    log.info(`[run ${runId}]`, "executing locally (no INNGEST_EVENT_KEY)");
    executeRun(runId, req).catch((err) => {
      log.error(`[run ${runId}]`, "background execution failed:", err);
    });
  }

  return { analysis_id: runId };
}

// ── Schema-drift guard (migration 010 not yet applied) ───────────────────
// The honest-scoring columns (fit_low / fit_high / coverage) are new. If the
// migration hasn't been applied, PostgREST rejects ANY patch containing them
// with PGRST204 "Could not find the '…' column … in the schema cache" — which
// would 503 every run insert/update. Instead: detect the error, strip the
// unknown columns, retry once, and log loudly so the migration gets applied.
const KNOWN_OPTIONAL_COLUMNS = new Set(["fit_low", "fit_high", "coverage"]);
let missingColumnsWarned = false;

function stripUnknownColumns(patch: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (KNOWN_OPTIONAL_COLUMNS.has(k)) dropped.push(k);
    else stripped[k] = v;
  }
  return dropped.length ? stripped : patch;
}

function isMissingColumnError(e: any): boolean {
  return e && (e.code === "PGRST204" || /Could not find the .* column/i.test(String(e?.message || "")));
}

function warnMissingColumns(context: string): void {
  if (missingColumnsWarned) return;
  missingColumnsWarned = true;
  log.error(
    "[run]",
    `analysis_runs is missing the honest-scoring columns (fit_low, fit_high, coverage). ` +
      `Runs still work but scores will have no coverage/band data until migration 010 is applied ` +
      `(api/supabase/migrations/010_honest_scoring.sql). First seen in: ${context}`,
  );
}

async function updateRun(runId: string, patch: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const full = { ...patch, updated_at: new Date().toISOString() };
  const { error } = await db.from("analysis_runs").update(full).eq("id", runId);
  if (error) {
    if (isMissingColumnError(error)) {
      warnMissingColumns(`updateRun(${runId})`);
      const retry = stripUnknownColumns(patch);
      const { error: retryError } = await db
        .from("analysis_runs")
        .update({ ...retry, updated_at: new Date().toISOString() })
        .eq("id", runId);
      if (retryError) log.error(`[run ${runId}]`, `run patch retry failed:`, retryError.message);
      return;
    }
    log.error(`[run ${runId}]`, `run patch failed:`, error.message);
  }
}

async function markFailed(runId: string, err: unknown, started?: number): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    await updateRun(runId, {
      status: "FAILED",
      error: msg,
      duration: started ? (Date.now() - started) / 1000 : null,
    });
    log.error(`[run ${runId}]`, `marked FAILED: ${msg}`);
  } catch (e) {
    log.error(`[run ${runId}]`, "failed to persist failure:", e);
  }
}

async function executeRun(runId: string, req: RunRequest): Promise<void> {
  const started = Date.now();
  const runTag = `[run ${runId}] reqId=${req.reqId || "-"}`;
  const db = getDb();

  // Serialize every write to the run doc so out-of-order steps snapshots
  // (e.g. fire-and-forget progress updates) can't clobber newer ones.
  let queue: Promise<unknown> = Promise.resolve();
  const write = (fn: () => Promise<void>): Promise<void> => {
    const next = queue
      .then(fn, fn)
      .catch((e) => {
        log.error(`[run ${runId}]`, "failed to persist progress:", e);
      });
    queue = next;
    return next;
  };
  const saveSteps = (): Promise<void> => write(() => updateRun(runId, { steps: tracker.steps }));

  // Live trace: publish every event to SSE subscribers, persist throttled.
  const collector = new TraceCollector(runId, (events) => write(() => updateRun(runId, { trace: events })));
  traceHub.reset(runId);
  const traceStep = (key: string, s: RunStep) =>
    collector.push("step", key, {
      label: s.label,
      status: s.status,
      duration_ms: s.duration_ms ?? undefined,
    });

  const tracker = new StepTracker(saveSteps, traceStep);
  const traceQual = (key: string, ev: Parameters<TraceCallback>[0]) => {
    switch (ev.type) {
      case "thought":
        collector.push("thought", key, { text: ev.text });
        break;
      case "tool_call":
        collector.push("tool_call", key, { tool: ev.tool, args: ev.args });
        break;
      case "tool_result":
        collector.push("tool_result", key, { tool: ev.tool, result: ev.result, status: ev.status === "ERR" ? "ERR" : "OK", duration_ms: ev.duration_ms });
        break;
      case "decision":
        collector.push("decision", key, { score: ev.score, text: ev.text });
        break;
    }
  };

  try {
    // ---- agent ----
    await tracker.begin("agent");
    const { config: agent, issues: agentIssues } = await loadAgent(req.userId, req.agent_name);
    if (!agent) {
      await tracker.end("agent", "failed", "Agent not found");
      throw new Error(`Agent not found: ${req.agent_name}`);
    }
    if (agentIssues.length) log.warn(runTag, `agent md warnings: ${agentIssues.map((i) => i.message).join("; ")}`);
    await tracker.end("agent", "completed");

    // The market (NSE/SEC) is a property of the run, never the agent — agents
    // are independent stock evaluators that work on any listed company.
    const source = req.source || "NSE";
    const cs = toCountrySource(source);

    // Fetch user's Voyager key and LLM keys from DB
    const { voyagerKey, llmKeys } = await fetchUserKeys(req.userId);
    // Resolve the model now that keys are known: the user's explicit pick wins,
    // otherwise the quota-aware default from the server key farm.
    const modelId = req.model || keyPool.getDefaultModel(llmKeys);
    if (modelId !== req.model) {
      await write(() => updateRun(runId, { model: modelId }));
    }
    await write(() => updateRun(runId, { status: "RUNNING", source }));
    log.info(runTag, `start symbol=${req.symbol} agent="${agent.name}" model=${modelId} source=${source}`);

    if (!voyagerKey) {
      const msg = "No Voyager API key configured. A key will be generated automatically on your next login.";
      await write(() => updateRun(runId, { status: "FAILED", error: msg }));
      log.error(runTag, msg);
      return;
    }
    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);

    // ---- data availability ----
    await tracker.begin("data");
    let dataAvailability: PullStatus | null = null;
    try {
      dataAvailability = await withDeadline(
        voyager.getPullStatus(req.symbol, cs.country, cs.source),
        DATA_CHECK_TIMEOUT_MS,
        "Data availability check timed out (Voyager cold start) — continuing unconfirmed",
      );
      await write(() => updateRun(runId, { data_availability: dataAvailability }));
      await tracker.end("data", "completed");
      const total = pullRecordCount(dataAvailability);
      log.info(runTag, `data availability records=${total} last_pulled=${pullLastPulled(dataAvailability) || "never"}`);
    } catch (e: any) {
      const detail = e?.message || String(e);
      await write(() => updateRun(runId, { data_availability: { error: detail } }));
      await tracker.end("data", "completed", detail);
      log.warn(runTag, `data availability check failed (continuing): ${detail}`);
    }

    // ---- pull (ensure fresh data) ----
    await tracker.begin("pull");
    try {
      const pullResult = await ensureFreshData(voyager, req.symbol, cs.country, cs.source, req.userId);
      if (pullResult.pulled) {
        await tracker.end("pull", "completed", `Data pulled fresh (${pullResult.duration_ms}ms)`);
        log.info(runTag, `pull completed duration=${pullResult.duration_ms}ms`);
        // Re-fetch data availability after pull
        try {
          dataAvailability = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
          await write(() => updateRun(runId, { data_availability: dataAvailability }));
        } catch { /* best effort */ }
      } else {
        await tracker.end("pull", "completed", pullResult.reason || "Data already available");
        log.info(runTag, `pull skipped: ${pullResult.reason}`);
      }
    } catch (e: any) {
      const detail = e?.message || String(e);
      await tracker.end("pull", "failed", `Pull failed: ${detail}. Proceeding with existing data.`);
      log.warn(runTag, `pull step failed (continuing): ${detail}`);
    }

    // ---- quantitative (single metrics snapshot feeds scoring + adequacy) ----
    await tracker.begin("quantitative");
    const snap = await fetchMetricsSnapshot(voyager, req.symbol, cs.country, cs.source);
    // Outage ≠ no-data (plan 0.2 / A3 / B7), revised after field feedback: a
    // provider outage no longer kills the run — it DEGRADES it. The quant
    // pillar is marked fully unscored (null scores with an explicit reason),
    // so the total becomes a qual-only estimate: no fake zeros, the band
    // widens, coverage drops, and the report states the gap. The research that
    // CAN run still runs, and the user gets the remaining work instead of an
    // error page.
    // Start from the fully-unscored shape and overwrite with real scores only
    // when the provider answered — assignment is then unconditional.
    let quant = unscoredQuantResult(agent, snap.price_data, "error");
    let metricsOutage: string | null = null;
    if (snap.outage) {
      metricsOutage = snap.outage_error || "metrics provider outage";
      await tracker.end(
        "quantitative",
        "failed",
        `Metrics provider outage — quantitative criteria unscored: ${metricsOutage.slice(0, 160)}`,
      );
      log.warn(runTag, `metrics outage — degrading to qual-only scoring: ${metricsOutage}`);
    } else {
      await tracker.end("quantitative", "completed");
      const metrics = snap.metrics;
      const price_data = snap.price_data;
      quant = runQuantitative(agent, metrics, price_data);
      const quantOverlay = await runQuantitativeLLM({ modelId, llmKeys, entries: quant.quantitative_analysis });
      applyQuantOverlay(quant, quantOverlay);
      if (Object.keys(quantOverlay).length) log.info(runTag, `quant LLM-judged ${Object.keys(quantOverlay).length} criteria`);
    }
    const metrics = snap.metrics;
    const price_data = snap.price_data;
    const adequacy = assessDataAdequacy(dataAvailability, metrics);
    log.info(
      runTag,
      `quant done score=${quant.quantitative_score} coverage=${quant.coverage} price_data=${price_data} adequacy=${adequacy}${metricsOutage ? " (OUTAGE — qual-only)" : ""}`,
    );

    // Resolve effective web search now that adequacy is known.
    const web = resolveWebSearch(req.web_search, adequacy, llmKeys.tavily);
    await write(() =>
      updateRun(runId, {
        data_adequacy: adequacy,
        web_search_effective: web.effective,
        web_search_note: web.note || null,
      }),
    );
    log.info(runTag, `web search effective=${web.effective}${web.note ? ` (${web.note})` : ""}`);

    const toolCtx = {
      voyager,
      tavilyKey: llmKeys.tavily,
      symbol: req.symbol,
      country: cs.country,
      source: cs.source,
      shareName: req.share_name || req.symbol,
      webSources: req.web_sources || [],
    };

    // ---- plan (agent decides research tactics + report outline) ----
    const plan = await planAnalyze({
      modelId,
      llmKeys,
      persona: agent.persona?.philosophy_and_mindset || "",
      agentDisplayName: agent.name,
      quant: Object.entries(quant.quantitative_analysis).map(([key, e]: [string, any]) => ({
        key,
        metric_name: e.metric_name || key,
        value: e.value,
        threshold: e.threshold,
        operator: e.operator,
        score: e.score ?? 0,
      })),
      qual: [
        ...(agent?.asset_evaluation?.qualitative || []).map((p: any) => ({ parameter: p.parameter, content: p.content, section: "asset_evaluation" })),
        ...(agent?.macro_evaluation?.qualitative || []).map((p: any) => ({ parameter: p.parameter, content: p.content, section: "macro_evaluation" })),
      ],
      adequacy,
      webSearch: web.effective !== "off",
      tools: getAnalystToolCatalog(),
      subject: `${req.share_name || req.symbol} (${req.symbol}) on ${source}`,
    });
    log.info(runTag, `plan: ${plan.params.length} param tactics, ${plan.report.charts.length} chart(s), ${plan.report.tables.length} table(s)`);

    // ---- qualitative ----
    const qualParams = [
      ...(agent?.asset_evaluation?.qualitative || []),
      ...(agent?.macro_evaluation?.qualitative || []),
    ];
    await tracker.begin("qualitative");
    let qual: {
      qualitative_analysis: Record<string, unknown>;
      qualitative_tool_calls: Record<string, unknown[]>;
      qualitative_score: number | null;
      fit_low: number;
      fit_high: number;
      coverage: number;
    } | null = null;
    let qualErrors: string[] = [];
    if (qualParams.length === 0) {
      await tracker.end("qualitative", "skipped", "No qualitative parameters");
      qual = {
        qualitative_analysis: {},
        qualitative_tool_calls: {},
        qualitative_score: null,
        fit_low: 0,
        fit_high: 0,
        coverage: 0,
      };
    } else {
      qual = await runQualitativeAll(
        modelId,
        llmKeys,
        toolCtx,
        agent,
        req.documents || [],
        web.effective !== "off",
        adequacy,
        (done, total, label) => {
          tracker.setDetail("qualitative", `${done} of ${total} parameters scored — ${label}`);
        },
        traceQual,
        plan,
      );
      qualErrors = Object.entries(qual.qualitative_analysis)
        .filter(([, e]) => !!(e as any)?.error)
        .map(([label, e]) => `${label}: ${(e as any).error}`);
      await tracker.end(
        "qualitative",
        qualErrors.length ? "failed" : "completed",
        qualErrors.length
          ? `${qualErrors.length} qualitative parameter${qualErrors.length > 1 ? "s" : ""} failed`
          : undefined,
      );
      log.info(runTag, `qual done score=${qual.qualitative_score} coverage=${qual.coverage}`);
    }

    // ---- aggregate scores (pillar-weighted, honest — plan 0.2/0.3) ----
    // A quant score of 0 is a REAL 0 when metrics were scored — the old
    // `score > 0` test silently turned (0, 80) into 80. Nulls (unscored
    // pillars) are excluded from the point estimate and widen the band.
    const quantScore = quant.quantitative_score;
    const qualScore = qual?.qualitative_score ?? null;
    const totalAgg = combinePillars([
      {
        key: "quantitative",
        result: {
          score: quantScore,
          fit_low: quant.fit_low,
          fit_high: quant.fit_high,
          coverage: quant.coverage,
          totalWeight: Object.keys(quant.quantitative_analysis).length,
          allWeight: Object.keys(quant.quantitative_analysis).length,
          weightedSum: 0,
        },
        weight: 1,
      },
      {
        key: "qualitative",
        result: {
          score: qualScore,
          fit_low: qual?.fit_low ?? 0,
          fit_high: qual?.fit_high ?? 0,
          coverage: qual?.coverage ?? 0,
          totalWeight: qual ? Object.keys(qual.qualitative_analysis).length : 0,
          allWeight: qual ? Object.keys(qual.qualitative_analysis).length : 0,
          weightedSum: 0,
        },
        weight: 1,
      },
    ]);
    const total = totalAgg.score; // null when neither pillar produced a score
    const totalCoverage = totalAgg.coverage;
    const totalLow = totalAgg.fit_low;
    const totalHigh = totalAgg.fit_high;

    // Persist the parsed per-parameter structure (checklist verdicts + risks) so
    // the UI, PDF, scorecard and synthesis render "why this score" structurally.
    const parsedQual = parseQualStructure(qual?.qualitative_analysis || {});

    // ---- scorecard: deterministic tables rendered by CODE (plan 0.2 / D2) ----
    await tracker.begin("scorecard");
    const scoreTables = buildScoreTables({
      quantAnalysis: normalizeQuantScale(quant.quantitative_analysis),
      qualAnalysis: parsedQual,
      quantScore,
      qualScore,
      totalScore: total,
      coverage: totalCoverage,
    });
    await tracker.end("scorecard", "completed", `${scoreTables.length} deterministic table(s)`);
    log.info(runTag, `scorecard: ${scoreTables.length} code-rendered table(s)`);

    // ---- finalize ----
    // The run fails only when EVERYTHING failed to score (no honest number
    // exists); partial results complete with per-parameter errors preserved.
    await tracker.begin("finalize");
    const qualTotal = Object.keys(qual?.qualitative_analysis || {}).length;
    const allQualFailed = qualTotal > 0 && qualErrors.length === qualTotal;
    const nothingScored = quantScore == null && qualScore == null;
    const qualErrorSummary = allQualFailed
      ? `Qualitative scoring failed — ${qualErrors.join("; ")}`
      : nothingScored && qualTotal === 0 && Object.keys(quant.quantitative_analysis).length === 0
        ? "No scoring criteria were configured for this agent."
        : null;
    const finalStatus = qualErrorSummary ? "FAILED" : "COMPLETED";

    let report = null;
    if (total != null || quantScore != null || qualScore != null) {
      tracker.setDetail("finalize", "Synthesizing final report...");
      report = await synthesizeReport({
        modelId,
        llmKeys,
        agentPersona: agent.persona?.philosophy_and_mindset || "",
        agentDisplayName: agent.name || "Analysis Agent",
        quantAnalysis: normalizeQuantScale(quant.quantitative_analysis),
        qualAnalysis: parsedQual,
        totalScore: total ?? 0,
        quantScore,
        qualScore,
        fitLow: totalLow,
        fitHigh: totalHigh,
        coverage: totalCoverage,
        asOf: new Date().toISOString().slice(0, 10),
        degraded: metricsOutage
          ? `the metrics provider was unreachable, so all ${Object.keys(quant.quantitative_analysis).length} quantitative criteria are unscored`
          : undefined,
        partial: !!qualErrorSummary,
        plan,
        toolEvidence: toolEvidenceDigest(qual?.qualitative_tool_calls),
      });

      // Score summary tables are appended from CODE-rendered ScoreTables
      // (plan 0.2/D2): no LLM transcription, no invented totals, no rescaling.
      if (scoreTables.length) {
        const scoreBlocks = [
          { type: "heading", level: 2, text: "Score Summary" } as const,
          ...scoreTablesToBlocks(scoreTables),
        ];
        report = { ...report, blocks: [...report.blocks, ...scoreBlocks] };
      }

      // Numeric integrity hard gate (spec Section 3): any bullet in a table or
      // chart that can't trace back to a scored value or tool observation drops
      // the block. The stored report therefore never ships an invented figure.
      const known = collectKnownValues(
        normalizeQuantScale(quant.quantitative_analysis),
        parsedQual,
        total ?? 0,
        quantScore ?? 0,
        qualScore ?? 0,
        qual?.qualitative_tool_calls,
      );
      const { report: cleanReport, dropped } = sanitizeReport(report, known);
      if (dropped.length) {
        log.warn(runTag, `report sanitized — dropped ${dropped.length} block(s): ${dropped.slice(0, 5).join("; ")}`);
      }
      report = cleanReport;
      // The hero number is OUR stored total, not the model's (plan 0.2/D2):
      // clamp heroPct to the deterministic aggregate so the headline can never
      // drift from the persisted total_score.
      report = { ...report, heroPct: total != null ? Math.round(total * 10) / 10 : report.heroPct };
      log.info(runTag, `report ready (source=${report.source})`);
    }

    await write(() =>
      updateRun(runId, {
        status: finalStatus,
        error: qualErrorSummary,
        duration: (Date.now() - started) / 1000,
        quantitative_analysis: quant.quantitative_analysis,
        qualitative_analysis: parsedQual,
        qualitative_tool_calls: qual?.qualitative_tool_calls || {},
        quantitative_score: quantScore,
        qualitative_score: qualScore,
        total_score: total,
        fit_low: totalLow,
        fit_high: totalHigh,
        coverage: totalCoverage,
        price_data: price_data || null,
        report,
        steps: finishStep(tracker.steps, "finalize", "completed"),
      }),
    );
    collector.push("log", "finalize", {
      text: `${finalStatus}${total != null ? ` — total score ${total} (coverage ${totalCoverage}%, band ${totalLow}\u2013${totalHigh})` : " — nothing scored"}`,
    });
    await collector.flush();
    log.info(runTag, `${finalStatus} total=${total} coverage=${totalCoverage} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    tracker.steps = failRunningStep(tracker.steps);
    await write(() => updateRun(runId, { steps: tracker.steps })).catch(() => {});
    collector.push("log", "finalize", { text: `FAILED — ${e instanceof Error ? e.message : String(e)}` });
    await collector.flush().catch(() => {});
    log.error(runTag, "execution failed:", e);
    await markFailed(runId, e, started);
  }
}
