import { describe, it, expect } from "vitest";
import {
  aggregateSkillOutputs,
  isScoreDisplayable,
  MIN_COVERAGE_FOR_SCORE,
  scoreSkillOutput,
} from "../src/skills/aggregate.js";
import { runQuantScreen } from "../src/skills/quantscreen.js";
import type { SkillOutput, SkillDefinition } from "../src/skills/types.js";

function output(overrides: Partial<SkillOutput> = {}): SkillOutput {
  return {
    skill_id: "s1",
    skill_name: "Skill One",
    category: "fundamentals",
    weight: 5,
    findings: [],
    verdicts: [
      { anchor: "a", verdict: "YES", evidence: "e" },
      { anchor: "b", verdict: "PARTIAL", evidence: "e" },
      { anchor: "c", verdict: "NO", evidence: "e" },
      { anchor: "d", verdict: "INSUFFICIENT", evidence: "no data" },
    ],
    chart_requests: [],
    tools_used: [],
    scored_by: "llm",
    ...overrides,
  };
}

describe("scoreSkillOutput", () => {
  it("computes credits over assessable anchors only", () => {
    const s = scoreSkillOutput(output());
    // (1 + 0.5 + 0) / 3 = 50
    expect(s.score_0_100).toBe(50);
    expect(s.coverage).toBe(0.75);
    expect(s.verdict_counts).toEqual({ yes: 1, partial: 1, no: 1, insufficient: 1 });
  });

  it("all-INSUFFICIENT is unscored, never zero", () => {
    const s = scoreSkillOutput(
      output({ verdicts: [{ anchor: "a", verdict: "INSUFFICIENT", evidence: "-" }] }),
    );
    expect(s.score_0_100).toBeNull();
    expect(s.coverage).toBe(0);
  });

  it("a real zero scores 0, not N/A", () => {
    const s = scoreSkillOutput(
      output({ verdicts: [{ anchor: "a", verdict: "NO", evidence: "-" }] }),
    );
    expect(s.score_0_100).toBe(0);
  });
});

describe("isScoreDisplayable — no headline score without reliable coverage", () => {
  const agg = (o: Partial<Parameters<typeof isScoreDisplayable>[0]>) => ({
    scored_count: 1,
    total_score: 62,
    coverage: 1,
    ...o,
  });

  it("a real score with full coverage displays", () => {
    expect(isScoreDisplayable(agg({}))).toBe(true);
  });

  it("thin coverage is suppressed — no misleading headline for the investor", () => {
    expect(isScoreDisplayable(agg({ coverage: MIN_COVERAGE_FOR_SCORE - 0.01 }))).toBe(false);
  });

  it("exactly at the floor is displayable", () => {
    expect(isScoreDisplayable(agg({ coverage: MIN_COVERAGE_FOR_SCORE }))).toBe(true);
  });

  it("nothing scoreable is never displayable", () => {
    expect(isScoreDisplayable(agg({ scored_count: 0, total_score: NaN }))).toBe(false);
  });

  it("a non-finite total is never displayable", () => {
    expect(isScoreDisplayable(agg({ total_score: NaN }))).toBe(false);
  });
});

describe("aggregateSkillOutputs", () => {
  it("weights scored skills and excludes errors from the point estimate", () => {
    // Skill b produced NO verdicts at all (analyst died) — fully unscored.
    const agg = aggregateSkillOutputs(
      [output({ skill_id: "a" }), output({ skill_id: "b", verdicts: [], error: "boom" })],
      { a: 8, b: 2 },
    );
    expect(agg.scored_count).toBe(1);
    expect(agg.unscored_count).toBe(1);
    expect(agg.status).toBe("degraded");
    // Skill a is 50 with full weight when b is unscored.
    expect(agg.total_score).toBe(50);
    // Band widens when a skill is unscored.
    expect(agg.fit_high - agg.fit_low).toBeGreaterThan(0);
  });

  it("failed when no skill produced a scoreable verdict", () => {
    const agg = aggregateSkillOutputs([
      output({ verdicts: [{ anchor: "x", verdict: "INSUFFICIENT", evidence: "-" }] }),
    ]);
    expect(agg.status).toBe("failed");
    expect(agg.total_score).toBe(0);
  });
});

describe("runQuantScreen (deterministic rules)", () => {
  const skill: SkillDefinition = {
    id: "x-quant-screen",
    name: "Legacy — Quant Screen",
    description: "",
    category: "custom",
    version: 1,
    purpose: "",
    data: ["get_financial_metrics"],
    method: [],
    anchors: [
      { label: "Return on Equity > 15", weight: 8 },
      { label: "Debt to Equity < 0.5", weight: 7 },
      { label: "Made Up Metric > 3", weight: 5 },
    ],
    source: "custom",
  };

  it("scores rules from the metrics snapshot, INSUFFICIENT for unknown metrics", async () => {
    const out = await runQuantScreen(
      skill,
      output({ skill_id: "x", verdicts: [] }),
      { return_on_equity: 20, debt_to_equity: 0.3 },
    );
    expect(out.scored_by).toBe("deterministic");
    const roe = out.verdicts.find((v) => v.anchor.startsWith("Return on Equity"));
    const de = out.verdicts.find((v) => v.anchor.startsWith("Debt to Equity"));
    const unknown = out.verdicts.find((v) => v.anchor.startsWith("Made Up"));
    expect(roe?.verdict).toBe("YES");
    expect(de?.verdict).toBe("YES");
    expect(unknown?.verdict).toBe("INSUFFICIENT");
  });

  it("marks everything INSUFFICIENT when the snapshot is unavailable", async () => {
    const out = await runQuantScreen(skill, output({ skill_id: "x" }), null);
    expect(out.verdicts.every((v) => v.verdict === "INSUFFICIENT")).toBe(true);
  });

  it("gives PARTIAL credit under the soft boundary", async () => {
    // spread = max(15,1)*0.5 = 7.5 → value 12 is 3 below threshold → ~0.6 credit
    const out = await runQuantScreen(
      skill,
      output({ skill_id: "x" }),
      { return_on_equity: 12 },
    );
    const roe = out.verdicts.find((v) => v.anchor.startsWith("Return on Equity"));
    expect(roe?.verdict).toBe("PARTIAL");
  });
});
