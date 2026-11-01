import { describe, it, expect } from "vitest";
import { renderFigure, fmtNum, figureCsv } from "../src/harness/report/figure-kit.js";
import { renderFigures } from "../src/harness/report/builder.js";
import { SectionSchema, type ReportDocument } from "../src/harness/report/document.js";

const pts = (...vs: number[]) => vs.map((v, i) => ({ t: 1760000000 + i * 86400, v }));

describe("fmtNum", () => {
  it("real minus + US grouping, lakh grouping for ₹, ≤2 decimals", () => {
    expect(fmtNum(-17)).toBe("\u221217");
    expect(fmtNum(292344)).toBe("292,344");
    expect(fmtNum(348.91)).toBe("348.91");
    expect(fmtNum(0.041)).toBe("0.04");
    expect(fmtNum(244165, "₹")).toBe("2,44,165");
  });
});

describe("renderFigure", () => {
  it("line → self-contained svg: story ink via var() fallbacks, halo labels, no NaN", () => {
    const svg = renderFigure(
      { kind: "line", series: [{ label: "close", points: pts(340, 345, 349) }] },
      { label: "Price broke the median" },
    )!;
    expect(svg).toContain("<svg");
    expect(svg).toContain('aria-label="Price broke the median"');
    expect(svg).toContain("var(--c,#3A5BD0)"); // protagonist = domain ink
    expect(svg).toContain("paint-order:stroke"); // end-label halo
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("url(#"); // single-line house rule: no area wash
  });

  it("multi-series → rival ink + context grey (one story ink, no rainbow)", () => {
    const svg = renderFigure({
      kind: "line",
      series: [
        { label: "price", points: pts(10, 11, 12) },
        { label: "sma200", points: pts(9, 10, 11) },
        { label: "rsi", points: pts(50, 55, 52) },
      ],
    })!;
    expect(svg).toContain("var(--c,#3A5BD0)");
    expect(svg).toContain("var(--ink,#16181B)"); // named rival
    expect(svg).toContain("var(--slate,#b7b7bf)"); // context grey
    expect(svg).not.toContain("#3182ce"); // no library palette
  });

  it("bar+categories → horizontal bars from zero with values at bar ends", () => {
    const svg = renderFigure({ kind: "bar", categories: ["Revenue", "EPS"], values: [416.2, 2.02] })!;
    expect(svg).toContain("<rect");
    expect(svg).toContain("416.2");
    expect(svg).not.toContain("NaN");
  });

  it("pie → share strip (not a rainbow pie)", () => {
    const svg = renderFigure({ kind: "pie", categories: ["iPhone", "Services"], values: [209.6, 109.2] })!;
    expect(svg).toContain("%");
    expect(svg).toContain("var(--c,#3A5BD0)");
    // strip = two segments + legend, no per-slice colour wheel
    expect(svg.match(/opacity=/g)!.length).toBeLessThanOrEqual(6);
  });

  it("radar renders honestly as bars; candle stays client-side", () => {
    expect(renderFigure({ kind: "radar", categories: ["Trend"], values: [8] })).toContain("<rect");
    expect(renderFigure({ kind: "candle", series: [{ label: "close", points: pts(1, 2) }] })).toBeNull();
  });

  it("hbar → horizontal bars; vbar → vertical columns (the bar split)", () => {
    const h = renderFigure({ kind: "hbar", categories: ["Base", "Bull"], values: [218, 354] })!;
    const v = renderFigure({ kind: "vbar", categories: ["2023", "2024"], values: [391, 416] })!;
    expect(h).toContain("218"); // hbar prints values at bar ends
    expect(h).toContain("<rect");
    expect(v).toContain("<rect");
    expect(v).toContain("2023"); // vbar prints category labels along the bottom
    expect(h.indexOf("Base")).toBeLessThan(h.indexOf("<rect")); // names left of the zero line
    expect(v.indexOf("2023")).toBeGreaterThan(v.indexOf("<rect")); // labels under the columns
    expect(renderFigure({ kind: "vbar", series: [{ label: "vol", points: pts(3, 5, 2) }] })).toContain("<rect");
  });

  it("multiline → multi-series svg (kind separate from single line)", () => {
    const svg = renderFigure({
      kind: "multiline",
      series: [
        { label: "price", points: pts(10, 11, 12) },
        { label: "sma200", points: pts(9, 10, 11) },
      ],
    })!;
    expect(svg).toContain("var(--c,#3A5BD0)");
    expect(svg).toContain("var(--ink,#16181B)");
  });

  it("donut → ring with center total + legend (distinct from pie's share strip)", () => {
    const svg = renderFigure({ kind: "donut", categories: ["A", "B"], values: [60, 40] }, { unit: "%" })!;
    expect(svg).toContain("<path"); // ring segments
    expect(svg).toContain("Total");
    expect(svg).toContain("100"); // center total
    expect(svg).toContain("60%");
    const strip = renderFigure({ kind: "pie", categories: ["A", "B"], values: [60, 40] })!;
    expect(strip).toContain("<rect"); // strip is rects, donut is paths
  });

  it("table → header + hairline rows, numbers right-aligned, tabular", () => {
    const svg = renderFigure(
      {
        kind: "table",
        columns: ["Year", "Revenue", "FCF"],
        rows: [
          [2024, 391.0, 111.5],
          [2023, 383.3, 99.6],
        ],
      },
      { unit: "USD" },
    )!;
    expect(svg).toContain("Year");
    expect(svg).toContain("Revenue");
    expect(svg).toContain("391"); // fmtNum grouping
    expect(svg).toContain("font-variant-numeric:tabular-nums"); // set numbers
    expect((svg.match(/<line /g) ?? []).length).toBe(2); // one hairline per data row
    expect(svg).not.toContain("NaN");
    expect(renderFigure({ kind: "table" })).toBeNull(); // no columns/rows → no placeholder
    expect(SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", sourceId: "s1", spec: { kind: "table", columns: ["a"], rows: [[1]] } }] }).success).toBe(true);
  });

  it("stat → Anek label, huge Newsreader numeral, sign ink, spark", () => {
    const svg = renderFigure(
      {
        kind: "stat",
        categories: ["Nifty 50", "YTD −10.9%"],
        values: [0.51],
        series: [{ label: "spark", points: pts(1, 1.4, 1.1, 1.6) }],
      },
      { unit: "%", label: "Index snapshot" },
    )!;
    expect(svg).toContain('aria-label="Index snapshot"');
    expect(svg).toContain("Nifty 50");
    expect(svg).toContain("YTD −10.9%");
    expect(svg).toContain("+0.51%"); // signed, one scale word
    expect(svg).toContain("var(--font-display,'Newsreader'"); // Newsreader numeral, standalone-safe
    expect(svg).toContain("var(--economy-ink,#2A45A8)"); // positive ink
    expect(svg).toContain("<path"); // sparkline
    expect(svg).not.toContain("NaN");
  });

  it("movers → two-column hairline board, signed tabular values both inks", () => {
    const svg = renderFigure(
      {
        kind: "movers",
        categories: ["TONBO", "LAURUSLABS", "ATHERENERG", "TRENT", "INDIGO", "SUZLON", "PINELABS", "WELCORP", "IFCI", "APOLLO"],
        values: [7.9, 7.2, 5.6, 5.4, 4.3, -7.9, -6.7, -6.3, -6.2, -5.4],
      },
      { unit: "%" },
    )!;
    expect(svg).toContain("TONBO");
    expect(svg).toContain("+7.9%");
    expect(svg).toContain("−7.9%"); // real minus, not hyphen
    expect(svg).toContain("var(--economy-ink,#2A45A8)"); // gainers
    expect(svg).toContain("var(--people-ink,#A63C71)"); // losers
    expect((svg.match(/<line /g) ?? []).length).toBe(8); // 2 columns × 4 row rules
    expect(svg).not.toContain("NaN");
  });

  it("unresolved data token → null (never a placeholder chart)", () => {
    expect(renderFigure({ kind: "line", data: "price" })).toBeNull();
  });

  it("spec.color inks the plot (skill palette channel); bad hex rejected by schema", () => {
    const svg = renderFigure({ kind: "bar", categories: ["x"], values: [1], color: "#C66B4E" })!;
    expect(svg).toContain("#C66B4E");
    expect(svg).not.toContain("#3A5BD0");
    expect(SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", sourceId: "s1", spec: { kind: "line", color: "#C66B4E" } }] }).success).toBe(true);
    expect(SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", sourceId: "s1", spec: { kind: "line", color: "red\"/><script" } }] }).success).toBe(false);
  });

  it("section-level color (where models write it, beside measure/sourceId) survives and inks", () => {
    const p = SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", measure: "USD", color: "#82977A", sourceId: "s1", spec: { kind: "bar", categories: ["x"], values: [1] } }] });
    expect(p.success).toBe(true);
    const doc: ReportDocument = {
      schema: "relativity/report.v2", title: "T", generatedAt: "2026-10-31", symbol: "AAPL",
      sections: [p.data as any], sources: [],
    };
    renderFigures(doc);
    const svg = (doc.sections[0] as any).blocks[0].svgs[0] as string;
    expect(svg).toContain("#82977A");
    expect(svg).not.toContain("#3A5BD0");
  });
});

describe("renderFigures", () => {
  const chart = (spec: any, panels?: any[]) => ({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", title: "T", sourceId: "s1", spec, panels }] });
  const docWith = (...sections: any[]): ReportDocument => ({
    schema: "relativity/report.v2",
    title: "T",
    generatedAt: "2026-10-30",
    symbol: "AAPL",
    sections,
    sources: [],
  });

  it("attaches svgs index-aligned with [spec, ...panels]", () => {
    const doc = docWith(
      chart({ kind: "line", series: [{ label: "a", points: pts(1, 2) }] }, [{ kind: "bar", categories: ["x"], values: [1] }]),
    );
    renderFigures(doc);
    const s = doc.sections[0].blocks[0] as any;
    expect(s.svgs).toHaveLength(2);
    expect(s.svgs[0]).toContain("<svg");
    expect(s.svgs[1]).toContain("<rect");
  });

  it("atomic: a candle among panels leaves the section to the client path", () => {
    const doc = docWith(chart({ kind: "line", series: [{ label: "a", points: pts(1, 2) }] }, [{ kind: "candle", series: [] }]));
    renderFigures(doc);
    expect((doc.sections[0].blocks[0] as any).svgs).toBeUndefined();
  });

  it("schema: every figure block requires a sourceId", () => {
    expect(SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", spec: { kind: "line" } }] }).success).toBe(false);
    expect(SectionSchema.safeParse({ heading: { level: 2, text: "T" }, blocks: [{ type: "chart", sourceId: "s1", spec: { kind: "line" } }] }).success).toBe(true);
  });
});

describe("figureCsv", () => {
  it("series → date-union rows; categories → name,value; quotes escaped", () => {
    const csv = figureCsv({ kind: "line", series: [{ label: "close", points: pts(340, 345) }] });
    expect(csv.split("\n")[0]).toBe("date,close");
    expect(csv).toContain("2025-10-09"); // epoch s → ISO date
    expect(figureCsv({ kind: "bar", categories: ['a,b', "c"], values: [1, 2] })).toContain('"a,b"');
  });
});

