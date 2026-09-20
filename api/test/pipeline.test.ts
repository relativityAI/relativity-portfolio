import { describe, it, expect, vi } from "vitest";
import { parseFinalScoreResult, investorProfileLine, summarizeToolEvidence, runQualitative, buildModel } from "../src/agent.js";
import { runAgentTurn } from "../src/harness.js";
import { VoyagerClient } from "../src/voyager.js";
import { assessDataAdequacy, evaluateMetric, runQuantitative } from "../src/quant.js";
import { resolveWebSearch, withDeadline } from "../src/run.js";
import { buildFieldList, getFlatCatalog } from "../src/metrics.js";
import { parseJsonObject } from "../src/builder.js";
import { getToolCatalog } from "../src/tools.js";
import { buildAgentBuilderSystemPrompt, buildDraftParametersPrompt, buildDocumentExtractionPrompt } from "../src/prompts.js";
import { getSchemaDescriptor } from "../src/schema.js";

vi.mock("../src/harness.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/harness.js")>();
  return { ...actual, runAgentTurn: vi.fn() };
});

describe("parseJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonObject('{"message":"hi"}')).toEqual({ message: "hi" });
  });

  it("tolerates prose and backticks around the object", () => {
    const t = "Here is the draft:\n```json\n{\"message\":\"ok\",\"options\":[\"a\"]}\n```\nHope that helps";
    expect(parseJsonObject(t)).toEqual({ message: "ok", options: ["a"] });
  });

  it("keeps braces inside string values", () => {
    const t = '{"message":"uses {braces} in text","agent_draft_update":{"philosophy":"x"}}';
    expect(parseJsonObject(t)).toEqual({ message: "uses {braces} in text", agent_draft_update: { philosophy: "x" } });
  });

  it("returns null for unbalanced/truncated output", () => {
    expect(parseJsonObject('{"message":"cut off mid')).toBeNull();
    expect(parseJsonObject("no braces at all")).toBeNull();
  });

  it("takes the first object when multiple appear", () => {
    expect(parseJsonObject('prefix {"a":1} tail {"b":2}')).toEqual({ a: 1 });
  });
});

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
    expect(assessDataAdequacy({}, { price_data: "unavailable" })).toBe("inadequate");
  });

  it("reads real GET /pull shape (total_records + record_counts)", () => {
    const status = {
      total_records: 15,
      record_counts: { income_statements: 10, announcements: 5 },
    };
    expect(assessDataAdequacy(status, { roe: 1, pe: 2 })).toBe("sparse");
  });

  it("reads real shape as adequate above thresholds", () => {
    const record_counts: Record<string, number> = {};
    for (let i = 0; i < 6; i++) record_counts[`c${i}`] = 20;
    const metrics: Record<string, number> = {};
    for (let i = 0; i < 12; i++) metrics[`m${i}`] = i;
    expect(assessDataAdequacy({ total_records: 120, record_counts }, metrics)).toBe("adequate");
  });

  it("falls back to legacy collections shape for old stored rows", () => {
    const legacy = { collections: { financials: { records: 10 }, announcements: { records: 5 } } };
    expect(assessDataAdequacy(legacy, { roe: 1, pe: 2 })).toBe("sparse");
  });
});

describe("evaluateMetric", () => {
  const base = { metric_name: "roe", metric_type: "percentage", weightage: 5 };

  it("scores gt full when above threshold", () => {
    const e = evaluateMetric({ returnonequity: 20 }, { ...base, metric: "roe", operator: "gt", value: 15 }, "asset_evaluation");
    expect(e.score).toBe(100);
  });

  it("decays linearly toward threshold", () => {
    // threshold 15, spread max(15,1)*0.5=7.5 → value 12 sits 4.5/7.5 up the ramp
    const e = evaluateMetric({ x: 12 }, { ...base, metric: "x", operator: "gt", value: 15 }, "asset_evaluation");
    expect(e.score).toBeCloseTo(60, 0);
  });

  it("handles between with upper bound", () => {
    const e = evaluateMetric({ x: 7 }, { ...base, metric: "x", operator: "between", value: 5, value_upper: 10 }, "asset_evaluation");
    expect(e.score).toBe(100);
    const outside = evaluateMetric({ x: 20 }, { ...base, metric: "x", operator: "between", value: 5, value_upper: 10 }, "asset_evaluation");
    expect(outside.score).toBe(0);
  });

  it("evaluates dates binary", () => {
    const e = evaluateMetric({ d: "2024-06-01" }, { ...base, metric: "d", metric_type: "date", operator: "after", value: "2024-01-01" }, "asset_evaluation");
    expect(e.score).toBe(100);
  });

  it("evaluates text case-insensitively", () => {
    const e = evaluateMetric({ t: "Yes" }, { ...base, metric: "t", metric_type: "text", operator: "eq", value: "yes" }, "asset_evaluation");
    expect(e.score).toBe(100);
  });

  it("flags price-derived criteria as UNSCORED, never zero (plan A5)", () => {
    const e = evaluateMetric({}, { ...base, metric: "pe", category: "valuation", operator: "lt", value: 20 }, "asset_evaluation", "unavailable");
    expect(e.price_unavailable).toBe(true);
    expect(e.score).toBeNull();
    expect(e.unscored_reason).toBe("price_unavailable");
  });

  it("missing data is UNSCORED with weight kept (unknown ≠ 0, plan A5)", () => {
    const e = evaluateMetric({}, { ...base, metric: "nope", operator: "gt", value: 1 }, "asset_evaluation");
    expect(e.score).toBeNull();
    expect(e.unscored_reason).toBe("missing_data");
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
    // a=100 (w3), b=0 (w1) → 75
    expect(r.quantitative_score).toBe(75);
  });

  it("missing metrics reduce coverage instead of scoring zero (plan 0.3)", () => {
    const agent = {
      asset_evaluation: {
        quantitative: [
          { metric: "a", metric_type: "number", operator: "gt", value: 0, weightage: 3 },
          { metric: "missing_metric", metric_type: "number", operator: "gt", value: 0, weightage: 3 },
        ],
      },
    };
    const r = runQuantitative(agent, { a: 5 }, "live");
    expect(r.quantitative_score).toBe(100);
    expect(r.coverage).toBe(0.5);
    expect(r.fit_low).toBe(50);
    expect(r.fit_high).toBe(100);
  });
});

describe("buildFieldList", () => {
  it("excludes metadata keys and infers types from the sample snapshot", () => {
    const fields = buildFieldList({
      symbol: "TCS",
      price_data: "live",
      consolidated: true,
      filing_type: "quarterly",
      period_end_date: "2026-06-30",
      price_to_earnings_ratio: 16.7,
      return_on_equity: 46.6,
    });
    const ids = fields.map((f) => f.id);
    expect(ids).toContain("period_end_date");
    expect(ids).toContain("price_to_earnings_ratio");
    expect(ids).not.toContain("symbol");
    expect(ids).not.toContain("price_data");
    expect(ids).not.toContain("consolidated");
    expect(ids).not.toContain("filing_type");
    expect(fields.find((f) => f.id === "period_end_date")!.type).toBe("date");
    expect(fields.find((f) => f.id === "price_to_earnings_ratio")!.type).toBe("number");
  });

  it("sorts alphabetically and prettifies acronyms", () => {
    const fields = buildFieldList({ rs_14: 1, atr_14: 2 });
    expect(fields[0].name < fields[1].name || fields.length < 2).toBe(true);
    expect(buildFieldList({ rsi_14: 1 })[0].name).toBe("RSI 14");
  });

  it("handles null/empty samples", () => {
    expect(buildFieldList(null)).toEqual([]);
    expect(getFlatCatalog().length).toBeGreaterThan(0);
  });
});

describe("investorProfileLine", () => {
  it("investorProfileLine joins horizon and risk (full persona, plan B1)", () => {
    const line = investorProfileLine({ investment_horizon: "Long-term (years)", risk_appetite: "Conservative" });
    expect(line).toContain("Investment horizon: Long-term (years)");
    expect(line).toContain("Risk appetite: Conservative");
  });

  it("empty when nothing configured", () => {
    expect(investorProfileLine(undefined)).toBe("");
    expect(investorProfileLine({})).toBe("");
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

describe("getToolCatalog", () => {
  const cat = getToolCatalog();

  it("lists every tool as name + description, no duplicates", () => {
    const names = new Set(cat.map((t) => t.name));
    expect(names.size).toBe(cat.length);
    expect(cat.length).toBeGreaterThan(20);
    for (const t of cat) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("includes the core analysis and data-pull tools", () => {
    const names = new Set(cat.map((t) => t.name));
    for (const expected of [
      "get_financial_metrics",
      "get_income_statements",
      "get_cash_flows",
      "trigger_data_pull",
      "get_pull_status",
      "read_latest_transcript",
      "get_ticker_news",
      "web_search",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });
});

describe("builder prompt tool guidance", () => {
  const system = buildAgentBuilderSystemPrompt(getSchemaDescriptor(), getFlatCatalog(), getToolCatalog());
  const draft = buildDraftParametersPrompt("legacy investor", 3, "company-level qualitative parameters", getToolCatalog());
  const doc = buildDocumentExtractionPrompt("## doc\ncontent", getToolCatalog());

  it("lists available data tools and recommends independent judgment", () => {
    expect(system).toContain("Available Data Tools");
    expect(system).toContain("- get_financial_metrics:");
    expect(system.toLowerCase()).toContain("use your own decision-making");
  });

  it("directs the builder to name tools inside qualitative content", () => {
    expect(system.toLowerCase()).toContain("name the specific data tools");
    expect(draft).toContain("data tools the scorer should look at");
    expect(doc).toContain("data tools to consult for this aspect");
  });
});

describe("withDeadline", () => {
  it("resolves when the promise wins the race", async () => {
    await expect(withDeadline(Promise.resolve(42), 1000, "too slow")).resolves.toBe(42);
  });

  it("rejects with the deadline message when the promise is too slow", async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10_000));
    const assertion = expect(withDeadline(slow, 1_000, "too slow")).rejects.toThrow("too slow");
    vi.advanceTimersByTime(1_001);
    await assertion;
    vi.useRealTimers();
  });
});

describe("summarizeToolEvidence", () => {
  it("renders tool calls with results and truncates long outputs", () => {
    const long = "x".repeat(1200);
    const steps = [
      {
        toolCalls: [{ toolCallId: "c1", toolName: "get_financial_metrics", input: { symbol: "RELI" } }],
        toolResults: [{ toolCallId: "c1", output: { gross_margin: 0.4 } }],
      },
      {
        toolCalls: [{ toolCallId: "c2", toolName: "read_pdf", input: { url: "https://x/y.pdf" } }],
        toolResults: [{ toolCallId: "c2", output: long }],
      },
    ];
    const out = summarizeToolEvidence(steps);
    expect(out).toContain("get_financial_metrics");
    expect(out).toContain("gross_margin");
    expect(out).toContain("read_pdf");
    expect(out.length).toBeLessThan(1200);
    expect(out).not.toContain(long);
  });

  it("returns empty when no tool calls exist", () => {
    expect(summarizeToolEvidence([])).toBe("");
    expect(summarizeToolEvidence([{ toolCalls: [] }])).toBe("");
  });
});

describe("runQualitative recovery", () => {
  function qualContext() {
    return {
      keys: { openai: "sk-test" },
      ctx: {
        voyager: new VoyagerClient("http://localhost:8001", "test-key"),
        symbol: "TEST",
        country: "in",
        source: "nse",
        shareName: "Test Ltd",
      },
      parameter: {
        parameter: "Moat",
        content: "check the moat",
        weightage: 5,
        section: "asset_evaluation",
      },
    };
  }

  it("recovers a score via the no-tools verdict pass when the harness errors", async () => {
    vi.mocked(runAgentTurn)
      .mockResolvedValueOnce({
        text: "",
        steps: [],
        toolCalls: [],
        error: "No output generated. Check the stream for errors.",
        retryable: true,
        finishReason: "error",
      })
      .mockResolvedValueOnce({
        text: "Stable moat verdict.\nFINAL_SCORE: 72",
        steps: [],
        toolCalls: [],
        finishReason: "stop",
      });
    const { keys, ctx, parameter } = qualContext();
    const res = await runQualitative("openai/gpt-4o-mini", keys, ctx, parameter, [], false, "sparse", "Investor profile.", () => {});
    expect(res.error).toBeUndefined();
    expect(res.score).toBe(72);
    expect(res.analysis).toContain("FINAL_SCORE: 72");
  });

  it("surfaces gathered tool evidence when the turn and every recovery attempt fail", async () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "c1", toolName: "web_search", input: { query: "moat" } }],
        toolResults: [{ toolCallId: "c1", output: { count: 1, results: [{ title: "Deep moat", url: "https://x" }] } }],
      },
    ];
    const errorTurn = {
      text: "",
      steps,
      toolCalls: [{ tool_name: "web_search", args: { query: "moat" }, status: "OK" }],
      error: "No output generated. Check the stream for errors.",
      retryable: true,
      finishReason: "error",
    };
    const emptyRecovery = { text: "", steps: [], toolCalls: [], finishReason: "error" };
    vi.mocked(runAgentTurn)
      .mockResolvedValueOnce(errorTurn)
      .mockResolvedValueOnce(emptyRecovery)
      .mockResolvedValueOnce(emptyRecovery);
    const { keys, ctx, parameter } = qualContext();
    const res = await runQualitative("openai/gpt-4o-mini", keys, ctx, parameter, [], false, "sparse", "Investor profile.", () => {});
    expect(res.error).toBeTruthy();
    expect(res.score).toBeNull();
    expect(res.analysis).toContain("Research gathered by the tools");
    expect(res.analysis).toContain("web_search");
  });
});
