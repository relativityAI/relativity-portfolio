import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMd, serializeMd, parseRule, type AgentConfig } from "../src/mdconfig.js";
import { listPresetTemplates } from "../src/presets.js";

const presetDir = fileURLToPath(new URL("../config/presets/", import.meta.url));

function readPreset(key: string): string {
  return readFileSync(`${presetDir}${key}.md`, "utf8");
}

function presetToAgent(key: string): AgentConfig {
  const p = listPresetTemplates().find((x) => x.key === key)!.preset;
  return {
    name: p.name,
    description: p.description,
    persona: p.persona,
    configuration: p.configuration,
    asset_evaluation: p.asset_evaluation as AgentConfig["asset_evaluation"],
    macro_evaluation: p.macro_evaluation as AgentConfig["macro_evaluation"],
  };
}

describe("parseMd — canonical preset files", () => {
  for (const key of ["buffett", "oneil", "growth"]) {
    it(`${key} parses to the code template`, () => {
      const { agent, issues } = parseMd(readPreset(key));
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(agent).toEqual(presetToAgent(key));
    });
  }

  it("generated md is serialization-stable (idempotent round-trip)", () => {
    for (const key of ["buffett", "oneil", "growth"]) {
      const agent = presetToAgent(key);
      const md = readPreset(key);
      expect(serializeMd(agent)).toBe(md);
      expect(serializeMd(parseMd(md).agent!)).toBe(md);
    }
  });
});

describe("serializeMd — hand-edit preservation", () => {
  it("carries opaque sections verbatim through a structured edit", () => {
    const prev = readPreset("buffett") + "\n\n## Screening Checklist\n\n- moat widening\n- mgmt buys on dips\n";
    const edited = { ...presetToAgent("buffett"), name: "Buffett v2" };
    const out = serializeMd(edited, prev);
    expect(out).toContain("## Screening Checklist");
    expect(out).toContain("- moat widening\n- mgmt buys on dips");
    const { agent } = parseMd(out);
    expect(agent!.name).toBe("Buffett v2");
    expect(agent!.asset_evaluation.qualitative).toEqual(edited.asset_evaluation.qualitative);
  });

  it("keeps unknown frontmatter keys through a round-trip", () => {
    const prev = "---\nname: Growth (GARP / Fisher)\nrisk_appetite: 7\ncustom_field: foobar\n---\n\n## Philosophy\n\nhi\n";
    const out = serializeMd(presetToAgent("growth"), prev);
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
    expect(md).not.toContain("## Philosophy");
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