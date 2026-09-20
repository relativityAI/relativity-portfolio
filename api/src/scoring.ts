/**
 * Scoring engine — deterministic, auditable, honest.
 *
 * Scale contract (plan §5.3): every item score is 0..100 or null.
 *   null = UNSCORED (missing data, outage, N/A). Unknown ≠ 0 — an unscored
 *   item never moves the point estimate; it widens the [fit_low, fit_high]
 *   band and reduces coverage instead.
 *
 * Weight contract: weight 0 means "excluded" (respected, never defaulted);
 * a missing/non-finite weight falls back to the default (5). Aggregation is
 * Σ w·s / Σ w over SCORED items only.
 */

/** Hard classification of why an item has no score. Drives UI + FAILED_DATA. */
export type UnscoredReason = "missing_data" | "price_unavailable" | "error" | "insufficient_data";

export interface ScoredItem {
  /** 0..100, or null when the item could not be scored. */
  score: number | null;
  weightage: number;
  /** Present when score is null: why it is unscored. */
  unscored_reason?: UnscoredReason;
  value?: unknown;
}

export interface ScoreAggregationOptions {
  /**
   * Legacy switch. The only remaining legitimate use is a "screen" where the
   * user explicitly wants missing data to count against the company. Default
   * false: unknown ≠ 0.
   */
  includeMissingAsZero?: boolean;
}

export interface AggregationResult {
  /** Point estimate over scored items only, 0..100 (rounded to 2dp). */
  score: number | null;
  /** Same sum treating unscored items as 0 — the pessimistic bound. */
  fit_low: number;
  /** Same sum treating unscored items as 100 — the optimistic bound. */
  fit_high: number;
  /** Σ weight(scored) / Σ weight(all), 0..1. */
  coverage: number;
  totalWeight: number;
  /** Σ weight of every non-excluded item (scored + unscored). */
  allWeight: number;
  weightedSum: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weight semantics: 0 = deliberately excluded; missing/non-finite = default. */
function effectiveWeight(item: ScoredItem): number | null {
  const w = item.weightage;
  if (typeof w !== "number" || !Number.isFinite(w)) return DEFAULT_WEIGHT;
  if (w < 0) return null; // invalid — excluded (save-time validation should prevent this)
  if (w === 0) return 0; // user zeroed it: excluded, not defaulted
  return w;
}

export const DEFAULT_WEIGHT = 5;

/**
 * Aggregate scored items. Point estimate uses scored items only; fit_low /
 * fit_high re-weight the same items treating every unscored one as 0 / 100,
 * so the honest headline is always `fit (fit_low–fit_high) · coverage %`.
 */
export function aggregateWeightedScores(
  items: ScoredItem[],
  options: ScoreAggregationOptions = {},
): AggregationResult {
  let totalWeight = 0; // weight of items that participate in the point estimate
  let allWeight = 0; // weight of everything except excluded (w≤0/invalid) items
  let scoredWeight = 0; // weight of items with a real score (drives coverage)
  let weightedSum = 0;
  let lowSum = 0;
  let highSum = 0;

  for (const item of items) {
    const weight = effectiveWeight(item);
    if (weight === null) continue;
    if (weight === 0) continue; // zero-weight: excluded from every aggregate

    allWeight += weight;

    const unscored = item.score === null || item.score === undefined || !!item.unscored_reason;
    if (unscored && !options.includeMissingAsZero) continue;

    if (!unscored) scoredWeight += weight;
    const s = unscored ? 0 : Math.max(0, Math.min(100, item.score as number));
    totalWeight += weight;
    weightedSum += s * weight;
    lowSum += s * weight;
    highSum += s * weight;
  }

  // Bounds fold unscored (but non-excluded) weight back in at 0 and 100,
  // re-denominated over ALL non-excluded weight. Even when
  // includeMissingAsZero opts missing data into the point estimate at 0, it
  // is still "unknown" for band purposes.
  const unscoredWeight = allWeight - scoredWeight;
  const fit_low = allWeight > 0 ? round2(lowSum / allWeight) : 0;
  const fit_high = allWeight > 0 ? round2((highSum + unscoredWeight * 100) / allWeight) : 0;
  const score = totalWeight > 0 ? round2(weightedSum / totalWeight) : null;

  return {
    score,
    fit_low,
    fit_high: round2(Math.min(100, fit_high)),
    coverage: allWeight > 0 ? round2(scoredWeight / allWeight) : 0,
    totalWeight,
    weightedSum,
    allWeight,
  };
}

export interface PillarScore {
  /** Pillar key, e.g. "quantitative" | "qualitative". */
  key: string;
  /** Result of aggregating the pillar's items — score may be null (unscored). */
  result: AggregationResult;
  /** Relative pillar weight. Default: equal for every scored pillar. */
  weight: number;
}

/**
 * Combine pillars (plan A3): replace the fixed 50/50 with declared weights,
 * and replace the `score > 0` presence test with an explicit null check.
 *
 * `total(q=0, qual=80)` with both scored is genuinely 40 — the old code
 * returned 80 because 0 *looked like* "absent". A pillar that could not be
 * scored at all (null, e.g. metrics outage) is excluded from the point
 * estimate and widens the band instead.
 */
export function combinePillars(pillars: PillarScore[]): AggregationResult {
  // A pillar participates if it has any non-excluded weight — even when every
  // item is unscored (outage/no data), it must widen the bounds rather than
  // silently vanish from the total.
  const active = pillars.filter((p) => p.weight > 0 && (p.result.allWeight ?? p.result.totalWeight) > 0);
  if (active.length === 0) {
    return { score: null, fit_low: 0, fit_high: 0, coverage: 0, totalWeight: 0, weightedSum: 0, allWeight: 0 };
  }

  const wsum = active.reduce((s, p) => s + p.weight, 0);
  let sum = 0;
  let low = 0;
  let high = 0;
  let weightPresent = 0;
  for (const p of active) {
    const w = p.weight / wsum;
    // == null catches both null and undefined (a pillar built from a raw
    // QuantResult carries `quantitative_score`, not `score` — treat any
    // missing numeric as unscored rather than poisoning the sum with NaN).
    const present = p.result.score != null;
    if (present) {
      sum += (p.result.score as number) * w;
      low += p.result.fit_low * w;
      high += p.result.fit_high * w;
      weightPresent += w;
    } else {
      // Pillar unscored: bounds treat it as 0 and 100.
      low += 0 * w;
      high += 100 * w;
    }
  }
  // Point estimate renormalizes over present pillars; the bounds stay
  // denominated over ALL active pillar weight (an unscored pillar pulls
  // fit_low down and fit_high up — it never vanishes, and it never shifts
  // the point estimate).
  return {
    score: weightPresent > 0 ? round2(sum / weightPresent) : null,
    fit_low: round2(low),
    fit_high: round2(Math.min(100, high)),
    coverage: round2(active.reduce((s, p) => s + (p.result.coverage * p.weight) / wsum, 0)),
    totalWeight: wsum,
    weightedSum: sum,
    allWeight: wsum,
  };
}

/**
 * Score a qualitative parameter from its parsed checklist in CODE (plan A4/A10):
 * the LLM gathers and judges evidence; arithmetic happens here.
 * credits: yes=1, partial=0.5, no=0; "insufficient data" is UNSCORED — it
 * reduces coverage instead of inflating the score.
 */
export type ChecklistVerdict = "YES" | "PARTIAL" | "NO" | "INSUFFICIENT DATA";

const VERDICT_CREDIT: Record<ChecklistVerdict, number> = {
  YES: 1,
  PARTIAL: 0.5,
  NO: 0,
  "INSUFFICIENT DATA": 0,
};

export function scoreChecklist(checklist: { criterion: string; verdict: string }[]): {
  score: number | null;
  coverage: number;
  fit_low: number;
  fit_high: number;
  counts: Record<ChecklistVerdict, number>;
} {
  const counts: Record<ChecklistVerdict, number> = {
    YES: 0,
    PARTIAL: 0,
    NO: 0,
    "INSUFFICIENT DATA": 0,
  };
  let credits = 0;
  let assessable = 0;
  for (const item of checklist || []) {
    const v = String(item.verdict || "").toUpperCase() as ChecklistVerdict;
    if (!(v in counts)) continue;
    counts[v] += 1;
    if (v === "INSUFFICIENT DATA") continue; // unscored, not a credit
    credits += VERDICT_CREDIT[v];
    assessable += 1;
  }

  const total = checklist?.length || 0;
  if (total === 0) {
    return { score: null, coverage: 0, fit_low: 0, fit_high: 0, counts };
  }
  // No assessable criteria at all → the parameter is unscored, never 100.
  if (assessable === 0) {
    return {
      score: null,
      coverage: 0,
      fit_low: 0,
      fit_high: Math.round((counts["INSUFFICIENT DATA"] / total) * 100 * 100) / 100,
      counts,
    };
  }
  const raw = (credits / assessable) * 100;
  const score = Math.round(raw * 100) / 100;
  const coverage = Math.round((assessable / total) * 10000) / 100;
  return {
    score,
    coverage,
    fit_low: Math.round(((credits / total) * 100) * 100) / 100,
    fit_high: Math.round((((credits + counts["INSUFFICIENT DATA"]) / total) * 100) * 100) / 100,
    counts,
  };
}
