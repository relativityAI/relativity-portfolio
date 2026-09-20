import { describe, it, expect } from "vitest";
import { agentSchema } from "../src/agentSchema.js";

const valid = {
  name: "Warren Buffett",
  description: "Great businesses at a fair price.",
  persona: { philosophy_and_mindset: "I buy moats." },
  configuration: { investment_horizon: "Long-term (years)", risk_appetite: 4 },
  asset_evaluation: {
    qualitative: [{ parameter: "Moat", content: "wide", weightage: 9 }],
    quantitative: [
      { metric: "return_on_equity", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 15, weightage: 8 },
    ],
  },
  macro_evaluation: { qualitative: [], quantitative: [] },
};

describe("agentSchema", () => {
  it("accepts a valid config", () => {
    expect(agentSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts parser output (unknown metric string in metric field)", () => {
    const out = agentSchema.safeParse({
      ...valid,
      name: "Hand Edited",
      asset_evaluation: {
        qualitative: [],
        quantitative: [
          { metric: "VIX Gap Up", metric_name: "VIX Gap Up", metric_type: "number", operator: "gt", value: 30, weightage: 4 },
        ],
      },
    });
    expect(out.success).toBe(true);
  });

  it("rejects an unknown operator", () => {
    const r = agentSchema.safeParse({ ...valid, asset_evaluation: { ...valid.asset_evaluation, quantitative: [{ ...valid.asset_evaluation.quantitative[0], operator: "sideways" }] } });
    expect(r.success).toBe(false);
  });

  it("rejects weightage out of range and non-integer", () => {
    for (const weightage of [0, 11, 4.5]) {
      const r = agentSchema.safeParse({ ...valid, asset_evaluation: { ...valid.asset_evaluation, qualitative: [{ ...valid.asset_evaluation.qualitative[0], weightage }] } });
      expect(r.success, `weightage ${weightage}`).toBe(false);
    }
  });

  it("rejects risk_appetite out of range and a missing name", () => {
    expect(agentSchema.safeParse({ ...valid, configuration: { ...valid.configuration, risk_appetite: 11 } }).success).toBe(false);
    expect(agentSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects an unknown metric_type", () => {
    const r = agentSchema.safeParse({ ...valid, asset_evaluation: { ...valid.asset_evaluation, quantitative: [{ ...valid.asset_evaluation.quantitative[0], metric_type: "ratio" }] } });
    expect(r.success).toBe(false);
  });
});