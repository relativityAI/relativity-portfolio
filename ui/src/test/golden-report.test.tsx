import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { render, screen } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { ReportDocumentRenderer } from "../components/report/ReportDocumentRenderer";
import { REPORT_SCHEMA, REPORT_SCHEMA_V1, type ReportDocument } from "../lib/reportContract";

vi.mock("../components/builder/MarketChart", () => ({
  MarketChart: (props: { variant: string; data: unknown[]; title?: string }) => (
    <div data-testid="market-chart" data-variant={props.variant} data-rows={props.data.length} />
  ),
}));

vi.mock("mermaid", () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '<svg data-mermaid="1"></svg>' }) },
}));

const doc: ReportDocument = {
  schema: REPORT_SCHEMA_V1,
  title: "Apple Inc. — Equity Research",
  subtitle: "Owner-earnings and momentum review",
  generatedAt: "2026-10-18T00:00:00.000Z",
  symbol: "AAPL",
  sections: [
    { type: "heading", level: 2, text: "Valuation" },
    {
      type: "paragraph",
      text: "Free cash flow reached 111.5B with a 4.2% yield.",
      highlights: [
        { text: "111.5B", kind: "number", sourceId: "s1" },
        { text: "4.2%", kind: "positive", sourceId: "s1" },
      ],
    },
    {
      type: "table",
      title: "Cash flow",
      columns: ["Year", "FCF"],
      rows: [["2022", 94], ["2023", 111.5]],
    },
    {
      type: "chart",
      title: "Price — 1 year",
      spec: { kind: "line", series: [{ label: "close", points: [{ t: 1710000000, v: 190 }, { t: 1710100000, v: 195 }] }] },
    },
    {
      type: "chart",
      title: "Momentum panels",
      spec: { kind: "line", series: [{ label: "close", points: [{ t: 1710000000, v: 190 }] }] },
      panels: [
        { kind: "line", series: [{ label: "rsi", points: [{ t: 1710000000, v: 55 }] }] },
        { kind: "bar", categories: ["Q1", "Q2"], values: [10, 12] },
      ],
    },
    { type: "callout", variant: "key", title: "Thesis", text: "Durable cash generation." },
    { type: "citations", refs: ["s1"] },
  ],
  sources: [{ id: "s1", label: "Cash flow statement", tool: "get_financials", value: "111.5B", url: "https://example.com" }],
};

const wrap = (n: React.ReactNode) => (
  <ChakraProvider value={createSystem(defaultConfig)}>
    <ThemeProvider attribute="class" defaultTheme="dark">{n}</ThemeProvider>
  </ChakraProvider>
);

describe("ReportDocumentRenderer (golden)", () => {
  it("renders every section type from the typed document", () => {
    render(wrap(<ReportDocumentRenderer document={doc} />));

    expect(screen.getByTestId("report-document")).toHaveAttribute("data-symbol", "AAPL");
    expect(screen.getByText("Apple Inc. — Equity Research")).toBeInTheDocument();
    expect(screen.getAllByTestId("report-heading").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("report-paragraph").length).toBe(1);
    expect(screen.getByTestId("report-table")).toBeInTheDocument();
    expect(screen.getByText("111.5")).toBeInTheDocument();
    expect(screen.getByTestId("report-callout")).toHaveAttribute("data-variant", "key");
    expect(screen.getByTestId("report-footnotes")).toBeInTheDocument();
  });

  it("renders inline highlights with their kind", () => {
    render(wrap(<ReportDocumentRenderer document={doc} />));
    const marks = screen.getAllByTestId("report-highlight");
    expect(marks.map((m) => m.getAttribute("data-kind"))).toEqual(["number", "positive"]);
    expect(screen.getByText("111.5B")).toBeInTheDocument();
  });

  it("renders a multi-panel chart as main spec plus panels", () => {
    render(wrap(<ReportDocumentRenderer document={doc} />));
    const charts = screen.getAllByTestId("report-chart");
    // main spec (1) + momentum panels (2)
    expect(charts.length).toBe(4);
    expect(charts.some((c) => c.getAttribute("data-kind") === "bar")).toBe(true);
    expect(screen.getAllByTestId("market-chart").length).toBe(3);
  });

  it("resolves citation refs to their source", () => {
    render(wrap(<ReportDocumentRenderer document={doc} />));
    const note = screen.getByTestId("report-footnote");
    expect(note).toHaveAttribute("data-source-id", "s1");
    expect(note.textContent).toContain("Cash flow statement");
    expect(note.querySelector("a")).toHaveAttribute("href", "https://example.com");
    expect(note.querySelector("sup")?.textContent).toBe("1");
  });

  it("renders injected OHLC+volume series as a candlestick", () => {
    const candleDoc: ReportDocument = {
      ...doc,
      sections: [
        {
          type: "chart",
          title: "Price — daily",
          spec: {
            kind: "candle",
            series: [
              { label: "close", points: [
                { t: 1710000000, v: 190, o: 185, h: 192, l: 184 },
                { t: 1710100000, v: 195, o: 190, h: 197, l: 189 },
              ] },
              { label: "volume", points: [{ t: 1710000000, v: 1000 }, { t: 1710100000, v: 1200 }] },
            ],
          },
        },
      ],
    };
    render(wrap(<ReportDocumentRenderer document={candleDoc} />));
    const mc = screen.getByTestId("market-chart");
    expect(mc.getAttribute("data-variant")).toBe("candle");
    expect(mc.getAttribute("data-rows")).toBe("2");
  });
});

const extendedDoc: ReportDocument = {
  ...doc,
  artifacts: [{ id: "a1", kind: "xlsx", label: "Workbook", url: "https://example.com/w.xlsx" }],
  sections: [
    { type: "badges", items: [{ label: "BUY", tone: "positive" }, { label: "Risk: high", tone: "negative" }] },
    {
      type: "metrics",
      items: [
        { label: "RSI (14)", value: "61", delta: "+4.2", tone: "positive", sourceId: "s1" },
        { label: "Trend", value: "up" },
      ],
    },
    { type: "diagram", title: "Scenario", spec: { syntax: "mermaid", code: "flowchart TD\n  A --> B" } },
    {
      type: "compare",
      title: "Scenario",
      before: { kind: "line", series: [{ label: "close", points: [{ t: 1710000000, v: 190 }] }] },
      after: { kind: "line", series: [{ label: "close", points: [{ t: 1710000000, v: 210 }] }] },
    },
    { type: "code", language: "text", text: "RSI > 70 ⇒ overbought" },
    { type: "quote", text: "Demand remains resilient.", attribution: "Q3 call", sourceId: "s1" },
    { type: "chart", title: "Momentum", spec: { kind: "area", series: [{ label: "rsi", points: [{ t: 1710000000, v: 55 }, { t: 1710100000, v: 62 }] }] } },
    { type: "chart", title: "Distribution", spec: { kind: "scatter", series: [{ label: "ret", points: [{ t: 1710000000, v: 1 }, { t: 1710100000, v: -2 }] }] } },
    { type: "chart", title: "Scorecard", spec: { kind: "radar", categories: ["Trend", "Momentum"], values: [8, 6] } },
    { type: "citations", refs: ["s1"] },
  ],
};

describe("ReportDocumentRenderer (extended primitives)", () => {
  it("renders badges, metrics, diagram, compare, code, quote, artifacts", () => {
    render(wrap(<ReportDocumentRenderer document={extendedDoc} />));
    expect(screen.getByTestId("report-badges").textContent).toContain("BUY");
    expect(screen.getByTestId("report-metrics").textContent).toContain("RSI (14)");
    expect(screen.getByTestId("report-diagram")).toBeInTheDocument();
    expect(screen.getAllByTestId("report-chart").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId("report-code").textContent).toContain("RSI > 70");
    expect(screen.getByTestId("report-quote").textContent).toContain("Demand remains resilient.");
    expect(screen.getByTestId("report-artifacts").textContent).toContain("Workbook");
  });

  it("renders area/scatter/radar through recharts (not MarketChart)", () => {
    render(wrap(<ReportDocumentRenderer document={extendedDoc} />));
    const kinds = screen.getAllByTestId("report-chart").map((c) => c.getAttribute("data-kind"));
    expect(kinds).toContain("area");
    expect(kinds).toContain("scatter");
    expect(kinds).toContain("radar");
  });
});

describe("figure frames (almanac, assembly-rendered svgs)", () => {
  const figureDoc: ReportDocument = {
    schema: REPORT_SCHEMA_V1,
    title: "AAPL — Equity Research",
    generatedAt: "2026-10-30T00:00:00.000Z",
    symbol: "AAPL",
    sections: [
      {
        type: "chart",
        title: "The multiple, not the print",
        measure: "× EV/EBITDA",
        sourceId: "s1",
        caption: "Trailing multiple against the five-year median.",
        svgs: ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 420"><path d="M0 0"/></svg>'],
        spec: { kind: "line", series: [{ label: "evEbitda", points: [{ t: 1710000000, v: 30.1 }] }] },
      },
      // candle: no stored svg → legacy interactive path, still counts for Fig. N
      { type: "chart", title: "Candle board", spec: { kind: "candle", series: [{ label: "close", points: [{ t: 1710000000, v: 190 }] }] } },
      {
        type: "chart",
        title: "Revenue mix",
        measure: "% of revenue",
        sourceId: "s1",
        svgs: ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 120"><rect width="10" height="10"/></svg>'],
        spec: { kind: "pie", categories: ["iPhone"], values: [50] },
      },
    ],
    sources: [{ id: "s1", label: "AAPL statistics", tool: "web_search", value: "30.1x", url: "https://example.com" }],
  };

  it("frames stored svgs with Fig. N, measure, source link and SVG/CSV/PNG exports", () => {
    render(wrap(<ReportDocumentRenderer document={figureDoc} />));
    const frames = screen.getAllByTestId("report-figure");
    expect(frames).toHaveLength(2); // candle stays on the legacy chart path
    // line figures draw live inside the frame (hover x+y), not the stored svg
    expect(frames[0].querySelector("[data-testid='report-chart']")).toBeTruthy();
    expect(frames[0].textContent).toContain("Fig. 1");
    expect(frames[0].textContent).toContain("The multiple, not the print");
    expect(frames[0].textContent).toContain("× EV/EBITDA");
    expect(frames[0].textContent).toContain("Trailing multiple against the five-year median.");
    const link = frames[0].querySelector("a");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(frames[0].querySelectorAll(".fig-exports button")).toHaveLength(3);
    // numbering counts every chart (candle = Fig. 2), matching the md dump
    expect(frames[1].textContent).toContain("Fig. 3");
    expect(screen.getAllByTestId("report-chart")).toHaveLength(2); // live line in frame + candle fallback
  });

  it("numbers inline markers from doc.footnotes (highlight sourceIds)", () => {
    const fnDoc: ReportDocument = { ...doc, footnotes: ["s1"] }; // highlights cite s1
    render(wrap(<ReportDocumentRenderer document={fnDoc} />));
    const mark = screen.getAllByTestId("report-highlight")[0];
    expect(mark.nextSibling?.textContent).toBe("1"); // superscript right after the span
  });

  it("restyles chrome: ledger metrics and first-column row headers", () => {
    render(wrap(<ReportDocumentRenderer document={doc} />));
    const firstCell = screen.getAllByTestId("report-table-cell")[0];
    expect(firstCell.tagName).toBe("TH");
    expect(firstCell).toHaveAttribute("scope", "row");
    render(wrap(<ReportDocumentRenderer document={extendedDoc} />));
    const ledger = screen.getByTestId("report-metrics");
    expect(ledger.className).toContain("ledger");
    expect(ledger.querySelector(".num")).toBeTruthy();
    expect(screen.getByTestId("report-badges").querySelector(".chip")).toBeTruthy();
  });
});

describe("ReportDocumentRenderer (v2 full sections)", () => {
  const v2Doc: ReportDocument = {
    schema: REPORT_SCHEMA,
    title: "Apple Inc. — Equity Research",
    generatedAt: "2026-11-01T00:00:00.000Z",
    symbol: "AAPL",
    sections: [
      {
        heading: { level: 2, text: "Trend" },
        blocks: [
          {
            type: "text",
            level: 1,
            text: "Momentum turned bullish.",
            highlights: [{ text: "61", kind: "number", sourceId: "s1" }],
          },
          { type: "text", level: 2, text: "RSI crossed 50 on rising volume." },
          {
            type: "chart",
            title: "Price — 1 year",
            measure: "USD",
            sourceId: "s1",
            svgs: ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 420"><path d="M0 0"/></svg>'],
            spec: { kind: "line", series: [{ label: "close", points: [{ t: 1710000000, v: 190 }, { t: 1710100000, v: 195 }] }] },
          },
          {
            type: "table",
            title: "Levels",
            columns: ["Band", "USD"],
            rows: [["Support", 185]],
            sourceId: "s1",
          },
        ],
      },
      {
        heading: { level: 2, text: "Risks" },
        blocks: [{ type: "callout", variant: "warn", title: "Risk", text: "Mix pressure." }],
      },
    ],
    sources: [{ id: "s1", label: "Price data", tool: "get_price", value: "195", url: "https://example.com/px" }],
    footnotes: ["s1"],
  };

  it("renders the heading, L1/L2 text, figures with Source lines and footnotes", () => {
    render(wrap(<ReportDocumentRenderer document={v2Doc} />));
    const headings = screen.getAllByTestId("report-heading");
    expect(headings.map((h) => h.textContent)).toEqual(["Trend", "Risks"]);
    // text blocks render as paragraphs
    expect(screen.getAllByTestId("report-paragraph")).toHaveLength(2);
    // figures print their source beneath (table via SourceNote, svg figure via its own link)
    const sources = screen.getAllByTestId("report-source");
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0].querySelector("a")).toHaveAttribute("href", "https://example.com/px");
    expect(screen.getByTestId("report-figure").querySelector("a")).toHaveAttribute("href", "https://example.com/px");
    expect(screen.getByTestId("report-table")).toBeInTheDocument();
    expect(screen.getByTestId("report-footnotes")).toBeInTheDocument();
    // Fig. N still sequences over nested charts
    expect(screen.getByTestId("report-figure").textContent).toContain("Fig. 1");
  });
});
