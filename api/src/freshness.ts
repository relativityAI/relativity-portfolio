import { getDb } from "./db.js";

// ── Freshness thresholds ─────────────────────────────────────────────────
// Fundamental XBRL data (financials, ratios, margins). Re-pull if older than this.
export const FRESHNESS_FUNDAMENTAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
