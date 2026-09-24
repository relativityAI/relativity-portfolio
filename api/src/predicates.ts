/**
 * Deterministic predicate evaluator (plan §6.3) — pure functions, no eval.
 *
 * Criteria that can be computed from the §6.2 feature catalog are written as
 * JSON-Logic expressions over a feature map and evaluated here exactly once
 * (auditable, reproducible). Any feature a predicate `requires` that is `null`
 * makes the criterion INSUFFICIENT — never 0 (unknown ≠ 0).
 *
 * Custom operators beyond json-logic-js's built-ins:
 *   count_gt(series, n, x)  -> how many of the LAST n values are strictly > x
 *   slope(series, n)        -> least-squares slope over the last n values
 *                              (index = time), per index step
 *   min_last(series, n)     -> minimum of the last n values
 *   pct_change(series, n)   -> (last - value[n ago]) / value[n ago] * 100 in
 *                              PERCENT units (matches the feature catalog)
 */

import jsonLogic from "json-logic-js";
import type { UnscoredReason } from "./scoring.js";

export type PredicateVerdict = "YES" | "NO" | "INSUFFICIENT";

export interface PredicateResult {
  verdict: PredicateVerdict;
  /** Reason when verdict is INSUFFICIENT. */
  unscored_reason?: UnscoredReason;
  /** Evaluated inputs, persisted for audit. */
  inputs: Record<string, unknown>;
  /** Final numeric comparison (true/false) behind a YES/NO verdict. */
  value?: unknown;
}

/** Slice the last `n` numeric values of a series. Nulls are dropped; too few → null. */
function lastN(series: number[] | number | null | undefined, n: number): number[] | null {
  if (!Array.isArray(series)) return null;
  const nums = series.map(Number).filter((v) => Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.slice(-Math.max(1, Math.floor(n)));
}

// Reuses toPercent so series comparisons match the canonical pct scale.
import { toNumber } from "./units.js";

function countGt(series: number[] | number | null, n: number, x: number): number | null {
  const last = lastN(series, n);
  if (!last) return null;
  return last.filter((v) => v > x).length;
}

function slope(series: number[] | number | null, n: number): number | null {
  const last = lastN(series, n);
  if (!last || last.length < 2) return null;
  // Least-squares slope over equally spaced time indices.
  const m = last.length;
  const sumX = (m * (m - 1)) / 2;
  const sumY = last.reduce((a, b) => a + b, 0);
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < m; i++) {
    sumXY += i * last[i];
    sumX2 += i * i;
  }
  const denom = m * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  return (m * sumXY - sumX * sumY) / denom;
}

function minLast(series: number[] | number | null, n: number): number | null {
  const last = lastN(series, n);
  if (!last) return null;
  return Math.min(...last);
}

function pctChange(series: number[] | number | null, n: number): number | null {
  if (!Array.isArray(series)) return null;
  const nums = series.map((v) => toNumber(v)).filter((v) => v !== null) as number[];
  const m = Math.min(nums.length, Math.max(1, Math.floor(n)));
  if (nums.length < 2 || m < 1) return null;
  const prev = nums[nums.length - 1 - m];
  const last = nums[nums.length - 1];
  if (prev === 0) return null;
  return ((last - prev) / Math.abs(prev)) * 100;
}

// No NaN/undefined leaks out of custom ops to poison later comparisons.
function safe(v: unknown): unknown {
  return typeof v === "number" && !Number.isFinite(v) ? null : v;
}

jsonLogic.add_operation("count_gt", (series, n, x) => safe(countGt(series as any, toNumber(n) ?? 1, toNumber(x) ?? Infinity)));
jsonLogic.add_operation("slope", (series, n) => safe(slope(series as any, toNumber(n) ?? 2)));
jsonLogic.add_operation("min_last", (series, n) => safe(minLast(series as any, toNumber(n) ?? 1)));
jsonLogic.add_operation("pct_change", (series, n) => safe(pctChange(series as any, toNumber(n) ?? 1)));

export interface Predicate {
  /** Expression in JSON-Logic form, over `{"var": "<featureKey>"}`. */
  expr: Record<string, unknown>;
  /** Feature keys this expression reads; null on any → INSUFFICIENT. */
  requires: string[];
}

/**
 * Evaluate one predicate against a feature map. Deterministic: same features,
 * same expr ⇒ same {verdict, inputs} byte for byte.
 */
export function evaluatePredicate(
  predicate: Predicate,
  features: Record<string, unknown>,
): PredicateResult {
  const missing = (predicate.requires || []).find((k) => features[k] === null || features[k] === undefined);
  if (missing !== undefined) {
    return {
      verdict: "INSUFFICIENT",
      unscored_reason: "missing_data",
      inputs: { requires: predicate.requires, missing_feature: missing },
    };
  }
  try {
    const value = jsonLogic.apply(predicate.expr, features);
    // A boolean result is the YES/NO; numeric results compare > 0.
    const verdict: PredicateVerdict = value === true || (typeof value === "number" && value > 0) ? "YES" : "NO";
    return { verdict, value, inputs: { expr: predicate.expr, value } };
  } catch {
    return {
      verdict: "INSUFFICIENT",
      unscored_reason: "error",
      inputs: { expr: predicate.expr, error: "evaluation failed" },
    };
  }
}

// Self-check: npx tsx src/predicates.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const roe = [10, 22, 18, 31, 26];
  const r = evaluatePredicate(
    { expr: { ">=": [{ count_gt: [{ var: "roe_annual" }, 5, 15] }, 3] }, requires: ["roe_annual"] },
    { roe_annual: roe },
  );
  console.assert(r.verdict === "YES", `count_gt: ${JSON.stringify(r)}`);
  const r2 = evaluatePredicate(
    { expr: { ">=": [{ count_gt: [{ var: "roe_annual" }, 5, 15] }, 5] }, requires: ["roe_annual"] },
    { roe_annual: roe },
  );
  console.assert(r2.verdict === "NO", `count_gt threshold: ${JSON.stringify(r2)}`);
  const r3 = evaluatePredicate({ expr: { ">=": [{ slope: [{ var: "op_margin" }, 5] }, 0] }, requires: ["op_margin"] }, { op_margin: [10, 12, 14, 16, 18] });
  console.assert(r3.verdict === "YES", `slope: ${JSON.stringify(r3)}`);
  const r4 = evaluatePredicate({ expr: { ">=": [{ min_last: [{ var: "net_margin" }, 3] }, 20] }, requires: ["net_margin"] }, { net_margin: [30, 22, 25] });
  console.assert(r4.verdict === "YES", `min_last: ${JSON.stringify(r4)}`);
  const r5 = evaluatePredicate({ expr: { ">=": [{ pct_change: [{ var: "revenue_annual" }, 3] }, 50] }, requires: ["revenue_annual"] }, { revenue_annual: [100, 130, 160, 200] });
  console.assert(r5.verdict === "YES", `pct_change: ${JSON.stringify(r5)}`);
  const r6 = evaluatePredicate({ expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] }, { roe_min_10y: null });
  console.assert(r6.verdict === "INSUFFICIENT", `null propagation: ${JSON.stringify(r6)}`);
  console.log("predicates OK");
}