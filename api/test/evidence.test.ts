import { describe, it, expect } from "vitest";
import { assembleEvidence, estimateTokens } from "../src/evidence.js";
import { rankChunks } from "../src/kb/retrieval.js";
import { FEATURE_CATALOG } from "../src/units.js";
import type { ChunkRow, EventRow, FeatureRow } from "../src/v2/types.js";

const CATALOG = Object.fromEntries(
  Object.entries(FEATURE_CATALOG).map(([k, v]) => [k, { unit: v.unit, desc: v.desc }]),
);

const FEATURES: FeatureRow[] = [
  {
    symbol: "TEST",
    source: "NSE",
    data_version: "v1",
    as_of: "2026-03-31",
    features: { roe_annual: [10, 12, 15, 18, 20], debt_to_equity_trend_5y: 1.2 },
  },
];

const EVENTS: EventRow[] = [
  {
    id: 2,
    symbol: "TEST",
    source: "NSE",
    doc_hash: "d2",
    type: "earnings",
    materiality: 4,
    sentiment: "pos",
    summary: "Q4 beat",
    raw_excerpt: "Revenue up 20% yoy.",
    as_of: "2026-06-30",
    source_ref: "news/1",
  },
  {
    id: 1,
    symbol: "TEST",
    source: "NSE",
    doc_hash: "d1",
    type: "mgmt_change",
    materiality: 2,
    sentiment: "neu",
    summary: "New CFO",
    raw_excerpt: "Company appointed a new CFO.",
    as_of: "2026-02-28",
    source_ref: "news/2",
  },
];

const CHUNKS: ChunkRow[] = [
  {
    id: 10,
    symbol: "TEST",
    source: "NSE",
    doc_hash: "c1",
    kind: "filing",
    text: "Management discussion says the company has a durable moat in packaging.",
    as_of: "2026-05-31",
    source_ref: "filing/1",
  },
  {
    id: 20,
    symbol: "TEST",
    source: "NSE",
    doc_hash: "c2",
    kind: "news",
    text: "A scrap of unrelated packaging trivia from an analyst note.",
    as_of: "2026-05-31",
    source_ref: "news/3",
  },
];

describe("assembleEvidence", () => {
  it("is deterministic — two assemblies are byte-identical", () => {
    const req = {
      criterionId: "c1",
      features: ["roe_annual"],
      eventTypes: ["earnings", "mgmt_change"],
      queries: ["moat packaging"],
      maxChunks: 6,
    };
    const a = assembleEvidence(req, { featureRows: FEATURES, eventRows: EVENTS, chunkRows: CHUNKS, featureCatalog: CATALOG });
    const b = assembleEvidence(req, { featureRows: FEATURES, eventRows: EVENTS, chunkRows: CHUNKS, featureCatalog: CATALOG });
    expect(JSON.stringify(a.facts)).toBe(JSON.stringify(b.facts));
    expect(a.hash).toBe(b.hash);
  });

  it("orders events newest-first and assigns FE/C ids", () => {
    const card = assembleEvidence(
      { criterionId: "c1", features: ["roe_annual"], eventTypes: ["earnings", "mgmt_change"], queries: [], maxChunks: 6 },
      { featureRows: FEATURES, eventRows: EVENTS, chunkRows: [], featureCatalog: CATALOG },
    );
    const events = card.facts.filter((f) => f.kind === "event");
    expect(events.map((e) => e.as_of)).toEqual(["2026-06-30", "2026-02-28"]);
    expect(card.facts[0].kind).toBe("feature");
    expect(card.facts[0].id).toMatch(/^F/);
  });

  it("caps events at 5", () => {
    const many: EventRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      symbol: "TEST",
      source: "NSE",
      doc_hash: "d" + i,
      type: "news",
      materiality: 1,
      sentiment: "neu",
      summary: `News ${i}`,
      raw_excerpt: "x",
      as_of: `2026-0${(i % 6) + 1}-15`,
      source_ref: "a",
    }));
    const card = assembleEvidence(
      { criterionId: "c1", features: [], eventTypes: ["news"], queries: [], maxChunks: 6 },
      { featureRows: [], eventRows: many, chunkRows: [], featureCatalog: CATALOG },
    );
    expect(card.facts.filter((f) => f.kind === "event")).toHaveLength(5);
  });

  it("returns no_evidence when nothing matches", () => {
    const card = assembleEvidence(
      { criterionId: "c1", features: ["missing_feature"], eventTypes: ["nope"], queries: [], maxChunks: 6 },
      { featureRows: [], eventRows: [], chunkRows: [], featureCatalog: CATALOG },
    );
    expect(card.facts).toHaveLength(0);
    expect(card.reason).toBe("no_evidence");
  });

  it("enforces the hard token cap on chunks", () => {
    const bigChunks: ChunkRow[] = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      symbol: "TEST",
      source: "NSE",
      doc_hash: "x" + i,
      kind: "filing",
      text: "word ".repeat(2000),
      as_of: "2026-05-31",
      source_ref: "x",
    }));
    const card = assembleEvidence(
      { criterionId: "c1", features: [], eventTypes: [], queries: ["word"], maxChunks: 6 },
      { featureRows: [], eventRows: [], chunkRows: bigChunks, featureCatalog: CATALOG },
    );
    const total = card.facts.reduce((s, f) => s + estimateTokens(f.text), 0);
    // 2000 ten-char words ≈ 20k chars ≈ 5000 tokens; only the first big chunk
    // should fit, so card stays under the 2500 hard cap.
    expect(card.token_estimate).toBeLessThanOrEqual(2500);
    expect(total).toBeLessThanOrEqual(2500);
  });
});

describe("rankChunks", () => {
  it("ranks by term hits, then recency, then id", () => {
    const rows = [
      { ...CHUNKS[0], text: "moat moat moat packaging", id: 5 },
      { ...CHUNKS[0], text: "moat packaging", id: 3 },
    ];
    const out = rankChunks(rows, ["moat"], 6, 60);
    expect(out.map((r) => r.id)).toEqual([5, 3]);
  });

  it("breaks ties by id descending order is deterministic", () => {
    const rows = [CHUNKS[0], CHUNKS[0]];
    const a = rankChunks(rows, ["moat"], 6, 60);
    const b = rankChunks(rows, ["moat"], 6, 60);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});