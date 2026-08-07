import { db, newId } from "./db.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, ensureDataPulled, toCountrySource } from "./voyager.js";
import { runQuantitative } from "./quant.js";
import { runQualitativeAll } from "./agent.js";
import type { LlmKeys } from "./agent.js";

export interface RunRequest {
  symbol: string;
  share_name?: string;
  profile_name: string;
  model?: string;
  documents?: string[];
  web_search?: boolean;
  web_sources?: string[];
  voyagerUrl: string;
  keys: LlmKeys;
}

const DEFAULT_MODEL = "gemini/gemini-flash-lite-latest";

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
  { key: "profile", label: "Load portfolio profile" },
  { key: "data_pull", label: "Pull financial data" },
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
    status: "PENDING",
    symbol: req.symbol,
    share_name: req.share_name || req.symbol,
    profile_name: req.profile_name,
    model: req.model || getModelIds()[0] || DEFAULT_MODEL,
    documents: req.documents || [],
    web_search: req.web_search ?? false,
    web_sources: req.web_sources || [],
    source: null,
    created_at: new Date().toISOString(),
    duration: null,
    error: null,
    steps: initialSteps(),
    quantitative_analysis: {},
    qualitative_analysis: {},
    qualitative_tool_calls: {},
    quantitative_score: null,
    qualitative_score: null,
    total_score: null,
  };
  await db().collection("analysis_runs").insertOne(run as any);
  executeRun(runId, req).catch((e) => {
    console.error("[run] background execution failed:", e);
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
  } catch (e) {
    console.error("[run] failed to persist failure:", e);
  }
}

async function executeRun(runId: string, req: RunRequest): Promise<void> {
  const started = Date.now();
  const steps: RunStep[] = initialSteps();

  // Serialize every write to the run doc so out-of-order steps snapshots
  // (e.g. fire-and-forget progress updates) can't clobber newer ones.
  let queue: Promise<unknown> = Promise.resolve();
  const write = (fn: () => Promise<void>): Promise<void> => {
    const next = queue
      .then(fn, fn)
      .catch((e) => {
        console.error(`[run ${runId}] failed to persist progress:`, e);
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
    // ---- profile ----
    await begin("profile");
    const profile = await db()
      .collection("profiles")
      .findOne({ $or: [{ name: req.profile_name }, { _id: req.profile_name }] } as any);
    if (!profile) {
      await end("profile", "failed", "Profile not found");
      throw new Error(`Profile not found: ${req.profile_name}`);
    }
    await end("profile", "completed");

    const source = profile.source || "NSE";
    const cs = toCountrySource(source);
    await write(() => updateRun(runId, { status: "RUNNING", source }));
    console.log(`[run ${runId}] start ${req.symbol} | profile="${profile.name}" | model=${req.model || DEFAULT_MODEL} | source=${source}`);

    const voyager = new VoyagerClient(req.voyagerUrl || config.voyagerUrl);

    // ---- data pull ----
    await begin("data_pull");
    let pullInfo = { available: false };
    try {
      pullInfo = await ensureDataPulled(voyager, req.symbol, cs.country, cs.source);
      await end(
        "data_pull",
        "completed",
        pullInfo.available ? "Data ready" : "No stored data, continuing with live data",
      );
    } catch (e) {
      await end("data_pull", "failed", (e as Error).message);
    }
    console.log(`[run ${runId}] data pulled available=${pullInfo.available}`);

    // ---- quantitative ----
    await begin("quantitative");
    const quant = await runQuantitative(voyager, profile, req.symbol, cs.country, cs.source);
    await end("quantitative", "completed");
    console.log(`[run ${runId}] quant done score=${quant.quantitative_score}`);

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
      ...(profile?.asset_evaluation?.qualitative || []),
      ...(profile?.macro_evaluation?.qualitative || []),
    ];
    await begin("qualitative");
    let qual: {
      qualitative_analysis: Record<string, unknown>;
      qualitative_tool_calls: Record<string, unknown[]>;
      qualitative_score: number | null;
    } | null = null;
    if (qualParams.length === 0) {
      await end("qualitative", "skipped", "No qualitative parameters");
    } else {
      qual = await runQualitativeAll(
        req.model || DEFAULT_MODEL,
        req.keys,
        toolCtx,
        profile,
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
      await end("qualitative", "completed");
      console.log(`[run ${runId}] qual done score=${qual.qualitative_score}`);
    }

    // ---- finalize ----
    await begin("finalize");
    const quantScore = quant.quantitative_score;
    const qualScore = qual?.qualitative_score ?? null;
    let total: number | null = null;
    if (quantScore != null && qualScore != null) total = (quantScore + qualScore) / 2;
    else if (quantScore != null) total = quantScore;
    else if (qualScore != null) total = qualScore;

    await write(() =>
      updateRun(runId, {
        status: "COMPLETED",
        duration: (Date.now() - started) / 1000,
        quantitative_analysis: quant.quantitative_analysis,
        qualitative_analysis: qual?.qualitative_analysis || {},
        qualitative_tool_calls: qual?.qualitative_tool_calls || {},
        quantitative_score: quantScore,
        qualitative_score: qualScore,
        total_score: total,
        data_pulled: pullInfo.available,
        steps: finishStep(steps, "finalize", "completed"),
      }),
    );
    console.log(`[run ${runId}] COMPLETED total=${total} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    steps.splice(0, steps.length, ...failRunningStep(steps));
    await write(() => updateRun(runId, { steps })).catch(() => {});
    console.error("[run] execution failed:", e);
    await markFailed(runId, e, started);
  }
}
