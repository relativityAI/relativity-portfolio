import { describe, it, expect } from "vitest";
import { parseMd, serializeMd, parseRule, type AgentConfig } from "../src/mdconfig.js";

// The v2 preset fixtures moved to archives with the v2→v3 migration; the v2
// parser survives ONLY as the migration grammar. These tests now cover the
// migration path with inline v2 documents.
const V2_SAMPLE = `---
name: Warren Buffett
description: moats and margin of safety
investment_horizon: Long-term (years)
risk_appetite: 4
---

## Philosophy

Buy wonderful businesses at fair prices.

## Asset Evaluation

### Qualitative

#### Economic Moat — weight 9

Does the company have a durable advantage?

### Quantitative

| Metric | Rule | Weight |
|---|---|---|
| Return on Equity | > 15% | 8 |
| Debt to Equity | < 0.5 | 7 |

## Macro Evaluation

### Qualitative

#### Market-Wide Valuation — weight 7

Is the market expensive?
`;

describe("parseMd — v2 migration grammar (legacy documents)", () => {
  it("parses a legacy v2 agent document", () => {
    const { agent, issues } = parseMd(V2_SAMPLE);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(agent?.name).toBe("Warren Buffett");
    expect(agent?.asset_evaluation.qualitative[0]).toMatchObject({ parameter: "Economic Moat", weightage: 9 });
    expect(agent?.asset_evaluation.quantitative[0]).toMatchObject({ metric: "return_on_equity", operator: "gt", value: 15, weightage: 8 });
  });

  it("generated md is serialization-stable (idempotent round-trip)", () => {
    const { agent } = parseMd(V2_SAMPLE);
    const md = serializeMd(agent!);
    expect(serializeMd(parseMd(md).agent!)).toBe(md);
  });
});

describe("serializeMd — hand-edit preservation", () => {
  it("carries opaque sections verbatim through a structured edit", () => {
    const prev = V2_SAMPLE + "\n\n## Screening Checklist\n\n- moat widening\n- mgmt buys on dips\n";
    const agent = parseMd(V2_SAMPLE).agent!;
    const edited = { ...agent, name: "Buffett v2" };
    const out = serializeMd(edited, prev);
    expect(out).toContain("## Screening Checklist");
    expect(out).toContain("- moat widening\n- mgmt buys on dips");
    const { agent: reparsed } = parseMd(out);
    expect(reparsed!.name).toBe("Buffett v2");
    expect(reparsed!.asset_evaluation.qualitative).toEqual(edited.asset_evaluation.qualitative);
  });

  it("keeps unknown frontmatter keys through a round-trip", () => {
    const prev = "---\nname: Growth (GARP / Fisher)\nrisk_appetite: 7\ncustom_field: foobar\n---\n\n## Philosophy\n\nhi\n";
    const agent = parseMd(prev).agent!;
    const out = serializeMd(agent, prev);
    expect(out).toContain("custom_field: foobar");
  });

  it("omits empty evaluation sections", () => {
    const agent: AgentConfig = {
      name: "Minimal",
      persona: { philosophy_and_mindset: "" },
      configuration: { investment_horizon: "", risk_appetite: 5 },
      asset_evaluation: { qualitative: [], quantitative: [] },
      macro_evaluation: { qualitative: [], quantitative: [] },
    };
    const md = serializeMd(agent);
    expect(md).not.toContain("## Asset Evaluation");
  });
});

describe("parseMd — validation issues", () => {
  it("reports missing frontmatter with a line number", () => {
    const { agent, issues } = parseMd("## Philosophy\nhi");
    expect(agent).toBeNull();
    expect(issues[0]).toMatchObject({ line: 1, severity: "error", message: expect.stringContaining("frontmatter") });
  });

  it("reports bad weightage and unknown weight syntax", () => {
    const md = "---\nname: X\n---\n\n## Asset Evaluation\n\n### Qualitative\n\n#### Test — weight 42\n\nhello\n";
    const { issues } = parseMd(md);
    expect(issues.find((i) => i.severity === "error")?.message).toContain("weightage must be an integer 1-10");
  });

  it("reports a missing weight in a parameter heading", () => {
    const md = "---\nname: X\n---\n\n## Asset Evaluation\n\n### Qualitative\n\n#### Test\n\nhello\n";
    const { issues } = parseMd(md);
    expect(issues.find((i) => i.severity === "error")?.message).toContain("missing weight");
  });

  it("reports unparseable rules", () => {
    const md = `---\nname: X\n---\n\n## Asset Evaluation\n\n### Quantitative\n\n| Metric | Rule | Weight |\n|---|---|---|\n| Made Up Metric | sideways | 5 |\n`;
    const { issues } = parseMd(md);
    expect(issues.some((i) => i.severity === "error" && /unparseable rule/.test(i.message))).toBe(true);
  });

  it("warns on unknown metrics but keeps the rule when the syntax is valid", () => {
    const md = `---\nname: X\n---\n\n## Macro Evaluation\n\n### Quantitative\n\n| Metric | Rule | Weight |\n|---|---|---|\n| VIX Gap Up | > 30 | 4 |\n`;
    const { agent, issues } = parseMd(md);
    expect(issues.some((i) => i.severity === "warn" && /unknown metric/.test(i.message))).toBe(true);
    expect(agent?.macro_evaluation.quantitative).toHaveLength(1);
    expect(agent?.macro_evaluation.quantitative[0].metric).toBe("VIX Gap Up");
    expect(agent?.macro_evaluation.quantitative[0].operator).toBe("gt");
  });

  it("requires a name in frontmatter", () => {
    const { issues } = parseMd("---\nrisk_appetite: 5\n---\n");
    expect(issues.some((i) => i.severity === "error" && /name/.test(i.message))).toBe(true);
  });
});

describe("parseRule — natural-language thresholds", () => {
  const cases: [string, ReturnType<typeof parseRule>][] = [
    ["> 15%", { operator: "gt", value: 15, metric_type: "percentage" }],
    [">= 55", { operator: "gte", value: 55, metric_type: "number" }],
    ["≥ 20", { operator: "gte", value: 20, metric_type: "number" }],
    ["< 0.5", { operator: "lt", value: 0.5, metric_type: "number" }],
    ["<= 10", { operator: "lte", value: 10, metric_type: "number" }],
    ["= Yes", { operator: "eq", value: "Yes", metric_type: "text" }],
    ["55 to 75", { operator: "between", value: 55, value_upper: 75, metric_type: "number" }],
    ["55 - 75", { operator: "between", value: 55, value_upper: 75, metric_type: "number" }],
    ["> $100", { operator: "gt", value: 100, metric_type: "currency" }],
    ["> 2024-01-01", { operator: "gt", value: "2024-01-01", metric_type: "date" }],
    ["> -5", { operator: "gt", value: -5, metric_type: "number" }],
    ["between 10 and 20", { operator: "between", value: 10, value_upper: 20, metric_type: "number" }],
    ["sideways", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    it(`parses "${input}"`, () => {
      expect(parseRule(input)).toEqual(expected);
    });
  }
});