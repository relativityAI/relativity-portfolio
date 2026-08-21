import { describe, it, expect } from "vitest";
import { parseFinalScoreResult } from "../src/agent.js";
import { assessDataAdequacy, evaluateMetric, runQuantitative } from "../src/quant.js";
import { resolveWebSearch } from "../src/run.js";

describe("parseFinalScoreResult", () => {
  it("parses plain FINAL_SCORE line", () => {
    expect(parseFinalScoreResult("blah\nFINAL_SCORE: 75")).toEqual({ score: 75, found: true });
  });

  it("parses fullwidth colon and = separator", () => {
    expect(parseFinalScoreResult("FINAL_SCORE：80").found).toBe(true);
    expect(parseFinalScoreResult("FINAL_SCORE = 60").found).toBe(true);
  });

  it("parses markdown-emphasized score", () => {
    expect(parseFinalScoreResult("FINAL_SCORE: **88**")).toEqual({ score: 88, found: true });
  });

  it("falls back to loose spacing variant", () => {
    expect(parseFinalScoreResult("final score of 42/100").score).toBe(42);
  });

  it("clamps out-of-range values", () => {
    expect(parseFinalScoreResult("FINAL_SCORE: 250").score).toBe(100);
  });

  it("reports not-found for missing line", () => {
    expect(parseFinalScoreResult("no score here")).toEqual({ score: 50, found: false });
  });
});

describe("assessDataAdequacy", () => {
  it("inadequate when no records and no metrics", () => {
    expect(assessDataAdequacy(null, {})).toBe("inadequate");
    expect(assessDataAdequacy({ collections: {} }, { price_data: "unavailable" })).toBe("inadequate");
  });

  it("sparse below thresholds", () => {
    const collections = { financials: { records: 10 }, announcements: { records: 5 } };
    expect(assessDataAdequacy({ collections }, { roe: 1, pe: 2 })).toBe("sparse");
  });

  it("adequate above thresholds", () => {
    const collections: Record<string, { records: number }> = {};
    for (let i = 0; i < 6; i++) collections[`c${i}`] = { records: 20 };
    const metrics: Record<string, number> = {};
    for (let i = 0; i < 12; i++) metrics[`m${i}`] = i;
    expect(assessDataAdequacy({ collections }, metrics)).toBe("adequate");
  });
});

describe("evaluateMetric", () => {
  const base = { metric_name: "roe", metric_type: "percentage", weightage: 5 };

  it("scores gt full when above threshold", () => {
    const e = evaluateMetric({ returnonequity: 20 }, { ...base, metric: "roe", operator: "gt", value: 15 }, "asset_evaluation");
    expect(e.score).toBe(1);
  });

  it("decays linearly toward threshold", () => {
    // threshold 15, spread max(15,1)*0.5=7.5 → value 12 sits 4.5/7.5 up the ramp
    const e = evaluateMetric({ x: 12 }, { ...base, metric: "x", operator: "gt", value: 15 }, "asset_evaluation");
    expect(e.score).toBeCloseTo(0.6, 3);
  });

  it("handles between with upper bound", () => {
    const e = evaluateMetric({ x: 7 }, { ...base, metric: "x", operator: "between", value: 5, value_upper: 10 }, "asset_evaluation");
    expect(e.score).toBe(1);
    const outside = evaluateMetric({ x: 20 }, { ...base, metric: "x", operator: "between", value: 5, value_upper: 10 }, "asset_evaluation");
    expect(outside.score).toBe(0);
  });

  it("evaluates dates binary", () => {
    const e = evaluateMetric({ d: "2024-06-01" }, { ...base, metric: "d", metric_type: "date", operator: "after", value: "2024-01-01" }, "asset_evaluation");
    expect(e.score).toBe(1);
  });

  it("evaluates text case-insensitively", () => {
    const e = evaluateMetric({ t: "Yes" }, { ...base, metric: "t", metric_type: "text", operator: "eq", value: "yes" }, "asset_evaluation");
    expect(e.score).toBe(1);
  });

  it("flags price-derived criteria as unavailable instead of failing hard", () => {
    const e = evaluateMetric({}, { ...base, metric: "pe", category: "valuation", operator: "lt", value: 20 }, "asset_evaluation", "unavailable");
    expect(e.price_unavailable).toBe(true);
    expect(e.score).toBe(0);
  });

  it("missing data scores 0 with weight kept", () => {
    const e = evaluateMetric({}, { ...base, metric: "nope", operator: "gt", value: 1 }, "asset_evaluation");
    expect(e.score).toBe(0);
    expect(e.weightage).toBe(5);
  });
});

describe("runQuantitative", () => {
  it("weights and averages across sections", () => {
    const agent = {
      asset_evaluation: { quantitative: [{ metric: "a", metric_type: "number", operator: "gt", value: 0, weightage: 3 }] },
      macro_evaluation: { quantitative: [{ metric: "b", metric_type: "number", operator: "gt", value: 0, weightage: 1 }] },
    };
    const r = runQuantitative(agent, { a: 5, b: -5 }, "live");
    // a=1 (w3), b=0 (w1) → 0.75 → 75
    expect(r.quantitative_score).toBe(75);
  });
});

describe("resolveWebSearch", () => {
  it("explicit true with key → user", () => {
    expect(resolveWebSearch(true, "adequate", "tk")).toEqual({ effective: "user" });
  });

  it("explicit true without key → off + note", () => {
    const r = resolveWebSearch(true, "adequate");
    expect(r.effective).toBe("off");
    expect(r.note).toBeTruthy();
  });

  it("explicit false always off, no note", () => {
    expect(resolveWebSearch(false, "inadequate", "tk")).toEqual({ effective: "off" });
  });

  it("auto-on when inadequate + key", () => {
    const r = resolveWebSearch(undefined, "sparse", "tk");
    expect(r.effective).toBe("auto");
    expect(r.note).toContain("sparse");
  });

  it("no auto without key, but notes the gap", () => {
    const r = resolveWebSearch(undefined, "inadequate");
    expect(r.effective).toBe("off");
    expect(r.note).toContain("Tavily");
  });

  it("adequate data stays off", () => {
    expect(resolveWebSearch(undefined, "adequate", "tk").effective).toBe("off");
  });
});
