import { describe, it, expect } from "vitest";
import { chunkText, docHash, estimateTokens } from "../src/kb/chunks.js";

const SAMPLE = `
The management discussion and analysis focuses on the company's long-term
strategy. We have built a durable moat in the packaging business through
superior logistics and customer relationships. Revenue grew twenty percent in
the last fiscal year driven by volume and a favorable product mix. Operating
margins improved by one hundred and fifty basis points as raw material costs
eased. The board has approved a dividend of five rupees per share for the
third consecutive year. Forward-looking statements involve risks including
input cost inflation, regulatory changes, and competitive intensity. The
company is investing in automation to reduce manual dependency across plants.
`.repeat(12);

describe("chunkText", () => {
  it("produces ≥1 chunk within min/max token bounds", () => {
    const chunks = chunkText({
      symbol: "TEST",
      source: "NSE",
      doc_hash: "h1",
      kind: "filing",
      text: SAMPLE,
      as_of: "2026-03-31",
      source_ref: "filing/1",
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const t = estimateTokens(c.text);
      expect(t).toBeLessThanOrEqual(620);
    }
  });

  it("is deterministic given identical input", () => {
    const input = {
      symbol: "TEST",
      source: "NSE",
      doc_hash: "h2",
      kind: "news",
      text: "Earnings call transcript with a long management discussion about growth.",
      as_of: null,
      source_ref: null,
    };
    expect(chunkText(input)).toEqual(chunkText(input));
  });

  it("returns [] for empty text", () => {
    expect(chunkText({ symbol: "X", source: "NSE", doc_hash: "h", kind: "news", text: "  ", as_of: null, source_ref: null })).toHaveLength(0);
  });

  it("carries the doc_hash into every chunk", () => {
    const chunks = chunkText({
      symbol: "TEST",
      source: "NSE",
      doc_hash: "abc",
      kind: "filing",
      text: SAMPLE,
      as_of: null,
      source_ref: "f/1",
    });
    for (const c of chunks) expect(c.doc_hash).toBe("abc");
  });
});

describe("docHash", () => {
  it("is deterministic and sensitive to text", () => {
    expect(docHash("a", "news", "r")).toBe(docHash("a", "news", "r"));
    expect(docHash("a", "news", "r")).not.toBe(docHash("b", "news", "r"));
  });
});