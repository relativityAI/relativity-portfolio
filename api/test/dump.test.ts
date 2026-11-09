import { describe, it, expect } from "vitest";
import { dumpMarkdown } from "../src/harness/cli/dump.js";
import type { ReportDocument } from "../src/harness/report/document.js";

const doc: ReportDocument = {
  schema: "relativity/report.v2",
  title: "Apple Inc. — Equity Research",
  generatedAt: "2026-10-30T00:00:00.000Z",
  symbol: "AAPL",
  sections: [
    {
      heading: { level: 2, text: "What's new" },
      blocks: [
        {
          type: "text",
          level: 1,
          text: "The multiple, not the print, drives the re-rating.",
          highlights: [{ text: "30.1×", kind: "number", sourceId: "src_004" }],
        },
        { type: "text", level: 2, text: "Trailing EV/EBITDA sits above the five-year median." },
        {
          type: "chart",
          title: "The multiple, not the print",
          measure: "× EV/EBITDA",
          sourceId: "src_004",
          caption: "Trailing multiple against the five-year median.",
          svgs: ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 420"><path d="M0 0"/></svg>'],
          spec: {
            kind: "line",
            series: [{ label: "evEbitda", points: [{ t: 1760000000, v: 30.1 }, { t: 1760086400, v: 29.4 }] }],
          },
        },
        {
          type: "chart",
          title: "Candle board",
          sourceId: "src_004",
          spec: { kind: "candle", data: "price" }, // legacy/candle path: no stored svg
        },
        { type: "citations", refs: ["src_004"] },
      ],
    },
  ],
  footnotes: ["src_004"],
  sources: [{ id: "src_004", label: "AAPL statistics", tool: "web_search", url: "https://example.com/stats", value: "30.1x" }],
};

describe("dumpMarkdown figures", () => {
  const out = dumpMarkdown(doc);

  it("renders the heading, then the stored svg with Fig. N, measure, how-to-read and a linked source", () => {
    expect(out).toContain("### What's new");
    expect(out).toContain("**Fig. 1 — The multiple, not the print**");
    expect(out).toContain("*(× EV/EBITDA)*");
    expect(out).toContain("<svg");
    expect(out).toContain("How to read: Trailing multiple against the five-year median.");
    expect(out).toContain("Source: [AAPL statistics](https://example.com/stats)");
    expect(out).toContain("```csv");
    expect(out).toContain("date,evEbitda");
  });

  it("sequences figures and keeps a data-first fallback for svg-less charts", () => {
    expect(out).toContain("**Fig. 2 — Candle board**");
    expect(out).toContain("[chart] Candle board — candle data=price");
    // footnotes, not a separate sources table
    expect(out).toContain("**Footnotes**");
    expect(out).toContain("\u00b9 [AAPL statistics](https://example.com/stats) \u2014 30.1x");
    expect(out).not.toContain("## Sources");
  });

  it("renders a candle chart statically at dump time when the spec carries OHLC", () => {
    const candleDoc: ReportDocument = {
      schema: "relativity/report.v2",
      symbol: "AAPL",
      sections: [
        {
          heading: { level: 2, text: "Price" },
          blocks: [
            {
              type: "chart",
              title: "Candles",
              sourceId: "src_004",
              spec: {
                kind: "candle",
                series: [
                  {
                    label: "close",
                    points: [
                      { t: 1760000000, v: 10, o: 9, h: 12, l: 8 },
                      { t: 1760086400, v: 11, o: 10, h: 13, l: 9 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      sources: [{ id: "src_004", label: "L", tool: "t", value: "v" }],
    };
    const out2 = dumpMarkdown(candleDoc);
    expect(out2).toContain("<svg");
    expect(out2).not.toContain("[chart]");
  });
});

describe("dumpMarkdown without title/generatedAt (nothing injected)", () => {
  it("omits the # header and the symbol · date line entirely", () => {
    const bare: ReportDocument = {
      schema: "relativity/report.v2",
      symbol: "AAPL",
      sections: [{ heading: { level: 2, text: "Trend" }, blocks: [{ type: "text", level: 2, text: "Up." }] }],
      sources: [],
    };
    const out = dumpMarkdown(bare);
    expect(out.startsWith("### Trend")).toBe(true); // no # title header before it
    expect(out).not.toContain("AAPL ·");
    expect(out).toContain("Up.");
  });
});
