import { getDb } from "./db.js";
import { VoyagerClient, type PullStatus } from "./voyager.js";
import { log } from "./logger.js";

// ── Freshness thresholds ─────────────────────────────────────────────────
// Fundamental XBRL data (financials, ratios, margins). Re-pull if older than this.
export const FRESHNESS_FUNDAMENTAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Pull timing ──────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 30; // 30 * 3s = 90s max wait

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

  // Trigger the pull
  let jobId: string;
  try {
    const result = await voyager.triggerPull(symbol, country, source, "quarterly", false);
    jobId = result.job_id;
    log.info("[freshness]", `pull triggered for ${symbol} job_id=${jobId}`);
    await upsertPullRecord(userId, symbol, country, source, { job_id: jobId });
  } catch (e: any) {
    const msg = e?.message || String(e);
    log.error("[freshness]", `pull trigger failed for ${symbol}: ${msg}`);
    await upsertPullRecord(userId, symbol, country, source, {
      status: "failed",
      error: msg,
    });
    return { pulled: false, reason: `Pull trigger failed: ${msg}` };
  }

  // Poll for completion
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const job = await voyager.getPullJobStatus(jobId);

      if (job.status === "done" || job.status === "completed" || job.status === "success") {
        // Pull completed — fetch final status
        const pullStatus = await voyager.getPullStatus(symbol, country, source);
        const total = Object.values(pullStatus?.collections ?? {}).reduce(
          (n, c) => n + (c?.records || 0),
          0,
        );
        const durationMs = Date.now() - started;

        await upsertPullRecord(userId, symbol, country, source, {
          status: "completed",
          last_pulled_at: pullStatus?.last_pulled || new Date().toISOString(),
          data_available: pullStatus?.available ?? total > 0,
          records: total,
          error: null,
        });

        log.info(
          "[freshness]",
          `pull completed for ${symbol} records=${total} duration=${durationMs}ms`,
        );
        return { pulled: true, duration_ms: durationMs, data: pullStatus };
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
  // SEC pulls not supported by Voyager
  if (source === "sec" || source === "SEC") {
    return { pulled: false, reason: "Automated data pulling is only supported for NSE stocks" };
  }

  // Fast path: check local DB
  const localFresh = await isDataFresh(userId, symbol, source);
  if (localFresh) {
    return { pulled: false, reason: "Data already fresh (local check)" };
  }

  // Slow path: check Voyager directly (another user's key might have pulled it)
  try {
    const pullStatus = await voyager.getPullStatus(symbol, country, source);
    if (pullStatus?.last_pulled) {
      const pulledAt = new Date(pullStatus.last_pulled).getTime();
      if (Date.now() - pulledAt < FRESHNESS_FUNDAMENTAL_MS) {
        // Data is fresh on Voyager — save locally and skip pull
        const total = Object.values(pullStatus?.collections ?? {}).reduce(
          (n, c) => n + (c?.records || 0),
          0,
        );
        await upsertPullRecord(userId, symbol, country, source, {
          status: "completed",
          last_pulled_at: pullStatus.last_pulled,
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
