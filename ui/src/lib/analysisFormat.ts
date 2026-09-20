/**
 * Shared result-page formatting + band semantics (plan 0.7 / D4 / E2–E4, E8).
 *
 * Bands live in ONE place so score colors mean the same thing everywhere
 * (previously 70/40 was hard-coded in several files with different scales,
 * including the 0.7/0.4-vs-0..100 bug in generateVerdict). Currency comes
 * from the instrument's market, not a hard-coded ₹.
 */

export type MarketCurrency = "INR" | "USD";

/** Market from the run's data source ("nse" | "sec" | …). Defaults to USD. */
export function currencyForSource(source?: string | null): MarketCurrency {
  return String(source || "").toLowerCase() === "nse" ? "INR" : "USD";
}

const CURRENCY_SYMBOL: Record<MarketCurrency, string> = { INR: "₹", USD: "$" };

/**
 * Market-aware compact currency (E4): ₹ in Cr/Lakh for Indian listings,
 * $ in M/B for US listings — never "₹…B" mixed conventions.
 */
export function formatCurrencyForMarket(val: number, currency: MarketCurrency = "USD"): string {
  const sym = CURRENCY_SYMBOL[currency];
  if (currency === "INR") {
    if (val >= 1e7) return `${sym}${(val / 1e7).toFixed(2)}Cr`;
    if (val >= 1e5) return `${sym}${(val / 1e5).toFixed(2)}L`;
    return `${sym}${val.toLocaleString()}`;
  }
  if (val >= 1e9) return `${sym}${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${sym}${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${sym}${(val / 1e3).toFixed(1)}K`;
  return `${sym}${val.toLocaleString()}`;
}

/** Action buckets live on the profile in the full plan; these are the defaults. */
export interface ScoreBands {
  shortlistAt: number; // score ≥ shortlistAt → shortlist
  watchAt: number; // score ≥ watchAt → watch, else pass
}

export const DEFAULT_BANDS: ScoreBands = { shortlistAt: 75, watchAt: 55 };

export type ActionBucket = "shortlist" | "watch" | "pass";

/** The verdict strip's action bucket — a process label, not investment advice. */
export function actionBucket(score: number, bands: ScoreBands = DEFAULT_BANDS): ActionBucket {
  if (score >= bands.shortlistAt) return "shortlist";
  if (score >= bands.watchAt) return "watch";
  return "pass";
}

export interface BandStyle {
  color: string;
  bg: string;
  label: string;
}

/** Shared band → color/label mapping on the 0–100 scale (fixes E3's scale bug). */
export function bandForScore(score: number | null | undefined): BandStyle {
  if (score == null) {
    return { color: "var(--ink-tertiary)", bg: "var(--surface-recessed)", label: "unscored" };
  }
  const bucket = actionBucket(score);
  if (bucket === "shortlist") {
    return { color: "var(--signal-positive)", bg: "transparent", label: "Shortlist" };
  }
  if (bucket === "watch") {
    return { color: "var(--signal-caution)", bg: "transparent", label: "Watch" };
  }
  return { color: "var(--signal-negative)", bg: "transparent", label: "Pass" };
}

/**
 * Map a score to the legacy 3-signal palette used by bars/indicators
 * (kept for visual continuity, now on one shared 0–100 scale).
 */
export function scoreSignal(score: number): "positive" | "caution" | "negative" {
  if (score >= DEFAULT_BANDS.watchAt) return "positive";
  if (score >= 40) return "caution";
  return "negative";
}

/**
 * Strip score scaffolding the pipeline leaves in analyst markdown (E2):
 * FINAL_SCORE lines, "Score: NN/100" headers and bare score-table stubs are
 * developer/debug output — the number already lives in the hero and tables.
 */
export function stripScoreScaffolding(markdown?: string | null): string {
  if (!markdown) return "";
  return markdown
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^FINAL_SCORE\s*[:：=]/i.test(t)) return false;
      if (/^[-*_>*\s#`]*\bFINAL_SCORE\b[:：=]?/i.test(t)) return false;
      // Bare one-line score stubs: "Score: 72/100", "**Final Score: 61.5**",
      // "# Final Score: 42 out of 100" — never prose that merely mentions a score.
      if (
        /^[-*_>*\s#`]*\*{0,2}(final\s+)?score\*{0,2}\s*[:：=]\s*\d+(\.\d+)?\s*(\/\s*100|out of 100)?\*{0,2}\.?$/i.test(
          t,
        )
      )
        return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Coverage → compact label for the chip beside the score (E8). */
export function coverageLabel(coverage?: number | null): string {
  if (coverage == null || !Number.isFinite(coverage)) return "";
  const pct = Math.round(coverage * (coverage <= 1 ? 100 : 1));
  return `${pct}%`;
}

/** Below the profile's minimum coverage the headline number is suppressed. */
export const MIN_COVERAGE_DEFAULT = 0.6;

export function insufficientCoverage(coverage?: number | null, min: number = MIN_COVERAGE_DEFAULT): boolean {
  return coverage != null && Number.isFinite(coverage) && coverage < min;
}
