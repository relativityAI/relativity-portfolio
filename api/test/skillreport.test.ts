import { describe, it, expect } from "vitest";
import { buildSkillFallbackReport } from "../src/agent.js";
import type { SkillOutput } from "../src/skills/types.js";

function output(over: Partial<SkillOutput> & { skill_id: string }): SkillOutput {
  return {
    skill_name: over.skill_id,
    category: "fundamental",
    weight: 5,
    findings: [],
    verdicts: [],
    tools_used: [],
    citations: [],
    raw_observations: [],
    scored_by: "llm",
    ...over,
  };
}

describe("report wiring (fallback)", () => {
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
