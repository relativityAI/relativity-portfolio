/**
 * Standardized scoring aggregation utility.
 * Enforces symmetry across quantitative and qualitative evaluation.
 */

export interface ScoredItem {
  score: number;
  weightage: number;
  error?: string;
  value?: unknown;
}

export interface ScoreAggregationOptions {
  /**
   * If true (default for quantitative), errored/missing parameters score 0 and their weightage is included in denominator.
   * If false (default for qualitative currently), errored parameters are excluded from denominator.
   */
  includeMissingAsZero?: boolean;
}

/**
 * Computes weighted score across items:
 *   totalScore = (totalWeight > 0) ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0
 */
export function aggregateWeightedScores(
  items: ScoredItem[],
  options: ScoreAggregationOptions = { includeMissingAsZero: false },
): { score: number; totalWeight: number; weightedSum: number } {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const item of items) {
    const weight = typeof item.weightage === "number" && item.weightage > 0 ? item.weightage : 5;
    const isError = !!item.error;

    if (isError && !options.includeMissingAsZero) {
      // Exclude errored item from totalWeight
      continue;
    }

    totalWeight += weight;
    const rawScore = isError ? 0 : Math.max(0, item.score);
    const normScore = rawScore <= 1.0 && rawScore > 0 ? rawScore * 100 : rawScore;
    weightedSum += normScore * weight;
  }

  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
  return { score, totalWeight, weightedSum };
}
