import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreRubric, parameterOutcomesToAnalysis } from "../src/v2/score.js";
import { scoreChecklist } from "../src/scoring.js";
import type { ChunkRow, EventRow, FeatureRow } from "../src/v2/types.js";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../src/db.js", () => ({ getDb: () => ({ from }) }));

const FEATURES: FeatureRow[] = [
  {
    symbol: "TEST", source: "NSE", data_version: "v1", as_of: "2026-03-31",
    features: { roe_annual: [10, 22, 18, 31, 26], op_margin: [11, 12, 14, 13, 16] },
  },
];

const EVENTS: EventRow[] = [
  {
    id: 1, symbol: "TEST", source: "NSE", doc_hash: "d1", type: "earnings",
    materiality: 4, sentiment: "pos", summary: "Q4 beat", raw_excerpt: "Revenue up 20% yoy.",
    as_of: "2026-06-30", source_ref: "news/1",
  },
];

const CHUNKS: ChunkRow[] = [
  {
    id: 10, symbol: "TEST", source: "NSE", doc_hash: "c1", kind: "filing",
    text: "Capital allocation shows a durable moat in packaging logistics.",
    as_of: "2026-05-31", source_ref: "filing/1",
  },
];

const RUBRIC = {
  parameters: [
    {
      parameter: "Return Durability",
      section: "asset_evaluation" as const,
      weightage: 8,
      criteria: [
        { kind: "predicate" as const, id: "p1", expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] }, requires: ["roe_annual"] },
        { kind: "judge" as const, id: "j1", anchors: { yes: "y", partial: "p", no: "n" }, evidence: { features: ["roe_annual"], retrieval: ["capital allocation"], event_types: ["earnings"] } },
      ],
    },
    {
      parameter: "Missing Data",
      section: "asset_evaluation" as const,
      weightage: 3,
      criteria: [
        { kind: "predicate" as const, id: "p2", expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] },
      ],
    },
  ],
};

function mockJudge(quote = "durable moat in packaging logistics") {
  return async (prompt: string) => ({
    verdict: /Missing|no evidence/.test(prompt) ? "INSUFFICIENT" : "YES",
    confidence: "high",
    quote,
    reasoning: "grounded in the supplied fact",
  });
}

describe("scoreRubric (§6.7)", () => {
  beforeEach(() => from.mockReset());
  beforeEach(() => {
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }));
  });

  it("combines predicate verdicts and judge verdicts per parameter", async () => {
    const outcomes = await scoreRubric(RUBRIC as any, {
      symbol: "TEST",
      source: "NSE",
      features: { roe_annual: [10, 22, 18, 31, 26] },
      featureRows: FEATURES,
      eventRows: EVENTS,
      chunkRows: CHUNKS,
      judgeFn: mockJudge() as any,
    });
    expect(outcomes).toHaveLength(2);
    const durability = outcomes[0];
    expect(durability.criteria[0].kind).toBe("predicate");
    // min_last([10,22,18,31,26]) = 10 < 15 → NO (deterministic, honest)
    expect(durability.criteria[0].verdict).toBe("NO");
    expect(durability.criteria[1].kind).toBe("judge");
    expect(durability.criteria[1].verdict).toBe("YES");
    expect(durability.criteria[1].facts?.length).toBeGreaterThan(0);
    expect(durability.criteria[1].evidence_hash).toBeTruthy();
  });

  it("INSUFFICIENT for missing features — unknown ≠ 0, never NO", async () => {
    const outcomes = await scoreRubric(RUBRIC as any, {
      symbol: "TEST",
      source: "NSE",
      features: {},
      featureRows: [],
      eventRows: [],
      chunkRows: [],
      judgeFn: mockJudge() as any,
    });
    expect(outcomes[1].criteria[0].verdict).toBe("INSUFFICIENT DATA");
    expect(outcomes[1].criteria[0].predicate?.unscored_reason).toBe("missing_data");
  });

  it("skips the LLM for empty evidence cards (no_evidence → INSUFFICIENT)", async () => {
    const judgeFn = vi.fn(mockJudge());
    const outcomes = await scoreRubric(
      { parameters: [{ ...RUBRIC.parameters[0] }] } as any,
      { symbol: "TEST", source: "NSE", features: {}, featureRows: [], eventRows: [], chunkRows: [], judgeFn: judgeFn as any },
    );
    expect(judgeFn).not.toHaveBeenCalled();
    expect(outcomes[0].criteria[1].verdict).toBe("INSUFFICIENT DATA");
  });

  it("is deterministic for the predicate path (same inputs, same verdicts)", async () => {
    const opts = {
      symbol: "TEST", source: "NSE",
      features: { roe_annual: [10, 22, 18, 31, 26] },
      featureRows: [], eventRows: [], chunkRows: [],
    };
    const a = await scoreRubric(RUBRIC as any, { ...opts, judgeFn: mockJudge() as any });
    const b = await scoreRubric(RUBRIC as any, { ...opts, judgeFn: mockJudge() as any });
    expect(a[0].criteria[0].verdict).toBe(b[0].criteria[0].verdict);
    expect(a[0].criteria[0].predicate?.inputs).toEqual(b[0].criteria[0].predicate?.inputs);
  });
});

describe("parameterOutcomesToAnalysis + scoreChecklist", () => {
  it("produces the v1 checklist shape and computes scores in code", async () => {
    const outcomes = await scoreRubric(RUBRIC as any, {
      symbol: "TEST", source: "NSE",
      features: { roe_annual: [10, 22, 18, 31, 26] },
      featureRows: FEATURES, eventRows: EVENTS, chunkRows: CHUNKS,
      judgeFn: mockJudge() as any,
    });
    const analysis = parameterOutcomesToAnalysis(outcomes);
    expect(analysis["Return Durability"].score_source).toBe("v2_rubric");
    expect(analysis["Return Durability"].checklist).toEqual([
      { criterion: "p1", verdict: "NO" },
      { criterion: "j1", verdict: "YES" },
    ]);
    const scored = scoreChecklist(analysis["Return Durability"].checklist);
    expect(scored.score).toBe(50); // NO=0, YES=1 → 1/2 assessable
    expect(scored.coverage).toBe(100);

    // Missing-data parameter: all-INSUFFICIENT → unscored, not 0.
    const missing = scoreChecklist(analysis["Missing Data"].checklist);
    expect(missing.score).toBeNull();
  });
});
