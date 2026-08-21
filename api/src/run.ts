import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, toCountrySource, type PullStatus } from "./voyager.js";
import { runQuantitative, fetchMetricsSnapshot, assessDataAdequacy, type DataAdequacy } from "./quant.js";
import { runQualitativeAll } from "./agent.js";
import { ensureFreshData } from "./freshness.js";
import type { LlmKeys } from "./agent.js";
import { log } from "./logger.js";

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

const DEFAULT_MODEL = "gemini/gemini-3.5-flash-lite";

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
  { key: "finalize", label: "Finalize report" },
];

function initialSteps(): RunStep[] {
  return STEP_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    status: "pending",
    started_at: null,
    finished_at: null,
    duration_ms: null,
  }));
}

function startStep(steps: RunStep[], key: string): RunStep[] {
  return steps.map((s) =>
    s.key === key
      ? { ...s, status: "running", started_at: new Date().toISOString(), finished_at: null, duration_ms: null, detail: undefined }
      : s,
  );
}

function finishStep(steps: RunStep[], key: string, status: StepStatus, detail?: string): RunStep[] {
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

  constructor(private readonly save: () => Promise<void>) {}

  async begin(key: string): Promise<void> {
    this.steps = startStep(this.steps, key);
    await this.save();
  }

  async end(key: string, status: StepStatus, detail?: string): Promise<void> {
    this.steps = finishStep(this.steps, key, status, detail);
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

export async function createRun(req: RunRequest): Promise<{ analysis_id: string }> {
  const runId = randomUUID();
  const db = getDb();
  const run = {
    id: runId,
    user_id: req.userId,
    status: "PENDING",
    symbol: req.symbol,
    share_name: req.share_name || req.symbol,
    agent_name: req.agent_name,
    model: req.model || getModelIds()[0] || DEFAULT_MODEL,
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
  };
  const { error } = await db.from("analysis_runs").insert(run);
  if (error) throw error;
  executeRun(runId, req).catch((e) => {
    log.error(`[run ${runId}]`, "background execution failed:", e);
  });
  return { analysis_id: runId };
}

async function updateRun(runId: string, patch: Record<string, unknown>): Promise<void> {
  const db = getDb();
  await db.from("analysis_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", runId);
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
  const tracker = new StepTracker(saveSteps);

  try {
    // ---- agent ----
    await tracker.begin("agent");
    const { data: agent, error: agentErr } = await db
      .from("agents")
      .select("*")
      .eq("user_id", req.userId)
      .or(`name.eq.${req.agent_name},id.eq.${req.agent_name}`)
      .single();
    if (agentErr || !agent) {
      await tracker.end("agent", "failed", "Agent not found");
      throw new Error(`Agent not found: ${req.agent_name}`);
    }
    await tracker.end("agent", "completed");

    const source = req.source || agent.source || "NSE";
    const cs = toCountrySource(source);
    await write(() => updateRun(runId, { status: "RUNNING", source }));
    log.info(runTag, `start symbol=${req.symbol} agent="${agent.name}" model=${req.model || DEFAULT_MODEL} source=${source}`);

    // Fetch user's Voyager key and LLM keys from DB
    const { voyagerKey, llmKeys } = await fetchUserKeys(req.userId);
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
      dataAvailability = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
      await write(() => updateRun(runId, { data_availability: dataAvailability }));
      await tracker.end("data", "completed");
      const total = Object.values(dataAvailability?.collections ?? {}).reduce(
        (n, c) => n + (c?.records || 0),
        0,
      );
      log.info(runTag, `data availability records=${total} last_pulled=${dataAvailability?.last_pulled || "never"}`);
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
    const { metrics, price_data } = await fetchMetricsSnapshot(voyager, req.symbol, cs.country, cs.source);
    const adequacy = assessDataAdequacy(dataAvailability, metrics);
    const quant = runQuantitative(agent, metrics, price_data);
    await tracker.end("quantitative", "completed");
    log.info(
      runTag,
      `quant done score=${quant.quantitative_score} price_data=${price_data} adequacy=${adequacy}`,
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

    // ---- qualitative ----
    const qualParams = [
      ...(agent?.asset_evaluation?.qualitative || []),
      ...(agent?.macro_evaluation?.qualitative || []),
    ];
    await tracker.begin("qualitative");
    let qual: {
      qualitative_analysis: Record<string, unknown>;
      qualitative_tool_calls: Record<string, unknown[]>;
      qualitative_score: number;
    } | null = null;
    let qualErrors: string[] = [];
    if (qualParams.length === 0) {
      await tracker.end("qualitative", "skipped", "No qualitative parameters");
    } else {
      qual = await runQualitativeAll(
        req.model || DEFAULT_MODEL,
        llmKeys,
        toolCtx,
        agent,
        req.documents || [],
        web.effective !== "off",
        adequacy,
        (done, total, label) => {
          tracker.setDetail("qualitative", `${done} of ${total} parameters scored — ${label}`);
        },
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
      log.info(runTag, `qual done score=${qual.qualitative_score}`);
    }

    // ---- finalize ----
    // Run only fails when every qualitative parameter failed; partial results
    // complete with per-parameter errors preserved in the report.
    await tracker.begin("finalize");
    const quantScore = quant.quantitative_score;
    const qualScore = qual?.qualitative_score ?? 0;
    let total = 0;
    if (quantScore > 0 && qualScore > 0) total = (quantScore + qualScore) / 2;
    else if (quantScore > 0) total = quantScore;
    else if (qualScore > 0) total = qualScore;
    total = Math.round(total * 100) / 100;

    const qualTotal = Object.keys(qual?.qualitative_analysis || {}).length;
    const allQualFailed = qualTotal > 0 && qualErrors.length === qualTotal;
    const qualErrorSummary = allQualFailed
      ? `Qualitative scoring failed — ${qualErrors.join("; ")}`
      : null;
    const finalStatus = qualErrorSummary ? "FAILED" : "COMPLETED";

    await write(() =>
      updateRun(runId, {
        status: finalStatus,
        error: qualErrorSummary,
        duration: (Date.now() - started) / 1000,
        quantitative_analysis: quant.quantitative_analysis,
        qualitative_analysis: qual?.qualitative_analysis || {},
        qualitative_tool_calls: qual?.qualitative_tool_calls || {},
        quantitative_score: quantScore,
        qualitative_score: qualScore,
        total_score: total,
        price_data: price_data || null,
        steps: finishStep(tracker.steps, "finalize", "completed"),
      }),
    );
    log.info(runTag, `${finalStatus} total=${total} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    tracker.steps = failRunningStep(tracker.steps);
    await write(() => updateRun(runId, { steps: tracker.steps })).catch(() => {});
    log.error(runTag, "execution failed:", e);
    await markFailed(runId, e, started);
  }
}
