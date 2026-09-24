import { getDb } from "./db.js";
import {
  VoyagerClient,
  VoyagerError,
  pullLastPulled,
  pullRecordCount,
  type PullStatus,
} from "./voyager.js";
import { log } from "./logger.js";

// ── Freshness thresholds ─────────────────────────────────────────────────
// Fundamental XBRL data (financials, ratios, margins). Re-pull if older than this.
export const FRESHNESS_FUNDAMENTAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Pull timing ──────────────────────────────────────────────────────────
// NSE pulls parse XBRL and can take minutes (docs: "can take minutes"); SEC
// pulls ~20-60s. Poll every 5s for up to 5 minutes before giving up.
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 60 * 5s = 300s max wait
// Absolute cap on the poll loop: if status polls themselves stall (busy single-
// worker instance mid-pull), wall time must not balloon past the intended window.
const PULL_WALL_MS = MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS;

// When POST /pull returns 409 ("a job for this key is already in progress"),
// wait and re-trigger a few times before falling back to adopting the running job.
const TRIGGER_409_RETRIES = 3;
const TRIGGER_409_DELAY_MS = 10_000;

// ── In-memory pull lock map ──────────────────────────────────────────────
// Key: `${symbol}:${source}:${userId}` — prevents duplicate concurrent pulls
// for the same stock by the same user. Resolves when the pull completes.
const activePulls = new Map<string, Promise<PullResult>>();

export interface PullResult {
  pulled: boolean;
  reason?: string;
  duration_ms?: number;
  data?: PullStatus;
}

// ── Local freshness check (fast, hits Supabase only) ─────────────────────

export async function isDataFresh(
  userId: string,
  symbol: string,
  source: string,
): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db
    .from("stock_pulls")
    .select("status, last_pulled_at")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("source", source)
    .single();

  if (error || !data) return false;
  if (data.status !== "completed" || !data.last_pulled_at) return false;

  const pulledAt = new Date(data.last_pulled_at).getTime();
  return Date.now() - pulledAt < FRESHNESS_FUNDAMENTAL_MS;
}

// ── Upsert stock_pulls record ────────────────────────────────────────────

async function upsertPullRecord(
  userId: string,
  symbol: string,
  country: string,
  source: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("stock_pulls")
    .upsert(
      {
        user_id: userId,
        symbol,
        country,
        source,
        updated_at: new Date().toISOString(),
        ...patch,
      },
      { onConflict: "user_id,symbol,source" },
    );
  if (error) {
    log.error("[freshness]", `upsert failed for ${symbol}: ${error.message}`);
  }
}

// ── Trigger pull and poll until completion ────────────────────────────────

function matchesJob(job: { symbol?: string; source?: string; status?: string }, symbol: string, source: string): boolean {
  return (
    String(job.symbol || "").toUpperCase() === symbol.toUpperCase() &&
    String(job.source || "").toLowerCase() === source &&
    (job.status === "queued" || job.status === "running")
  );
}

// A pull for this key is already in flight — find ours and poll it instead of
// erroring out. Returns the job_id of an active matching job, or null.
async function adoptRunningPull(
  voyager: VoyagerClient,
  symbol: string,
  source: string,
): Promise<string | null> {
  try {
    const jobs = await voyager.listPullJobs(20);
    const mine = jobs.find((j) => matchesJob(j, symbol, source));
    if (mine?.job_id) {
      log.info("[freshness]", `adopting in-progress pull for ${symbol} job_id=${mine.job_id}`);
      return mine.job_id;
    }
  } catch (e: any) {
    log.warn("[freshness]", `could not list pull jobs to adopt: ${e?.message}`);
  }
  return null;
}

async function triggerPullJob(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
): Promise<string> {
  // 409 = a job for this key is already running (same user, another symbol or
  // a duplicate concurrent analysis). Wait it out and re-trigger first.
  for (let attempt = 0; attempt <= TRIGGER_409_RETRIES; attempt++) {
    try {
      const result = await voyager.triggerPull(symbol, country, source, "quarterly", false);
      return result.job_id;
    } catch (e: any) {
      if (e instanceof VoyagerError && e.status === 409 && attempt < TRIGGER_409_RETRIES) {
        log.warn("[freshness]", `pull trigger 409 (job in progress), retry ${attempt + 1}/${TRIGGER_409_RETRIES}`);
        await new Promise((r) => setTimeout(r, TRIGGER_409_DELAY_MS));
        continue;
      }
      throw e;
    }
  }
  throw new VoyagerError(409, "Pull job already in progress after repeated attempts");
}

async function triggerAndWaitForPull(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
  userId: string,
): Promise<PullResult> {
  const started = Date.now();

  // Mark pulling state
  await upsertPullRecord(userId, symbol, country, source, {
    status: "pulling",
    job_id: null,
    data_available: false,
    records: 0,
    error: null,
  });

  // Trigger the pull (with 409 handling); on any other failure adopt an
  // existing running job for this symbol before giving up.
  let jobId: string;
  try {
    jobId = await triggerPullJob(voyager, symbol, country, source);
    log.info("[freshness]", `pull triggered for ${symbol} job_id=${jobId}`);
  } catch (e: any) {
    if (e instanceof VoyagerError && e.status === 409) {
      const adopted = await adoptRunningPull(voyager, symbol, source);
      if (adopted) {
        jobId = adopted;
      } else {
        const msg = "A pull for this key is already in progress; existing data will be used.";
        log.warn("[freshness]", msg);
        await upsertPullRecord(userId, symbol, country, source, {
          status: "failed",
          error: msg,
        });
        return { pulled: false, reason: msg };
      }
    } else {
      const msg = e?.message || String(e);
      log.error("[freshness]", `pull trigger failed for ${symbol}: ${msg}`);
      await upsertPullRecord(userId, symbol, country, source, {
        status: "failed",
        error: msg,
      });
      return { pulled: false, reason: `Pull trigger failed: ${msg}` };
    }
  }
  await upsertPullRecord(userId, symbol, country, source, { job_id: jobId });

  // Poll for completion
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (Date.now() - started >= PULL_WALL_MS) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const job = await voyager.getPullJobStatus(jobId);

      if (job.status === "done" || job.status === "completed" || job.status === "success") {
        // Pull completed — fetch final status (may still 404 briefly if the
        // metadata row lags behind; treat that as done-but-unconfirmable).
        let pullStatus: PullStatus | null = null;
        try {
          pullStatus = await voyager.getPullStatus(symbol, country, source);
        } catch (e: any) {
          log.warn("[freshness]", `final status check failed for ${symbol}: ${e?.message}`);
        }
        const total = pullRecordCount(pullStatus);
        const durationMs = Date.now() - started;

        await upsertPullRecord(userId, symbol, country, source, {
          status: "completed",
          last_pulled_at: pullLastPulled(pullStatus) || new Date().toISOString(),
          data_available: pullStatus?.available ?? total > 0,
          records: total,
          error: null,
        });

        log.info(
          "[freshness]",
          `pull completed for ${symbol} records=${total} duration=${durationMs}ms`,
        );
        return { pulled: true, duration_ms: durationMs, data: pullStatus ?? undefined };
      }

      if (job.status === "failed" || job.status === "error") {
        const msg = job.error || "Pull job failed on Voyager";
        await upsertPullRecord(userId, symbol, country, source, {
          status: "failed",
          error: msg,
        });
        return { pulled: false, reason: msg };
      }

      // Still running (queued/running) — continue polling
      log.debug(
        "[freshness]",
        `pull poll ${i + 1}/${MAX_POLL_ATTEMPTS} for ${symbol} status=${job.status}`,
      );
    } catch (e: any) {
      // Transient error during polling — don't abort, keep trying
      log.warn("[freshness]", `poll error for ${symbol}: ${e?.message}`);
    }
  }

  // Timeout — analysis proceeds with whatever data exists
  const durationMs = Date.now() - started;
  await upsertPullRecord(userId, symbol, country, source, {
    status: "timeout",
    error: `Pull timed out after ${Math.round(durationMs / 1000)}s`,
  });

  log.warn("[freshness]", `pull timed out for ${symbol} after ${durationMs}ms`);
  return {
    pulled: false,
    reason: `Pull timed out after ${Math.round(durationMs / 1000)}s`,
    duration_ms: durationMs,
  };
}

// ── Main orchestrator ────────────────────────────────────────────────────

export async function ensureFreshData(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
  userId: string,
): Promise<PullResult> {
  // Fast path: check local DB
  const localFresh = await isDataFresh(userId, symbol, source);
  if (localFresh) {
    return { pulled: false, reason: "Data already fresh (local check)" };
  }

  // Slow path: check Voyager directly (another user's key might have pulled it)
  try {
    const pullStatus = await voyager.getPullStatus(symbol, country, source);
    const lastPulled = pullLastPulled(pullStatus);
    if (lastPulled) {
      const pulledAt = new Date(lastPulled).getTime();
      if (Date.now() - pulledAt < FRESHNESS_FUNDAMENTAL_MS) {
        // Data is fresh on Voyager — save locally and skip pull
        const total = pullRecordCount(pullStatus);
        await upsertPullRecord(userId, symbol, country, source, {
          status: "completed",
          last_pulled_at: lastPulled,
          data_available: pullStatus?.available ?? total > 0,
          records: total,
          error: null,
        });
        return { pulled: false, reason: "Data already fresh (Voyager check)" };
      }
    }
  } catch (e: any) {
    log.warn("[freshness]", `Voyager status check failed for ${symbol}: ${e?.message}`);
  }

  // Data is stale or missing — trigger a pull directly (concurrency handled by Inngest)
  return triggerAndWaitForPull(voyager, symbol, country, source, userId);
}
