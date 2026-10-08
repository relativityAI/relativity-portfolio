import { describe, it, expect } from "vitest";
import { buildSkillScoreCharts } from "../src/skills/charts.js";
import { buildSkillFallbackReport } from "../src/agent.js";
import { derivePlotsFromBlocks } from "../src/report/plots.js";
import type { SkillOutput } from "../src/skills/types.js";

function output(over: Partial<SkillOutput> & { skill_id: string }): SkillOutput {
  return {
    skill_name: over.skill_id,
    category: "fundamental",
    weight: 5,
    findings: [],
    verdicts: [],
    chart_requests: [],
    tools_used: [],
    citations: [],
    raw_observations: [],
    scored_by: "llm",
    ...over,
  };
}

const scored = [
  output({ skill_id: "growth", skill_name: "Growth", score_0_100: 71 }),
  output({ skill_id: "valuation", skill_name: "Valuation", score_0_100: 54 }),
  output({ skill_id: "quality", skill_name: "Quality", score_0_100: 63 }),
];

describe("report wiring (charts + fallback)", () => {
  it("score charts yield plottable blocks for the UI's PlotRenderer", () => {
    const blocks = buildSkillScoreCharts(scored, scored, 62);
    expect(blocks.some((b: any) => b.chartType === "radar")).toBe(true);
    expect(blocks.some((b: any) => b.chartType === "bar")).toBe(true);
    expect(derivePlotsFromBlocks(blocks).length).toBeGreaterThan(0);
  });

  it("returns nothing when no skill produced a score", () => {
    const unscored = [output({ skill_id: "growth", skill_name: "Growth", score_0_100: undefined, error: "boom" })];
    expect(buildSkillScoreCharts(unscored, unscored, null)).toEqual([]);
  });

  it("fallback report carries the skill's markdown analysis, not an empty section", () => {
    const report = buildSkillFallbackReport({
      modelId: "test",
      llmKeys: {},
      agentPersona: "",
      agentDisplayName: "Growth",
      outputs: [output({
        skill_id: "growth",
        skill_name: "Growth",
        analysis: "Score: 71/100\nRevenue compounding.",
        citations: [{ source: "get_financial_metrics", label: "ROCE", value: "18%" }],
      })],
      totalScore: 71,
      coverage: 100,
    });
    const texts = report.blocks.filter((b: any) => b.type === "paragraph").map((b: any) => b.text);
    expect(texts.some((t: string) => t.includes("Revenue compounding."))).toBe(true);
    expect(report.blocks.some((b: any) => b.type === "heading" && b.text === "Sources")).toBe(true);
  });
});
