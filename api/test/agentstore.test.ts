import { describe, it, expect } from "vitest";
import { buildAgentConfig, agentFromRow, ValidationError, type AgentRow } from "../src/agentstore.js";
import { parseMd } from "../src/mdconfig.js";
import { listPresetTemplates } from "../src/presets.js";

const preset = listPresetTemplates()[0].preset;

function structuredBody() {
  return {
    name: preset.name,
    philosophy: preset.persona.philosophy_and_mindset,
    configuration: preset.configuration,
    asset_evaluation: preset.asset_evaluation,
    macro_evaluation: preset.macro_evaluation,
  };
}

describe("buildAgentConfig — markdown body", () => {
  it("parses and re-serializes md", () => {
    const { config, md } = buildAgentConfig({ md: "---\nname: Hand Edited\nsource: SEC\nrisk_appetite: 7\n---\n\n## Philosophy\n\nBuy low.\n\n## Asset Evaluation\n\n### Quantitative\n\n| Metric | Rule | Weight |\n|---|---|---|\n| Return on Equity | > 15% | 8 |\n" });
    expect(config.name).toBe("Hand Edited");
    expect(config.source).toBeUndefined();
    expect(config.asset_evaluation.quantitative[0]).toMatchObject({ metric: "return_on_equity", operator: "gt", value: 15, weightage: 8 });
    expect(parseMd(md).agent?.name).toBe("Hand Edited");
  });

  it("preserves opaque sections from hand-edited md", () => {
    const md = "---\nname: X\n---\n\n## My Custom Section\n\nkeep this exactly\n\n## Philosophy\n\nhi\n";
    const { md: out } = buildAgentConfig({ md });
    expect(out).toContain("## My Custom Section");
    expect(out).toContain("keep this exactly");
  });

  it("rejects invalid markdown with structured issues", () => {
    expect(() => buildAgentConfig({ md: "no frontmatter here" })).toThrowError(ValidationError);
  });

  it("rejects structurally-invalid rules", () => {
    const md = "---\nname: X\n---\n\n## Asset Evaluation\n\n### Quantitative\n\n| Metric | Rule | Weight |\n|---|---|---|\n| ROE | sideways | 5 |\n";
    let threw: ValidationError | null = null;
    try {
      buildAgentConfig({ md });
    } catch (e: any) {
      threw = e;
    }
    expect(threw).toBeTruthy();
    expect(threw!.issues.some((i) => /unparseable rule/.test(i.message))).toBe(true);
  });

  it("rejects out-of-range weightage via zod", () => {
    const md = "---\nname: X\n---\n\n## Asset Evaluation\n\n### Qualitative\n\n#### Test — weight 0\n\nhello\n";
    let threw: ValidationError | null = null;
    try {
      buildAgentConfig({ md });
    } catch (e: any) {
      threw = e;
    }
    expect(threw).toBeTruthy();
    expect(threw!.issues.some((i) => /weightage/.test(i.message))).toBe(true);
  });
});

describe("buildAgentConfig — structured body", () => {
  it("produces md that parses back to the same config", () => {
    const { config, md } = buildAgentConfig(structuredBody());
    expect(config.name).toBe(preset.name);
    const { agent } = parseMd(md);
    expect(agent).toEqual(config);
  });

  it("does not wipe untouched fields when merging over an existing row", () => {
    const existing: AgentRow = {
      id: "a",
      user_id: "u",
      name: "Buffett",
      source: "NSE",
      persona: { philosophy_and_mindset: "keep this philosophy" },
      configuration: { investment_horizon: "Long-term (years)", risk_appetite: 4 },
      asset_evaluation: { qualitative: [{ parameter: "Moat", content: "keep this", weightage: 9 }], quantitative: [] },
      macro_evaluation: { qualitative: [], quantitative: [] },
    };
    const { config } = buildAgentConfig({ name: "Buffett v2" }, existing);
    expect(config.name).toBe("Buffett v2");
    expect(config.persona.philosophy_and_mindset).toBe("keep this philosophy");
    expect(config.asset_evaluation.qualitative).toHaveLength(1);
    expect(config.configuration.risk_appetite).toBe(4);
  });

  it("syncs body.philosophy into persona", () => {
    const { config } = buildAgentConfig({ name: "X", philosophy: "buy low" });
    expect(config.persona.philosophy_and_mindset).toBe("buy low");
  });

  it("keeps unknown JSONB history (legacy row) intact when a partial patch comes through md", () => {
    const existing: AgentRow = {
      id: "a",
      user_id: "u",
      name: "X",
      source: "NSE",
      md_config: "---\nname: X\n---\n\n## Philosophy\n\nhi\n",
    };
    const { md } = buildAgentConfig({ name: "Y" }, existing);
    expect(md).toContain("name: Y");
  });
});

describe("agentFromRow", () => {
  it("reads markdown first", () => {
    const row: AgentRow = {
      id: "a",
      user_id: "u",
      name: "Stale Column Name",
      source: "NSE",
      md_config: "---\nname: Md Name\nsource: SEC\n---\n\n## Philosophy\n\nhi\n",
      persona: { philosophy_and_mindset: "old" },
    };
    const { config } = agentFromRow(row);
    expect(config?.name).toBe("Md Name");
    expect(config?.persona.philosophy_and_mindset).toBe("hi");
  });

  it("falls back to legacy JSONB columns when md is empty", () => {
    const row: AgentRow = {
      id: "a",
      user_id: "u",
      name: "Legacy",
      source: "NSE",
      persona: { philosophy_and_mindset: "old philosophy" },
      configuration: { investment_horizon: "Swing", risk_appetite: 8 },
      asset_evaluation: { qualitative: [], quantitative: [] },
      macro_evaluation: { qualitative: [], quantitative: [] },
    };
    const { config, md } = agentFromRow(row);
    expect(config?.persona.philosophy_and_mindset).toBe("old philosophy");
    expect(config?.configuration.risk_appetite).toBe(8);
    expect(md).toContain("name: Legacy");
  });

  it("normalizes legacy quantitative rules (metric_name → metric id)", () => {
    const row: AgentRow = {
      id: "a",
      user_id: "u",
      name: "Legacy",
      source: "NSE",
      asset_evaluation: {
        qualitative: [],
        quantitative: [{ metric_name: "Return on Equity", operator: "gt", value: 15, weightage: 8 }],
      },
      macro_evaluation: { qualitative: [], quantitative: [] },
    };
    const { config } = agentFromRow(row);
    expect(config?.asset_evaluation.quantitative[0].metric).toBe("return_on_equity");
  });
});