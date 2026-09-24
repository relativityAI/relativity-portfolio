import { describe, it, expect, vi, beforeEach } from "vitest";
import { isGrounded, verdictCacheKey, buildJudgePrompt, judgeCriterion } from "../src/v2/judge.js";
import type { EvidenceCard } from "../src/v2/types.js";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../src/db.js", () => ({ getDb: () => ({ from }) }));

const CARD: EvidenceCard = {
  criterion_id: "c1",
  facts: [
    { id: "F1", kind: "feature", text: "roe_annual: [10, 22, 18, 31, 26] (%)", raw: "roe_annual: [10, 22, 18, 31, 26]", as_of: "2026-03-31", source_ref: "NSE" },
    { id: "C10", kind: "chunk", text: "The company has a durable moat in packaging.", raw: "The company has a durable moat in packaging.", as_of: "2026-05-31", source_ref: "filing/1" },
  ],
  token_estimate: 30,
  hash: "abc123def4567890",
};

function mockDb() {
  const tables: Record<string, any> = {};
  from.mockImplementation((table: string) => {
    tables[table] = tables[table] || {};
    const store = tables[table];
    return {
      select: () => ({
        eq: (_k: string, _v: any) => ({
          maybeSingle: async () => ({ data: store[_v] ?? null, error: null }),
        }),
      }),
      upsert: async (row: any) => {
        if (row.key !== undefined) store[row.key] = { output: row.output };
        return { error: null };
      },
    };
  });
  return tables;
}

describe("isGrounded", () => {
  it("accepts verbatim quotes from fact raw or text", () => {
    expect(isGrounded(CARD, "roe_annual: [10, 22, 18, 31, 26]")).toBe(true);
    expect(isGrounded(CARD, "durable moat in packaging")).toBe(true);
  });

  it("rejects paraphrased or invented quotes", () => {
    expect(isGrounded(CARD, "moat is extremely durable and legendary")).toBe(false);
    expect(isGrounded(CARD, "")).toBe(false);
  });
});

describe("verdictCacheKey", () => {
  it("is deterministic and sensitive to evidence hash + model", () => {
    const a = verdictCacheKey({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, evidenceHash: CARD.hash, model: "m" });
    const b = verdictCacheKey({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, evidenceHash: CARD.hash, model: "m" });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    const otherEvidence = verdictCacheKey({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, evidenceHash: "different", model: "m" });
    expect(otherEvidence).not.toBe(a);
  });
});

describe("buildJudgePrompt", () => {
  it("lists facts and anchors", () => {
    const p = buildJudgePrompt({ criterionId: "c1", anchors: { yes: "strong", partial: "mixed", no: "weak" }, card: CARD });
    expect(p).toContain("Criterion: c1");
    expect(p).toContain("Anchor YES: strong");
    expect(p).toContain("[F1] roe_annual");
    expect(p).toContain("[C10]");
  });

  it("renders an empty evidence note when the card has no facts", () => {
    const p = buildJudgePrompt({ criterionId: "c2", anchors: { yes: "y", partial: "p", no: "n" }, card: { ...CARD, facts: [] } });
    expect(p).toContain("(no evidence was found");
  });
});

describe("judgeCriterion", () => {
  beforeEach(() => from.mockReset());

  const judgeFn = (over: Partial<{ verdict: string; confidence: string; quote: string; reasoning: string }> = {}) =>
    async () => ({ verdict: "YES", confidence: "high", quote: "durable moat in packaging", reasoning: "stated directly", ...over });

  it("calls the judge live, fills the cache, and returns a grounded verdict", async () => {
    mockDb();
    const fn = vi.fn(judgeFn());
    const res = await judgeCriterion({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, card: CARD, judgeFn: fn as any });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.verdict).toBe("YES");
    expect(res.cache_hit).toBe(false);
    expect(res.grounded).toBe(true);
  });

  it("serves a cache hit without calling the judge", async () => {
    mockDb();
    const first = await judgeCriterion({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, card: CARD, judgeFn: judgeFn() as any });
    expect(first.cache_hit).toBe(false);
    const fn = vi.fn(judgeFn());
    const second = await judgeCriterion({ criterionId: "c1", anchors: { yes: "y", partial: "p", no: "n" }, card: CARD, judgeFn: fn as any });
    expect(fn).not.toHaveBeenCalled();
    expect(second.cache_hit).toBe(true);
    expect(second.verdict).toBe("YES");
  });

  it("downgrades an ungrounded verdict to INSUFFICIENT — never ships a guessed quote", async () => {
    mockDb();
    const res = await judgeCriterion({
      criterionId: "c1",
      anchors: { yes: "y", partial: "p", no: "n" },
      card: CARD,
      judgeFn: judgeFn({ quote: "totally invented evidence" }) as any,
    });
    expect(res.grounded).toBe(false);
    expect(res.verdict).toBe("INSUFFICIENT");
  });

  it("returns INSUFFICIENT when the judge throws", async () => {
    mockDb();
    const res = await judgeCriterion({
      criterionId: "c1",
      anchors: { yes: "y", partial: "p", no: "n" },
      card: CARD,
      judgeFn: async () => { throw new Error("provider down"); },
    });
    expect(res.verdict).toBe("INSUFFICIENT");
    expect(res.reasoning).toContain("provider down");
  });
});
