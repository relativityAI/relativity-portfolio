/**
 * Skill aggregation — the code side of "the LLM scores nothing authoritative".
 *
 * Per skill: verdict credits Y=1 / P=0.5 / N=0; INSUFFICIENT = unscored (never
 * zero). score = credits / assessable x 100, coverage = assessable / anchors.
 * Run-level: total = weight-weighted mean over scored skills; unscored skills
 * are excluded from the point estimate and widen the uncertainty band.
 */

import type { SkillOutput } from "./types.js";

export interface SkillScore {
  skill_id: string;
  score_0_100: number | null;
  coverage: number;
  verdict_counts: { yes: number; partial: number; no: number; insufficient: number };
  scored_by: "llm" | "deterministic";
}

export interface AggregatedScores {
  total_score: number;
  fit_low: number;
  fit_high: number;
  coverage: number;
  per_skill: SkillScore[];
  scored_count: number;
  unscored_count: number;
  status: "ok" | "degraded" | "failed";
  failure_reason?: string;
}

/**
 * The coverage floor below which a headline number would mislead the investor
 * (Guide: below 60% coverage the score is suppressed, not shown with false
 * precision). A number assembled from mostly-unassessed anchors reads as a
 * verdict when it is really a guess.
 */
export const MIN_COVERAGE_FOR_SCORE = 0.6;

/**
 * Whether the weighted aggregate may be SHOWN as a fit score. `aggregate
 * .total_score` is still the honest point estimate for a fully-scored run;
 * when coverage is thin or nothing was scoreable, the value must be stored
 * but never surfaced as a headline the investor could act on.
 */
export function isScoreDisplayable(agg: Pick<AggregatedScores, "coverage" | "scored_count" | "total_score">): boolean {
  return agg.scored_count > 0 && Number.isFinite(agg.total_score) && agg.coverage >= MIN_COVERAGE_FOR_SCORE;
}

const CREDIT: Record<string, number> = { YES: 1, PARTIAL: 0.5, NO: 0 };

export function scoreSkillOutput(output: SkillOutput): SkillScore {
  const counts = { yes: 0, partial: 0, no: 0, insufficient: 0 };
  let credits = 0;
  let assessable = 0;

  for (const v of output.verdicts || []) {
    if (v.verdict === "INSUFFICIENT") {
      counts.insufficient++;
      continue;
    }
    const c = CREDIT[v.verdict];
    if (c === undefined) continue; // unknown verdict strings never count
    counts[v.verdict.toLowerCase() as "yes" | "partial" | "no"]++;
    credits += c;
    assessable++;
  }

  const anchorCount = output.verdicts?.length || 0;
  const coverage = anchorCount > 0 ? assessable / anchorCount : 0;
  const score = assessable > 0 ? Math.round((credits / assessable) * 10000) / 100 : null;

  return {
    skill_id: output.skill_id,
    score_0_100: score,
    coverage,
    verdict_counts: counts,
    scored_by: output.scored_by,
  };
}

export function aggregateSkillOutputs(outputs: SkillOutput[], weights: Record<string, number> = {}): AggregatedScores {
  const perSkill: SkillScore[] = outputs.map(scoreSkillOutput);

  const scored: { score: number; weight: number }[] = [];
  let totalWeight = 0;
  for (const s of perSkill) {
    const w = Math.max(1, Math.min(10, weights[s.skill_id] ?? 5));
    totalWeight += w;
    if (s.score_0_100 !== null) scored.push({ score: s.score_0_100, weight: w });
  }

  const scoredCount = scored.length;
  const unscoredCount = perSkill.length - scoredCount;

  if (perSkill.length === 0) {
    return {
      total_score: 0,
      fit_low: 0,
      fit_high: 0,
      coverage: 0,
      per_skill: perSkill,
      scored_count: 0,
      unscored_count: 0,
      status: "failed",
      failure_reason: "no skills produced output",
    };
  }

  if (scoredCount === 0) {
    return {
      total_score: 0,
      fit_low: 0,
      fit_high: 0,
      coverage: 0,
      per_skill: perSkill,
      scored_count: 0,
      unscored_count: perSkill.length,
      status: "failed",
      failure_reason: "no skill produced a scoreable verdict",
    };
  }

  // Weighted mean over scored skills.
  const weightedSum = scored.reduce((n, s) => n + s.score * s.weight, 0);
  const scoredWeight = scored.reduce((n, s) => n + s.weight, 0);
  const total = Math.round((weightedSum / scoredWeight) * 10) / 10;

  // Coverage = fraction of verdicts assessable across all skills with anchors,
  // weighted like the scores.
  let covCredits = 0;
  let covTotal = 0;
  for (const s of perSkill) {
    const w = Math.max(1, Math.min(10, weights[s.skill_id] ?? 5));
    covCredits += s.coverage * w;
    covTotal += w;
  }
  const coverage = covTotal > 0 ? Math.round((covCredits / covTotal) * 100) / 100 : 0;

  // Uns scored skills widen the band; a fully-scored run keeps it tight.
  const unscoredShare = unscoredCount / perSkill.length;
  const band = 5 + 30 * unscoredShare;
  const fitLow = Math.max(0, Math.round((total - band) * 10) / 10);
  const fitHigh = Math.min(100, Math.round((total + band) * 10) / 10);

  // "ok" only when every skill produced a score AND intra-skill coverage is
  // (near) complete — INSUFFICIENT anchors on fully-scored skills still mean
  // the number rests on partial data. The previous ternary had two identical
  // branches ("degraded" both ways), which also mislabelled low-coverage
  // fully-scored runs as "ok".
  const status: AggregatedScores["status"] =
    unscoredCount === 0 && coverage >= 0.99 ? "ok" : "degraded";

  return {
    total_score: total,
    fit_low: fitLow,
    fit_high: fitHigh,
    coverage,
    per_skill: perSkill,
    scored_count: scoredCount,
    unscored_count: unscoredCount,
    status,
  };
}
