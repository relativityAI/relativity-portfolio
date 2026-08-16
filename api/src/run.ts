import { db, newId } from "./db.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, toCountrySource, type PullStatus } from "./voyager.js";
import { runQuantitative } from "./quant.js";
import { runQualitativeAll } from "./agent.js";
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
  web_search?: boolean;
  web_sources?: string[];
  voyagerApiKey?: string;
  keys: LlmKeys;
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

export async function createRun(req: RunRequest): Promise<{ analysis_id: string }> {
  const runId = newId();
  const run = {
    _id: runId,
    analysis_id: runId,
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
    price_data: null,
    quantitative_analysis: {},
    qualitative_analysis: {},
    qualitative_tool_calls: {},
    quantitative_score: null,
    qualitative_score: null,
    total_score: null,
  };
  await db().collection("analysis_runs").insertOne(run as any);
  executeRun(runId, req).catch((e) => {
    log.error(`[run ${runId}]`, "background execution failed:", e);
  });
  return { analysis_id: runId };
}

async function updateRun(runId: string, patch: Record<string, unknown>): Promise<void> {
  await db().collection("analysis_runs").updateOne(
    { _id: runId } as any,
    { $set: { ...patch, updated_at: new Date().toISOString() } },
  );
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
  const steps: RunStep[] = initialSteps();
  const runTag = `[run ${runId}] reqId=${req.reqId || "-"}`;

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
  const saveSteps = () => write(() => updateRun(runId, { steps }));
  const begin = async (key: string) => {
    steps.splice(0, steps.length, ...startStep(steps, key));
    await saveSteps();
  };
  const end = async (key: string, status: StepStatus, detail?: string) => {
    steps.splice(0, steps.length, ...finishStep(steps, key, status, detail));
    await saveSteps();
  };

  try {
    // ---- agent ----
    await begin("agent");
    const agent = await db()
      .collection("agents")
      .findOne({
        $and: [
          { user_id: req.userId },
          { $or: [{ name: req.agent_name }, { _id: req.agent_name }] },
        ],
      } as any);
    if (!agent) {
      await end("agent", "failed", "Agent not found");
      throw new Error(`Agent not found: ${req.agent_name}`);
    }
    await end("agent", "completed");

    const source = req.source || agent.source || "NSE";
    const cs = toCountrySource(source);
    await write(() => updateRun(runId, { status: "RUNNING", source }));
    log.info(runTag, `start symbol=${req.symbol} agent="${agent.name}" model=${req.model || DEFAULT_MODEL} source=${source}`);

    const voyagerApiKey = req.voyagerApiKey || config.voyagerApiKey;
    if (!voyagerApiKey) {
      const msg =
        "No Voyager API key configured. Add your Voyager API key in Settings before running an analysis.";
      await end("agent", "completed");
      await write(() => updateRun(runId, { status: "FAILED", error: msg }));
      log.error(runTag, msg);
      return;
    }
    const voyager = new VoyagerClient(config.voyagerUrl, voyagerApiKey, config.voyagerRpm);

    // ---- data availability ----
    await begin("data");
    let dataAvailability: PullStatus | null = null;
    try {
      dataAvailability = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
      await write(() => updateRun(runId, { data_availability: dataAvailability }));
      await end("data", "completed");
      const total = Object.values(dataAvailability?.collections ?? {}).reduce(
        (n, c) => n + (c?.records || 0),
        0,
      );
      log.info(runTag, `data availability records=${total} last_pulled=${dataAvailability?.last_pulled || "never"}`);
    } catch (e: any) {
      const detail = e?.message || String(e);
      await write(() => updateRun(runId, { data_availability: { error: detail } }));
      await end("data", "completed", detail);
      log.warn(runTag, `data availability check failed (continuing): ${detail}`);
    }

    // ---- quantitative ----
    await begin("quantitative");
    const quant = await runQuantitative(voyager, agent, req.symbol, cs.country, cs.source);
    await end("quantitative", "completed");
    log.info(runTag, `quant done score=${quant.quantitative_score} price_data=${quant.price_data}`);

    const toolCtx = {
      voyager,
      tavilyKey: req.keys.tavily,
      symbol: req.symbol,
      country: cs.country,
      source: cs.source,
      shareName: req.share_name || req.symbol,
    };

    // ---- qualitative ----
    const qualParams = [
      ...(agent?.asset_evaluation?.qualitative || []),
      ...(agent?.macro_evaluation?.qualitative || []),
    ];
    await begin("qualitative");
    let qual: {
      qualitative_analysis: Record<string, unknown>;
      qualitative_tool_calls: Record<string, unknown[]>;
      qualitative_score: number;
    } | null = null;
    let qualErrors: string[] = [];
    if (qualParams.length === 0) {
      await end("qualitative", "skipped", "No qualitative parameters");
    } else {
      qual = await runQualitativeAll(
        req.model || DEFAULT_MODEL,
        req.keys,
        toolCtx,
        agent,
        req.documents || [],
        req.web_search ?? false,
        req.web_sources || [],
        (done, total, label) => {
          const idx = steps.findIndex((s) => s.key === "qualitative");
          if (idx >= 0 && steps[idx].status === "running") {
            steps[idx].detail = `${done} of ${total} parameters scored — ${label}`;
            void saveSteps();
          }
        },
      );
      qualErrors = Object.entries(qual.qualitative_analysis)
        .filter(([, e]) => !!(e as any)?.error)
        .map(([label, e]) => `${label}: ${(e as any).error}`);
      await end(
        "qualitative",
        qualErrors.length ? "failed" : "completed",
        qualErrors.length
          ? `${qualErrors.length} qualitative parameter${qualErrors.length > 1 ? "s" : ""} failed`
          : undefined,
      );
      log.info(runTag, `qual done score=${qual.qualitative_score}`);
    }

    // ---- finalize ----
    await begin("finalize");
    const quantScore = quant.quantitative_score;
    const qualScore = qual?.qualitative_score ?? 0;
    let total = 0;
    if (quantScore > 0 && qualScore > 0) total = (quantScore + qualScore) / 2;
    else if (quantScore > 0) total = quantScore;
    else if (qualScore > 0) total = qualScore;
    total = Math.round(total * 100) / 100;

    const qualErrorSummary = qualErrors.length
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
        price_data: quant.price_data || null,
        steps: finishStep(steps, "finalize", "completed"),
      }),
    );
    log.info(runTag, `${finalStatus} total=${total} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    steps.splice(0, steps.length, ...failRunningStep(steps));
    await write(() => updateRun(runId, { steps })).catch(() => {});
    log.error(runTag, "execution failed:", e);
    await markFailed(runId, e, started);
  }
}
