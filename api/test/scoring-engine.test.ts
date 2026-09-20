/**
 * Scoring engine property tests (plan §5.3 / Phase 3 determinism + perturbation
 * suites, deterministic parts): monotonicity, zero-weight exclusion, coverage
 * honesty, pillar combination, checklist scoring.
 */
import { describe, it, expect } from "vitest";
import { aggregateWeightedScores, combinePillars, scoreChecklist } from "../src/scoring.js";
import { unscoredQuantResult } from "../src/quant.js";

describe("aggregateWeightedScores — determinism suite (§5.8)", () => {
  it("same inputs always produce identical outputs", () => {
    const items = [
      { score: 80, weightage: 5 },
      { score: 40, weightage: 3 },
      { score: null, weightage: 2, unscored_reason: "missing_data" as const },
    ];
    const a = aggregateWeightedScores(items);
    const b = aggregateWeightedScores(items.map((i) => ({ ...i })));
    expect(a).toEqual(b);
  });

  it("A1: score 1 stays 1 (no ×100 heuristic)", () => {
    const res = aggregateWeightedScores([
      { score: 1, weightage: 5 },
      { score: 60, weightage: 5 },
    ]);
    expect(res.score).toBe(30.5);
  });

  it("A2: zero weight is excluded, missing weight defaults, negative weight never aggregates", () => {
    const res = aggregateWeightedScores([
      { score: 10, weightage: 0 },
      { score: 80, weightage: 5 },
    ]);
    expect(res.score).toBe(80);
    expect(res.coverage).toBe(1);

    const defaulted = aggregateWeightedScores([
      { score: 100, weightage: undefined as any },
      { score: 0, weightage: 5 },
    ]);
    // (100*5 + 0*5) / 10 = 50
    expect(defaulted.score).toBe(50);

    const neg = aggregateWeightedScores([
      { score: 100, weightage: -3 },
      { score: 60, weightage: 5 },
    ]);
    expect(neg.score).toBe(60);
  });

  it("A3: a real quant score of 0 does not vanish — (0,80) is genuinely 40 with pillar weights", () => {
    const quant = aggregateWeightedScores([{ score: 0, weightage: 5 }]);
    const qual = aggregateWeightedScores([{ score: 80, weightage: 5 }]);
    const total = combinePillars([
      { key: "quantitative", result: quant, weight: 1 },
      { key: "qualitative", result: qual, weight: 1 },
    ]);
    expect(total.score).toBe(40);
  });

  it("A4/A5: unknown ≠ 0 — unscored items leave the point estimate and widen the band", () => {
    const res = aggregateWeightedScores([
      { score: 100, weightage: 5 },
      { score: null, weightage: 5, unscored_reason: "price_unavailable" as const },
    ]);
    expect(res.score).toBe(100); // point estimate over scored only
    expect(res.coverage).toBe(0.5);
    expect(res.fit_low).toBe(50);
    expect(res.fit_high).toBe(100);
  });

  it("perturbation: worsening a score never raises the aggregate (monotonicity)", () => {
    for (let trial = 0; trial < 25; trial++) {
      const items = Array.from({ length: 6 }, () => ({
        score: Math.round(Math.random() * 100),
        weightage: 1 + Math.floor(Math.random() * 9),
      }));
      const before = aggregateWeightedScores(items).score as number;
      const idx = Math.floor(Math.random() * items.length);
      items[idx].score = Math.max(0, items[idx].score - Math.ceil(Math.random() * 100));
      const after = aggregateWeightedScores(items).score as number;
      expect(after).toBeLessThanOrEqual(before + 1e-9);
    }
  });

  it("perturbation: zeroing a weight leaves the result unchanged (excluded, not defaulted)", () => {
    const items = [
      { score: 90, weightage: 4 },
      { score: 30, weightage: 6 },
    ];
    const withZero = aggregateWeightedScores([
      { score: 90, weightage: 4 },
      { score: 30, weightage: 6 },
      { score: 100, weightage: 0 },
    ]);
    expect(withZero.score).toBe(aggregateWeightedScores(items).score);
  });

  it("perturbation: dropping data lowers coverage and widens the band without moving the point estimate", () => {
    const full = aggregateWeightedScores([
      { score: 70, weightage: 5 },
      { score: 90, weightage: 5 },
    ]);
    const partial = aggregateWeightedScores([
      { score: 70, weightage: 5 },
      { score: 90, weightage: 5 },
      { score: null, weightage: 4, unscored_reason: "missing_data" as const },
    ]);
    expect(partial.score).toBe(full.score);
    expect(partial.coverage).toBeLessThan(full.coverage);
    expect(partial.fit_high - partial.fit_low).toBeGreaterThan(full.fit_high - full.fit_low);
  });

  it("all items unscored → null score, zero coverage", () => {
    const res = aggregateWeightedScores([{ score: null, weightage: 5, unscored_reason: "error" as const }]);
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
  });
});

describe("combinePillars (A3)", () => {
  it("supports declared pillar weights instead of hard-coded 50/50", () => {
    const quant = aggregateWeightedScores([{ score: 60, weightage: 5 }]);
    const qual = aggregateWeightedScores([{ score: 80, weightage: 5 }]);
    const tilted = combinePillars([
      { key: "quantitative", result: quant, weight: 3 },
      { key: "qualitative", result: qual, weight: 1 },
    ]);
    // (60*3 + 80*1) / 4 = 65
    expect(tilted.score).toBe(65);
  });

  it("a pillar that could not be scored (null) widens the band instead of vanishing", () => {
    const scored = aggregateWeightedScores([{ score: 80, weightage: 5 }]);
    const outage = aggregateWeightedScores([{ score: null, weightage: 5, unscored_reason: "error" as const }]);
    const total = combinePillars([
      { key: "quantitative", result: outage, weight: 1 },
      { key: "qualitative", result: scored, weight: 1 },
    ]);
    expect(total.score).toBe(80); // qual-only point estimate
    expect(total.coverage).toBeLessThan(1);
    expect(total.fit_low).toBe(40); // quant treated as 0 in the pessimistic bound
    expect(total.fit_high).toBe(90); // quant treated as 100 in the optimistic bound
  });
});

describe("scoreChecklist (A4/A10: code computes qual scores, not the LLM)", () => {
  it("1 YES + 4 INSUFFICIENT: coverage 20% and band (20–100) expose the thinness", () => {
    // §5.3 formula: point = credits/scored = 100, but fit_low = credits/total = 20
    // and coverage = 20%, so the UI's min_coverage gate suppresses the headline.
    const res = scoreChecklist([
      { criterion: "a", verdict: "YES" },
      { criterion: "b", verdict: "INSUFFICIENT DATA" },
      { criterion: "c", verdict: "INSUFFICIENT DATA" },
      { criterion: "d", verdict: "INSUFFICIENT DATA" },
      { criterion: "e", verdict: "INSUFFICIENT DATA" },
    ]);
    expect(res.score).toBe(100);
    expect(res.coverage).toBe(20);
    expect(res.fit_low).toBe(20);
    expect(res.fit_high).toBe(100);
  });

  it("all-INSUFFICIENT checklist is unscored — the old bug made this 100", () => {
    const res = scoreChecklist([
      { criterion: "a", verdict: "INSUFFICIENT DATA" },
      { criterion: "b", verdict: "INSUFFICIENT DATA" },
    ]);
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
  });

  it("credits: yes=1, partial=0.5, no=0 over assessable criteria", () => {
    const res = scoreChecklist([
      { criterion: "a", verdict: "YES" },
      { criterion: "b", verdict: "PARTIAL" },
      { criterion: "c", verdict: "NO" },
    ]);
    // (1 + 0.5 + 0) / 3 = 50
    expect(res.score).toBe(50);
    expect(res.coverage).toBe(100);
    expect(res.counts).toEqual({ YES: 1, PARTIAL: 1, NO: 1, "INSUFFICIENT DATA": 0 });
  });

  it("INSUFFICIENT items lower fit_low and raise fit_high but never the point estimate", () => {
    const res = scoreChecklist([
      { criterion: "a", verdict: "YES" },
      { criterion: "b", verdict: "NO" },
      { criterion: "c", verdict: "INSUFFICIENT DATA" },
    ]);
    expect(res.score).toBe(50);
    expect(res.fit_low).toBeCloseTo(33.33, 1);
    expect(res.fit_high).toBeCloseTo(66.67, 1);
  });

  it("empty checklist → unscored", () => {
    expect(scoreChecklist([]).score).toBeNull();
    expect(scoreChecklist([]).coverage).toBe(0);
  });
});

describe("unscoredQuantResult — metrics-outage degradation (revised 0.2)", () => {
  const agent = {
    asset_evaluation: {
      quantitative: [
        { metric: "roe", metric_name: "ROE", metric_type: "percentage", operator: "gte", value: 15, weightage: 8 },
      ],
    },
    macro_evaluation: {
      quantitative: [
        { metric: "pe_ratio", metric_name: "PE Ratio", metric_type: "multiple", operator: "lt", value: 25, weightage: 4 },
      ],
    },
  };

  it("marks every configured criterion unscored with the SAME rule-id keys as runQuantitative", () => {
    const res = unscoredQuantResult(agent, "unknown", "error");
    expect(Object.keys(res.quantitative_analysis).sort()).toEqual([
      "asset_evaluation:0:roe",
      "macro_evaluation:0:pe_ratio",
    ]);
    for (const e of Object.values(res.quantitative_analysis)) {
      expect(e.score).toBeNull();
      expect(e.unscored_reason).toBe("error");
    }
  });

  it("produces a null score with zero coverage — the qual pillar then carries the run", () => {
    const res = unscoredQuantResult(agent, "unknown", "error");
    expect(res.quantitative_score).toBeNull();
    expect(res.coverage).toBe(0);

    // The combine is exactly what the orchestrators do on outage: qual-only.
    // (Note the raw QuantResult spread: `score` is absent, `quantitative_score`
    // is null — combinePillars must treat that as unscored, not NaN.)
    const qual = aggregateWeightedScores([{ score: 65, weightage: 5 }]);
    const total = combinePillars([
      { key: "quantitative", result: { ...res, totalWeight: Object.keys(res.quantitative_analysis).length, allWeight: Object.keys(res.quantitative_analysis).length, weightedSum: 0 }, weight: 1 },
      { key: "qualitative", result: { ...qual, totalWeight: 1, allWeight: 1, weightedSum: 0 }, weight: 1 },
    ]);
    expect(total.score).toBe(65); // qual point estimate untouched by the outage
    expect(total.coverage).toBeLessThan(1);
    expect(total.fit_low).toBeLessThan(65);
    expect(total.fit_high).toBeGreaterThan(65);
  });

  it("handles an agent with no quantitative rules at all", () => {
    const res = unscoredQuantResult({}, "unknown", "error");
    expect(Object.keys(res.quantitative_analysis)).toEqual([]);
    expect(res.quantitative_score).toBeNull();
  });
});
