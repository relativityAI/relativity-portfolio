import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { loadAgent } from "./agentstore.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, toCountrySource, pullLastPulled, pullRecordCount, type PullStatus } from "./voyager.js";
import { fetchMetricsSnapshot, assessDataAdequacy, type DataAdequacy } from "./quant.js";
import { synthesizeSkillReport, buildSourcesBlocks } from "./agent.js";
import { blockedReport, isUnscoreable } from "./reportGate.js";
import { getAnalystToolCatalog } from "./tools.js";
import { buildMarketSnapshot, buildFactsPack } from "./marketdata.js";
import { keyPool } from "./keypool.js";
import { ensureFreshData } from "./freshness.js";
import type { LlmKeys, TraceCallback, ReportBlock } from "./agent.js";
import { log } from "./logger.js";
import { inngest } from "./inngest.js";
import { TraceCollector, traceHub } from "./trace.js";
import { resolveSkillsForAgent, type ResolvedSkill } from "./skills/resolve.js";
import { resolveSkill } from "./skills/store.js";
import { runAllSkills } from "./skills/skillrun.js";
import { aggregateSkillOutputs } from "./skills/aggregate.js";
import { assembleSkillCharts, buildSkillScoreCharts, toolEvidenceForCharts } from "./skills/charts.js";
import { runQuantScreen } from "./skills/quantscreen.js";
import { buildSkillScoreTables } from "./skills/tables.js";
import { finalizeReport } from "./skills/finalize.js";
import { isScoreDisplayable, MIN_COVERAGE_FOR_SCORE } from "./skills/aggregate.js";

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
        out =
          typeof rec.result === "string"
            ? String(stripIdentifiers(rec.result ?? ""))
            : JSON.stringify(stripIdentifiers(rec.result ?? {}));
      } catch {
        out = String(rec.result);
      }
      if (out && out !== "{}") lines.push(`[${param}] ${rec.tool_name || rec.tool || "tool"}: ${out.slice(0, 800)}`);
    }
  }
  return lines.join("\n").slice(0, 60000);
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Stateless checker: /g/ regexes carry lastIndex across .test() calls, which
// made the uuid guard below intermittently MISS inside this loop and leave
// uuid-shaped ids in tool output (they then leaked into reports/PDFs).
const UUID_TEST_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Remove infrastructure identifiers (uuid-shaped ids) from tool output so the
 * model never echoes internal record ids into the report/PDF. Business values
 * (tickers, dates, percentages) pass through untouched.
 */
export function stripIdentifiers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIdentifiers);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const looksUuid = typeof val === "string" && UUID_TEST_RE.test(val);
      if ((k === "id" || k.endsWith("_id")) && looksUuid) continue;
      o[k] = stripIdentifiers(val);
    }
    return o;
  }
  if (typeof v === "string") return v.replace(UUID_RE, "").trim();
  return v;
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
  /** 'agent' (default) runs the whole agent; 'skill' runs one skill standalone. */
  run_mode?: "agent" | "skill";
  /** Required when run_mode === 'skill'. */
  skill_id?: string;
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

// "degraded" marks a step that finished without full success — the data check
// timing out, say — so the UI can render an honest mid-state instead of a green
// check carrying a failure message.
export type StepStatus = "pending" | "running" | "completed" | "degraded" | "failed" | "skipped";

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
  { key: "skills", label: "Run agent skills" },
  { key: "scorecard", label: "Aggregate skill scores" },
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

// ── web search resolution ──────────────────────────────────────────
// Web search is now ALWAYS available (free DuckDuckGo provider): explicit
// user choice wins, otherwise it auto-enables whenever internal data is
// inadequate. A Tavily key upgrades the provider but is no longer required.

export function resolveWebSearch(
  requested: boolean | undefined,
  adequacy: DataAdequacy,
  _tavilyKey?: string,
): { effective: "user" | "auto" | "off"; note?: string } {
  if (requested === true) return { effective: "user" };
  if (requested === false) return { effective: "off" };
  if (adequacy !== "adequate") {
    return { effective: "auto", note: `Web search auto-enabled: internal data is ${adequacy}.` };
  }
  return { effective: "off" };
}

// ── run orchestration ──────────────────────────────────────────────────

// Maximum age (ms) before a RUNNING/PENDING run is considered stale and auto-failed.
// Sized above the worst legitimate run: 300s pull + ⌈8/2⌉ × 180s skill turns at
// concurrency 2 + 180s synthesis ≈ 27 min; 35 gives headroom without leaving a
// genuinely dead run visible for hours.
const STALE_RUN_THRESHOLD_MS = 35 * 60 * 1000;

/**
 * Check if a run is stale (stuck in RUNNING/PENDING with no progress) and mark it
 * FAILED if so. Returns true if the run was marked stale.
 */
export async function checkAndFailStaleRun(runId: string, opts?: { scopeToUser?: string }): Promise<boolean> {
  const db = getDb();
  const { data } = await db.from("analysis_runs").select("status, updated_at, created_at, steps, user_id").eq("id", runId).single();
  if (!data) return false;
  if (opts?.scopeToUser && data.user_id !== opts.scopeToUser) return false;
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
  }).eq("id", runId).eq("user_id", data.user_id);
  return true;
}

/** On boot, any PENDING/RUNNING row is a leftover from a process that died —
 * a `tsx watch` restart or a crash. The local runner is in-process, so nothing
 * will ever resume it; without this it sits RUNNING for up to
 * STALE_RUN_THRESHOLD_MS and blocks the per-symbol dedupe in createRun.
 * Skipped when Inngest is configured: those runs are durable and resume.
 * ponytail: single-instance assumption; scope by instance id if that changes. */
export async function failOrphanedRuns(): Promise<void> {
  if (process.env.INNGEST_EVENT_KEY) return;
  try {
    const db = getDb();
    const { data, error } = await db
      .from("analysis_runs")
      .update({
        status: "FAILED",
        error: "Analysis was interrupted by a server restart. Please try again.",
        updated_at: new Date().toISOString(),
      })
      .in("status", ["PENDING", "RUNNING"])
      .select("id");
    if (error) throw error;
    if (data?.length) log.warn("[run]", `boot sweep: marked ${data.length} orphaned run(s) FAILED`);
  } catch (e) {
    log.warn("[run]", "boot orphan sweep failed:", e instanceof Error ? e.message : String(e));
  }
}

// Server-side staleness sweep: checkAndFailStaleRun was previously reachable
// ONLY from the client-polled read route, so a closed tab meant a dead run sat
// in RUNNING forever (or a healthy 24-min run got killed at the old 10-min
// threshold). A real interval sweeps independently of any client.
export function startStaleRunSweeper(): NodeJS.Timeout {
  const sweep = async (): Promise<void> => {
    try {
      const db = getDb();
      const cutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString();
      const { data, error } = await db
        .from("analysis_runs")
        .select("id")
        .in("status", ["PENDING", "RUNNING"])
        .or(`updated_at.lt.${cutoff},and(updated_at.is.null,created_at.lt.${cutoff})`)
        .limit(50);
      if (error) throw error;
      for (const row of data || []) {
        await checkAndFailStaleRun(row.id).catch(() => {});
      }
    } catch (e) {
      log.warn("[run sweeper]", "stale-run sweep failed:", e instanceof Error ? e.message : String(e));
    }
  };
  const timer = setInterval(() => void sweep(), 60_000);
  timer.unref?.();
  return timer;
}

export interface ExistingRunInfo {
  agent_name: string | null;
  model: string | null;
  status: string | null;
}

export interface CreateRunResult {
  analysis_id: string;
  /** True when an active run for the same user+symbol+source already existed and was returned instead. */
  deduped?: boolean;
  /** Present only when deduped — lets the UI say whose run the user is about to see. */
  existing_run?: ExistingRunInfo;
}

export async function createRun(req: RunRequest): Promise<CreateRunResult> {
  const db = getDb();

  // Dedupe: one active run per user + symbol + source (market). The UI guard
  // makes accidental double-submits unlikely, but a double-click, retry, or
  // two tabs can still slip a second request through — and both would burn
  // LLM + data-pull quota on the same analysis. Redirect to the existing run
  // instead of starting a duplicate. Source is part of the key because NSE:RELIANCE
  // and SEC:RELIANCE are different instruments — one must not block the other.
  // The Inngest path additionally serializes same-symbol runs via
  // its concurrency key; this covers the local runner and the window before
  // the first run flips out of PENDING.
  const source = req.source || "NSE";
  const { data: active, error: activeErr } = await db
    .from("analysis_runs")
    .select("id, agent_name, model, status")
    .eq("user_id", req.userId)
    .eq("symbol", req.symbol)
    .eq("source", source)
    // skill_id is part of the dedupe key so an agent run and a skill run on
    // the same symbol don't block each other. null = IS NULL (agent runs).
    .eq("skill_id", req.skill_id || null)
    .in("status", ["PENDING", "RUNNING"])
    .limit(1)
    .maybeSingle();
  if (activeErr) throw activeErr;
  if (active?.id) {
    log.info(`[run]`, `dedupe: active run ${active.id} already exists for ${source}:${req.symbol}, returning it`);
    return {
      analysis_id: active.id,
      deduped: true,
      existing_run: { agent_name: active.agent_name ?? null, model: active.model ?? null, status: active.status ?? null },
    };
  }

  const runId = randomUUID();
  const run = {
    id: runId,
    user_id: req.userId,
    status: "PENDING",
    symbol: req.symbol,
    share_name: req.share_name || req.symbol,
    agent_name: req.agent_name,
    run_mode: req.run_mode || "agent",
    skill_id: req.skill_id || null,
    // Placeholder only — executeRun resolves the real quota-aware default once
    // user keys are known; the run row must never persist a model nobody can
    // call (paid provider with no key configured).
    model: req.model || getModelIds()[0],
    documents: req.documents || [],
    web_search: req.web_search ?? false,
    web_sources: req.web_sources || [],
    source: null,
    created_at: new Date().toISOString(),
    // The run's true start clock (set when the run leaves PENDING). The UI
    // anchors the live elapsed timer to this — created_at is queue time, and
    // a page reload mid-run must never reset the counter to zero.
    started_at: null,
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
const KNOWN_OPTIONAL_COLUMNS = new Set(["fit_low", "fit_high", "coverage", "market_snapshot", "run_mode", "skill_id"]);
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
      if (retryError) {
        log.error(`[run ${runId}]`, `run patch retry failed:`, retryError.message);
        throw new Error(`DB update failed: ${retryError.message}`);
      }
      return;
    }
    log.error(`[run ${runId}]`, `run patch failed:`, error.message);
    throw new Error(`DB update failed: ${error.message}`);
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
    // skillrun failure diagnostics arrive as log events (outside the
    // TraceCallback union) — persist them so a failed skill still
    // leaves its reasoning and raw error in the trace.
    if ((ev as any).type === "log") {
      collector.push("log", key, { text: (ev as any).text });
      return;
    }
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
    // ---- agent / skill ----
    // Skill mode runs one skill standalone (no agent, no persona); agent mode
    // loads the agent and resolves its skill list as before.
    let resolved: ResolvedSkill[];
    let persona: string;
    let runLabel: string;
    await tracker.begin("agent");
    if (req.run_mode === "skill") {
      if (!req.skill_id) throw new Error("skill_id is required for a skill run");
      const skill = await resolveSkill(req.userId, req.skill_id);
      if (!skill) {
        await tracker.end("agent", "failed", "Skill not found");
        throw new Error(`Skill not found: ${req.skill_id}`);
      }
      resolved = [{ skill, weight: 5 }];
      persona = "";
      runLabel = skill.name;
      log.info(runTag, `skill run: ${skill.name} (${skill.id})`);
    } else {
      const { config: agent, issues: agentIssues } = await loadAgent(req.userId, req.agent_name);
      if (!agent) {
        await tracker.end("agent", "failed", "Agent not found");
        throw new Error(`Agent not found: ${req.agent_name}`);
      }
      if (agentIssues.length) log.warn(runTag, `agent md warnings: ${agentIssues.map((i) => i.message).join("; ")}`);
      resolved = await resolveSkillsForAgent(req.userId, agent);
      persona = agent.persona?.philosophy || "";
      runLabel = agent.name;
    }
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
    // Stamp the true start clock once, on the PENDING→RUNNING edge. The UI's
    // elapsed timer anchors here, so reloads show total actual time.
    await write(() => updateRun(runId, { status: "RUNNING", source, started_at: new Date().toISOString() }));
    log.info(runTag, `start symbol=${req.symbol} ${req.run_mode === "skill" ? "skill" : "agent"}="${runLabel}" model=${modelId} source=${source}`);

    // Keyless runs are supported: without a Voyager key the run proceeds on
    // the free web-search provider instead of hard-failing. The data steps
    // degrade to "skipped" and every internal tool call returns a clean
    // no-data message the analyst can act on.
    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);

    // ---- data availability ----
    await tracker.begin("data");
    let dataAvailability: PullStatus | null = null;
    if (!voyagerKey) {
      await tracker.end("data", "skipped", "No data-provider key configured — this run uses live web search only.");
    } else {
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
      await tracker.end("data", "degraded", `Data check did not complete — ${detail} The run continues with existing data.`);
      log.warn(runTag, `data availability check failed (continuing): ${detail}`);
    }
    }

    // ---- pull (ensure fresh data) ----
    await tracker.begin("pull");
    if (!voyagerKey) {
      await tracker.end("pull", "skipped", "No data-provider key — skipping the data pull step.");
    } else {
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
    }    // ---- metrics snapshot (feeds deterministic quant-screen skills + adequacy) ----
    await tracker.begin("skills");
    const snap = voyagerKey
      ? await fetchMetricsSnapshot(voyager, req.symbol, cs.country, cs.source)
      : { outage: true, outage_error: "no data-provider key configured", metrics: {}, price_data: "unknown" };
    const metrics = snap.outage ? {} : snap.metrics;
    const price_data = snap.outage ? "unknown" : snap.price_data;
    // Freeze the market context (price, market cap, trailing 6-month chart)
    // for this run date. Best-effort: a failure leaves the run's snapshot
    // null and the result UI degrades honestly.
    const marketSnapshot = await buildMarketSnapshot(req.symbol, snap.outage ? null : metrics);
    const adequacy = assessDataAdequacy(dataAvailability, metrics);
    if (!voyagerKey) {
      collector.push("log", "data", {
        text: "No data-provider key — this run grounds every verdict in live web search instead.",
      });
    } else if (snap.outage) {
      log.warn(runTag, `metrics outage — rule-screen skills will be unscored: ${snap.outage_error}`);
      collector.push("log", "data", {
        text: `Metrics provider outage — rule-screen skills cannot be scored this run (${snap.outage_error || "no metrics available"}).`,
      });
    }

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

    // ---- skills: resolve the agent's skill list and fan out analysts (D4) ----
    tracker.setDetail("skills", `${resolved.length} skill(s) loaded`);
    log.info(runTag, `skills: ${resolved.map((s) => s.skill.id).join(", ") || "(none)"}`);

    if (resolved.length === 0) {
      await tracker.end("skills", "failed", "The agent has no skills attached — add skills in the agent builder.");
      throw new Error("Agent has no skills attached");
    }

    // Facts pack (WS-1): one deterministic digest of every figure the report
    // may quote — built in code from the same live feeds the analysts use.
    const { facts: factsPack, stance } = await buildFactsPack(voyagerKey ? voyager : null, req.symbol, cs.source);
    log.info(runTag, `facts pack: ${factsPack.split("\n").length} line(s); stance=${stance.overall} (${stance.confidence}%)`);

    const skillCtx = {
      toolCtx,
      modelId,
      llmKeys,
      persona,
      documents: req.documents || [],
      webSearch: web.effective !== "off",
      toolCatalog: getAnalystToolCatalog(),
      factsPack,
      // skillrun envelopes every event as { parameter, section, type, data }:
      // the real harness event lives in `data`, keyed by the skill name.
      // Passing the envelope itself (the old `traceQual as …` cast) made
      // traceQual read `.type` off `undefined` — a TypeError inside the
      // analyst's stream loop that failed every skill on this path.
      onTrace: (raw: any) =>
        traceQual(String(raw?.parameter ?? "skills"), raw?.data ?? raw),
      // Live per-skill progress: emit a trace log per skill state so the run
      // view can show exactly which skills are running/done instead of one
      // opaque spinner on the whole step.
      onSkillStart: ({ name }: { id: string; name: string }) => {
        collector.push("log", "skills", { text: `▸ ${name} — running` });
      },
      onSkillEnd: (
        { name }: { id: string; name: string },
        out: { error?: string; verdicts?: unknown[]; findings?: unknown[] },
        durationMs: number,
      ) => {
        const secs = (durationMs / 1000).toFixed(1);
        if (out.error) {
          collector.push("log", "skills", { text: `✗ ${name} — failed (${secs}s): ${String(out.error).slice(0, 140)}` });
        } else {
          const n = (out.verdicts?.length ?? 0) + (out.findings?.length ?? 0);
          collector.push("log", "skills", { text: `✓ ${name} — done (${secs}s, ${n} item${n === 1 ? "" : "s"})` });
        }
        done += 1;
        tracker.setDetail("skills", `${done}/${resolved.length} skills finished — ${name} ${out.error ? "failed" : "completed"}`);
      },
    };

    let done = 0;

    const weights = Object.fromEntries(resolved.map((r: ResolvedSkill) => [r.skill.id, r.weight]));
    let outputs = await runAllSkills(skillCtx, resolved);

    // Deterministic rule-screen skills are scored in code against the metrics
    // snapshot — the LLM never evaluates a numeric rule (decision D4).
    outputs = await Promise.all(
      outputs.map(async (out) => {
        const entry = resolved.find((r) => r.skill.id === out.skill_id);
        if (entry?.skill.category !== "custom" || !/quant-screen|quant screen/i.test(entry.skill.name)) return out;
        return runQuantScreen(entry.skill, out, snap.outage ? null : snap.metrics, price_data);
      }),
    );

    const skillErrors = outputs.filter((o) => o.error).map((o) => `${o.skill_name}: ${o.error}`);
    await tracker.end(
      "skills",
      skillErrors.length === outputs.length ? "failed" : skillErrors.length ? "completed" : "completed",
      skillErrors.length ? `${skillErrors.length} skill(s) reported problems` : `${outputs.length} skill(s) completed`,
    );
    log.info(runTag, `skills done: ${outputs.length - skillErrors.length}/${outputs.length} usable`);

    // ---- aggregate scores (code-side, honest — decision D4/0.2) ----
    const agg = aggregateSkillOutputs(outputs, weights);
    // Attach the computed per-skill scores back onto the stored outputs —
    // the report UI reads score_0_100/coverage from each skill card, and a
    // skill with verdicts but no attached score would render a false N/A.
    for (const s of agg.per_skill) {
      const out = outputs.find((o) => o.skill_id === s.skill_id);
      if (out) {
        out.score_0_100 = s.score_0_100 ?? undefined;
        out.coverage = s.coverage;
      }
    }
    // A headline number that rests on mostly-unassessed anchors misleads the
    // investor (it reads as a verdict when it is a guess). When too little of
    // the rubric was scoreable, total_score is stored as null — the run still
    // COMPLETES with full skill reports, fit band, and coverage, but no hero
    // number is manufactured. That is the fix for "skills produced no score
    // yet a total appeared": no score in, no score out.
    const total = isScoreDisplayable(agg) ? agg.total_score : null;
    const totalCoverage = Math.round(agg.coverage * 1000) / 10;
    const totalLow = agg.fit_low;
    const totalHigh = agg.fit_high;
    const scoredOutputs = outputs.filter((o) => !o.error);

    // ---- scorecard: deterministic tables rendered by CODE (D2 preserved) ----
    await tracker.begin("scorecard");
    const scoreTables = buildSkillScoreTables(outputs, agg, runLabel);
    await tracker.end("scorecard", "completed", `${scoreTables.length} deterministic table(s)`);
    log.info(runTag, `scorecard: ${scoreTables.length} code-rendered table(s)`);    // ---- finalize ----
    // The run fails only when EVERY skill failed to score (no honest number
    // exists); partial results complete with per-skill errors preserved.
    await tracker.begin("finalize");
    let errorSummary =
      agg.status === "failed"
        ? `All skills failed to produce a score — ${
            skillErrors.length
              ? skillErrors.slice(0, 3).join("; ")
              : agg.failure_reason || "every anchor came back without usable data"
          }`
        : total == null && agg.scored_count === 0
          ? `No skill produced a scoreable verdict — ${
              skillErrors.length
                ? skillErrors.slice(0, 3).join("; ")
                : "every anchor came back without usable data"
            }`
          : null;
    // "failed" = nothing was scoreable at all (no honest number exists).
    // A run with SOME scoreable-but-thin coverage completes with the score
    // suppressed — skill reports are still worth reading.
    // Terminal status is decided AFTER synthesis (just before the final patch):
    // a run that produced a readable report is COMPLETED even when no anchor
    // scored — the number is suppressed, not the report. Only a run with no
    // report at all is a failure. (Labelling a full report "Failed" is what
    // made the UI show an error banner over real content.)

    // A user cancel must win over a racing worker: the cancel endpoint wrote
    // CANCELED while skills were still running, and this patch would silently
    // resurrect the run to COMPLETED. If canceled, keep the terminal state and
    // stop before any further writes.
    const { data: currentRow } = await db
      .from("analysis_runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (String((currentRow as any)?.status || "").toUpperCase() === "CANCELED") {
      log.info(runTag, "run canceled by user — abandoning finalize (results already persisted)");
      return;
    }

    // Persist the deterministic results BEFORE any LLM-dependent work: skills
    // can cost minutes, and a throw in report synthesis must not void the
    // computed score. The final patch below then only adds the report.
    // Status stays RUNNING here on purpose — synthesis is still in flight, and
    // writing a terminal status/error at this point is what made the UI render
    // "Failed" over a run that was still working. If the process dies now the
    // stale-run sweeper owns the failure.
    await write(() =>
      updateRun(runId, {
        status: "RUNNING",
        skill_outputs: outputs,
        total_score: total,
        fit_low: totalLow,
        fit_high: totalHigh,
        coverage: totalCoverage,
        price_data: price_data || null,
        market_snapshot: marketSnapshot,
        pipeline_version: "v3-skills",
      }),
    );

    // Skill runs persist the skill output only — no executive summary, no charts.
    const isSkillRun = req.run_mode === "skill";

    // Assemble skill-declared charts from real tool results (code-grounded).
    // The trace collector holds every tool_result this run's analysts observed;
    // series specs (revenue_by_quarter, peer_benchmark, …) ground against it.
    let chartBlocksPromise: Promise<ReportBlock[]> = Promise.resolve([]);
    if (!isSkillRun) {
      const chartEvidence = toolEvidenceForCharts(
        traceToolCallMap(
          collector.snapshot().filter((ev) => ev.type === "tool_result" && ev.status !== "ERR"),
        ),
      );
      try {
        chartBlocksPromise = assembleSkillCharts(outputs, resolved, req.symbol, chartEvidence, voyager, cs.source);
      } catch (e: any) {
        log.warn(runTag, `chart assembly setup failed: ${e?.message}`);
      }
    }

    // The executive summary exists for EVERY run that produced usable
    // skill output — including runs whose headline score was suppressed
    // for thin coverage (totalScore: null tells the model not to invent
    // a headline number). Only a run where every skill failed outright
    // (no usable output at all) skips synthesis.
    let report = null;
    const asOfStamp = new Date().toISOString().slice(0, 10);
    if (!isSkillRun && isUnscoreable(agg.scored_count)) {
      // Nothing scored at all (the v2 KEI case: 0Y/0P/0N, 6 of 6 anchors
      // insufficient). There is no honest report to write, so publish the
      // unavailable notice instead of a degraded one. This is the ONLY path
      // that voids a report — the consistency gate is advisory (finalize.ts).
      log.warn(runTag, `no skill produced a scoreable verdict — publishing an unavailable notice`);
      report = blockedReport(agg.failure_reason || "no anchor could be assessed from the returned data", asOfStamp);
    } else if (!isSkillRun && scoredOutputs.length > 0) {
      tracker.setDetail("finalize", "Synthesizing final report...");
      const degradedNote =
        skillErrors.length > 0
          ? `${skillErrors.length} of ${outputs.length} skills reported problems: ${skillErrors.slice(0, 2).join("; ")}`
          : agg.status === "degraded"
            ? "some skills could not assess every anchor (INSUFFICIENT data) — coverage is below 100%"
            : total == null
              ? "the deterministic total was withheld because coverage is below the reliability floor; the report carries no headline number"
              : undefined;
      report = await synthesizeSkillReport({
        modelId,
        llmKeys,
        agentPersona: persona,
        agentDisplayName: runLabel,
        outputs: scoredOutputs,
        totalScore: total,
        fitLow: totalLow,
        fitHigh: totalHigh,
        coverage: totalCoverage,
        asOf: new Date().toISOString().slice(0, 10),
        degraded: degradedNote,
        toolEvidence: toolEvidenceDigest(buildToolCallMap(outputs)),
        factsPack,
        stance,
      });

      // Resilience visibility: synthesis retries internally and degrades
      // to the deterministic fallback when the LLM still fails. Surface
      // that in the reasoning trace so a degraded summary is never silent.
      if (report.source === "fallback") {
        collector.push("log", "finalize", {
          text: "Executive summary degraded to the deterministic fallback — LLM synthesis failed after retries",
        });
      }

      // One assembly site, owned by skills/finalize.ts and shared with the
      // Inngest orchestrator. It gates the NARRATIVE only (never its own
      // Sources/scorecard sections), keeps a failed gate advisory instead of
      // voiding the report, and appends the code-rendered blocks exactly once
      // so a regeneration can't drop the scorecard or the plots.
      let scoreChartBlocks: ReportBlock[] = [];
      try {
        scoreChartBlocks = buildSkillScoreCharts(outputs, agg.per_skill, total);
      } catch (e: any) {
        log.warn(runTag, `score chart generation failed (continuing without): ${e?.message}`);
      }
      const finalized = await finalizeReport({
        narrative: report,
        factsPack,
        codeBlocks: [
          // Score summary tables (D2): no LLM transcription, no invented
          // totals, no rescaling.
          ...scoreTables,
          // Score visualizations: the run's own computed results, plotted from
          // the aggregate. Rendered even when the headline total is suppressed
          // — per-skill scores still exist and are worth plotting.
          ...scoreChartBlocks,
          // Sources & raw data: the verbatim tool observations and their URLs.
          ...buildSourcesBlocks(outputs),
        ],
        known: collectSkillKnownValues(outputs, total ?? 0),
        totalScore: total,
        stance,
        regenerate: (issues) =>
          synthesizeSkillReport({
            modelId,
            llmKeys,
            agentPersona: persona,
            agentDisplayName: runLabel,
            outputs: scoredOutputs,
            totalScore: total,
            fitLow: totalLow,
            fitHigh: totalHigh,
            coverage: totalCoverage,
            asOf: new Date().toISOString().slice(0, 10),
            degraded: degradedNote,
            toolEvidence: toolEvidenceDigest(buildToolCallMap(outputs)),
            factsPack,
            // temperature 0.6 + the issues it was rejected for, so the retry is an
            // actual second opinion. Re-running the identical prompt at
            // temperature 0.1 reproduced the same contradiction and cost a
            // whole synthesis call.
            temperature: 0.6,
            fixIssues: issues,
          }),
        onLog: (m) => log.warn(runTag, m),
      });
      report = finalized.report;
      log.info(runTag, `report ready (source=${report.source}) gate=${finalized.gate.pass ? "pass" : "advisory"}`);
    }

    // Skill-declared charts are code-assembled from real tool data, so they are
    // valid regardless of whether a verdict scored. Appending them here (not
    // inside the synthesis branch) keeps them on blocked/unavailable reports —
    // the reader still gets the price action we actually have.
    if (!isSkillRun && report && chartBlocksPromise) {
      try {
        const cb = await chartBlocksPromise;
        if (cb.length) report = { ...report, blocks: [...report.blocks, ...cb] };
      } catch (e: any) {
        log.warn(runTag, `chart assembly failed (continuing without): ${e?.message}`);
      }
    }

    // Same guard for the report patch: the user may cancel while the LLM is
    // synthesizing. Never let a late worker patch flip CANCELED to anything.
    const { data: stillActive } = await db
      .from("analysis_runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (String((stillActive as any)?.status || "").toUpperCase() === "CANCELED") {
      log.info(runTag, "run canceled during synthesis — discarding report patch");
      return;
    }

    const hasReport = !!(report as any)?.blocks?.length;
    const finalStatus = isSkillRun || hasReport ? "COMPLETED" : "FAILED";
    if (isSkillRun || hasReport) errorSummary = null;

    await write(() =>
      updateRun(runId, {
        status: finalStatus,
        error: errorSummary,
        duration: (Date.now() - started) / 1000,
        report,
        steps: finishStep(tracker.steps, "finalize", "completed"),
      }),
    );

    collector.push("log", "finalize", {
      text: `${finalStatus}${
        total != null
          ? ` — total score ${total} (coverage ${totalCoverage}%, band ${totalLow}\u2013${totalHigh})`
          : agg.scored_count > 0
            ? ` — score suppressed (coverage ${totalCoverage}% is below the ${Math.round(
                MIN_COVERAGE_FOR_SCORE * 100,
              )}% reliability floor) — read the skill reports`
            : " — nothing scored"
      }`,
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

/** Flatten per-skill tool histories into the map shape the evidence digest expects. */
function buildToolCallMap(outputs: { skill_name: string; tools_used?: string[]; error?: string }[]): Record<string, unknown[]> {
  const map: Record<string, unknown[]> = {};
  for (const o of outputs) {
    map[o.skill_name] = (o.tools_used || []).map((t) => ({ tool: t, status: o.error ? "ERR" : "OK" }));
  }
  return map;
}

/**
 * Group trace tool_result events into the per-skill map shape the chart
 * grounder reads — every result kept, not just the last one per skill.
 */
function traceToolCallMap(events: { key: string; tool?: string; result?: unknown }[]): Record<string, unknown[]> {
  const map: Record<string, unknown[]> = {};
  for (const ev of events) {
    if (!ev.tool) continue;
    (map[ev.key] ||= []).push({ tool_name: ev.tool, status: "OK", result: ev.result });
  }
  return map;
}

/**
 * Numeric-integrity allowlist for the skills pipeline: totals, per-skill
 * scores (raw + the rounded value the score chart prints), and every number
 * appearing in skill findings/verdict evidence, so the sanitize gate accepts
 * figures the pipeline itself computed or the analysts legitimately observed.
 */
export function collectSkillKnownValues(outputs: { findings: { title: string; detail: string }[]; verdicts: { evidence: string }[]; score_0_100?: number | null }[], totalScore: number): Set<number> {
  const known = new Set<number>();
  known.add(Math.round(totalScore * 10) / 10);
  for (const o of outputs) {
    if (typeof o?.score_0_100 === "number" && Number.isFinite(o.score_0_100)) {
      known.add(Math.round(o.score_0_100 * 10) / 10);
      known.add(Math.round(o.score_0_100));
    }
  }
  const visit = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      known.add(Math.round(v * 10) / 10);
    } else if (typeof v === "string") {
      for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const n = parseFloat(m[0]);
        if (Number.isFinite(n)) known.add(Math.round(n * 10) / 10);
      }
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(visit);
    }
  };
  for (const o of outputs) {
    o.findings?.forEach((f) => visit(f));
    o.verdicts?.forEach((v) => visit(v.evidence));
  }
  return known;
}
