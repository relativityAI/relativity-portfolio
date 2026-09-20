import { describe, it, expect, vi, beforeEach } from "vitest";
import { runQuantitative, runQuantitativeLLM, applyQuantOverlay, buildQuantJudgementPrompt } from "../src/quant.js";
import { runAgentTurn } from "../src/harness.js";

vi.mock("../src/harness.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/harness.js")>();
  return { ...actual, runAgentTurn: vi.fn() };
});

const mockedTurn = runAgentTurn as ReturnType<typeof vi.fn>;

const agent = {
  asset_evaluation: {
    quantitative: [
      { metric: "roe", metric_name: "ROE", metric_type: "percentage", operator: "gte", value: 15, weightage: 5 },
      { metric: "net_margin", metric_name: "Net Margin", metric_type: "percentage", operator: "gte", value: 10, weightage: 5 },
    ],
  },
  macro_evaluation: {
    quantitative: [
      { metric: "pe_ratio", metric_name: "PE Ratio", metric_type: "multiple", operator: "gte", value: 10, weightage: 3 },
    ],
  },
};

const metrics = {
  roe: 18.2,
  net_margin: 9.4,
  price_to_earnings_ratio: 22.5, // pe_ratio criterion resolves to this catalog id
};

function quant() {
  return runQuantitative(agent, metrics, "live");
}

beforeEach(() => {
  mockedTurn.mockReset();
  vi.unstubAllEnvs();
});

describe("runQuantitativeLLM", () => {
  it("is disabled by default (deterministic scoring only — plan 0.4/A6)", async () => {
    mockedTurn.mockResolvedValue({
      text: '{"asset_evaluation:0:roe":0.9,"asset_evaluation:1:net_margin":0.3,"macro_evaluation:0:pe_ratio":1.3}',
      steps: [],
      toolCalls: [],
    });
    const overlay = await runQuantitativeLLM({ modelId: "openai/gpt-4o-mini", llmKeys: {}, entries: quant().quantitative_analysis });
    expect(overlay).toEqual({});
    expect(mockedTurn).not.toHaveBeenCalled();
  });

  it("returns a clamped score overlay when QUANT_LLM_JUDGE=1 is explicitly set", async () => {
    vi.stubEnv("QUANT_LLM_JUDGE", "1");
    // Judge resolves keys through the pool (A6): provide a user key so pickKey
    // succeeds without server keys.
    mockedTurn.mockResolvedValue({
      text: '{"asset_evaluation:0:roe":0.9,"asset_evaluation:1:net_margin":0.3,"macro_evaluation:0:pe_ratio":1.3}',
      steps: [],
      toolCalls: [],
    });
    const overlay = await runQuantitativeLLM({
      modelId: "openai/gpt-4o-mini",
      llmKeys: { openai: "sk-test" },
      entries: quant().quantitative_analysis,
    });
    expect(overlay["asset_evaluation:0:roe"]).toBe(0.9);
    expect(overlay["asset_evaluation:1:net_margin"]).toBe(0.3);
    // 1.3 clamps down to 1
    expect(overlay["macro_evaluation:0:pe_ratio"]).toBe(1);
  });

  it("filters out binary/missing criteria before contacting the model", async () => {
    vi.stubEnv("QUANT_LLM_JUDGE", "1");
    const q = quant();
    q.quantitative_analysis["asset_evaluation:0:roe"].metric_type = "date";
    q.quantitative_analysis["asset_evaluation:1:net_margin"].value = undefined as any;
    q.quantitative_analysis["macro_evaluation:0:pe_ratio"].value = undefined as any;
    const overlay = await runQuantitativeLLM({ modelId: "openai/gpt-4o-mini", llmKeys: {}, entries: q.quantitative_analysis });
    expect(overlay).toEqual({});
    expect(mockedTurn).not.toHaveBeenCalled();
  });

  it("falls back to empty on a model error (deterministic scores kept)", async () => {
    vi.stubEnv("QUANT_LLM_JUDGE", "1");
    mockedTurn.mockResolvedValue({ text: "", steps: [], toolCalls: [], error: "upstream 503" });
    const overlay = await runQuantitativeLLM({ modelId: "openai/gpt-4o-mini", llmKeys: {}, entries: quant().quantitative_analysis });
    expect(overlay).toEqual({});
  });

  it("falls back to empty when the reply is not JSON", async () => {
    vi.stubEnv("QUANT_LLM_JUDGE", "SSO");
    mockedTurn.mockResolvedValue({ text: "I cannot comply.", steps: [], toolCalls: [] });
    const overlay = await runQuantitativeLLM({ modelId: "openai/gpt-4o-mini", llmKeys: {}, entries: quant().quantitative_analysis });
    expect(overlay).toEqual({});
  });

  it("builds a prompt that names every judgable criterion by rule id", () => {
    const prompt = buildQuantJudgementPrompt(quant().quantitative_analysis);
    expect(prompt).toContain("asset_evaluation:0:roe");
    expect(prompt).toContain("macro_evaluation:0:pe_ratio");
    expect(prompt).toContain("actual=22.5");
    // Deterministic baseline shown so the judge is anchored, not guessing.
    expect(prompt).toContain("deterministic_score=");
  });
});

describe("applyQuantOverlay", () => {
  it("mutates scores, flags scored_by, and recomputes the weighted total", () => {
    const q = quant();
    const before = q.quantitative_score as number;
    applyQuantOverlay(q, {
      "asset_evaluation:0:roe": 1,
      "asset_evaluation:1:net_margin": 1,
      "macro_evaluation:0:pe_ratio": 1,
    });
    expect(q.quantitative_analysis["asset_evaluation:0:roe"].score).toBe(100);
    expect(q.quantitative_analysis["asset_evaluation:0:roe"].scored_by).toBe("llm");
    expect(q.quantitative_analysis["macro_evaluation:0:pe_ratio"].score).toBe(100);
    expect(q.quantitative_score).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op for an empty overlay", () => {
    const q = quant();
    const before = q.quantitative_analysis["asset_evaluation:0:roe"].score;
    applyQuantOverlay(q, {});
    expect(q.quantitative_analysis["asset_evaluation:0:roe"].score).toBe(before);
    expect(q.quantitative_analysis["asset_evaluation:0:roe"].scored_by).toBeUndefined();
  });
});
