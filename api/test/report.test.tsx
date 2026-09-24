import { describe, it, expect } from "vitest";
import { sanitizeReport, buildFallbackReport, parseMarkdownTables, AnalysisReport } from "../src/agent.js";
import { buildReportPdf } from "../src/pdf.js";

const KNOWN = new Set<number>([70, 35, 15, 62, 48, 91, 55, 40]);

describe("sanitizeReport", () => {
  it("keeps grounded charts and drops ungrounded numbers and degenerate charts", () => {
    const report: AnalysisReport = {
      heroPct: 62,
      heroLabel: "Alignment",
      partial: false,
      source: "llm",
      blocks: [
        { type: "heading", level: 2, text: "Summary" },
        {
          type: "chart",
          chartType: "bar",
          title: "Grounded chart",
          data: [
            { name: "A", score: 70 },
            { name: "B", score: 35 },
            { name: "C", score: 15 },
          ],
          sourceKeys: ["voyager"],
        },
        {
          type: "chart",
          chartType: "bar",
          title: "Made-up numbers",
          data: [
            { name: "A", score: 999 },
            { name: "B", score: 888 },
          ],
          sourceKeys: ["voyager"],
        },
        {
          type: "chart",
          chartType: "bar",
          title: "Single scalar",
          data: [{ name: "A", score: 70 }],
          sourceKeys: ["voyager"],
        },
        {
          type: "table",
          title: "Grounded table",
          columns: ["X", "Y"],
          rows: [[70, 35]],
          sourceKeys: ["voyager"],
        },
        {
          type: "table",
          title: "Ungrounded table",
          columns: ["X", "Y"],
          rows: [[999, 35]],
          sourceKeys: ["voyager"],
        },
      ],
    };

    const { report: out, dropped } = sanitizeReport(report, KNOWN);
    const titles = out.blocks.map((b: any) => b.title || b.text);
    expect(titles).toContain("Grounded chart");
    expect(titles).toContain("Grounded table");
    expect(titles).not.toContain("Made-up numbers");
    expect(titles).not.toContain("Single scalar");
    expect(titles).not.toContain("Ungrounded table");
    expect(dropped).toHaveLength(3);
    expect(out.source).toBe("llm");
  });

  it("converts a flat (identical-values) chart into a table instead of dropping it", () => {
    const report: AnalysisReport = {
      heroPct: 62,
      heroLabel: "Alignment",
      partial: false,
      source: "llm",
      blocks: [
        {
          type: "chart",
          chartType: "bar",
          title: "Flat bars",
          data: [
            { name: "A", score: 70 },
            { name: "B", score: 70 },
            { name: "C", score: 70 },
          ],
          sourceKeys: ["PE"],
        },
        {
          type: "chart",
          chartType: "line",
          title: "Trend",
          data: [
            { name: "Q1", score: 70 },
            { name: "Q2", score: 35 },
          ],
          sourceKeys: ["PE"],
        },
      ],
    };

    const { report: out, dropped } = sanitizeReport(report, KNOWN);
    const flatTable = out.blocks.find((b: any) => b.type === "table" && b.title === "Flat bars (data)");
    expect(flatTable).toBeDefined();
    expect((flatTable as any).rows).toEqual([
      ["A", 70],
      ["B", 70],
      ["C", 70],
    ]);
    expect(out.blocks.some((b: any) => b.type === "chart" && b.title === "Trend")).toBe(true);
    expect(dropped.some((d) => d.includes("flat chart converted to table"))).toBe(true);
  });

  it("drops radar with fewer than 3 axes", () => {
    const report: AnalysisReport = {
      heroPct: 62,
      heroLabel: "Alignment",
      partial: false,
      source: "llm",
      blocks: [
        {
          type: "chart",
          chartType: "radar",
          data: [
            { name: "A", value: 70 },
            { name: "B", value: 35 },
          ],
          sourceKeys: ["voyager"],
        },
      ],
    };
    const { report: out, dropped } = sanitizeReport(report, KNOWN);
    expect(out.blocks).toHaveLength(0);
    expect(dropped[0]).toMatch(/radar needs ≥3 axes/);
  });

  it("keeps a grounded pie and drops negative / single-slice pies", () => {
    const report: AnalysisReport = {
      heroPct: 62,
      heroLabel: "Alignment",
      partial: false,
      source: "llm",
      blocks: [
        {
          type: "chart",
          chartType: "pie",
          title: "Holding split",
          data: [
            { name: "Promoter", pct: 40 },
            { name: "FII", pct: 15 },
            { name: "Public", pct: 55 },
          ],
          sourceKeys: ["voyager"],
        },
        {
          type: "chart",
          chartType: "pie",
          title: "Negative slice",
          data: [
            { name: "A", pct: -5 },
            { name: "B", pct: 15 },
          ],
          sourceKeys: ["voyager"],
        },
        {
          type: "chart",
          chartType: "pie",
          title: "Single slice",
          data: [{ name: "Only", pct: 100 }],
          sourceKeys: ["voyager"],
        },
      ],
    };
    const { report: out, dropped } = sanitizeReport(report, KNOWN);
    const titles = out.blocks.map((b: any) => b.title);
    expect(titles).toEqual(["Holding split"]);
    expect(dropped).toHaveLength(2);
  });
});

describe("parseMarkdownTables", () => {
  it("parses pipe tables into report table blocks, converting numeric cells", () => {
    const md = `Intro line that must be ignored.

| Criterion | Rule | Actual | Wgt | Score |
|---|---|---|---|---|
| Return on Equity | > 15 | 12 | 0.5 | 40 |
| Debt/Equity | < 0.5 | 1.2 | 0.5 | 15 |

| Parameter | Score | Wgt | Verdicts |
|-----------|-------|-----|----------|
| Management | 70 | 1 | 2Y 1N |`;

    const tables = parseMarkdownTables(md);
    expect(tables).toHaveLength(2);
    expect(tables[0].columns).toEqual(["Criterion", "Rule", "Actual", "Wgt", "Score"]);
    expect(tables[0].rows).toEqual([
      ["Return on Equity", "> 15", 12, 0.5, 40],
      ["Debt/Equity", "< 0.5", 1.2, 0.5, 15],
    ]);
    expect(tables[1].columns).toEqual(["Parameter", "Score", "Wgt", "Verdicts"]);
    expect(tables[1].rows[0]).toEqual(["Management", 70, 1, "2Y 1N"]);
  });
});

describe("buildFallbackReport", () => {
  const report = buildFallbackReport({
    agentDisplayName: "GARP Fund",
    totalScore: 62.4,
    quantScore: 55,
    qualScore: 70,
    partial: false,
    quantAnalysis: {
      PE: { metric_name: "PE", operator: "<", threshold: 20, value: 14.2, weightage: 0.5, score_0_100: 70 },
      ROE: { metric_name: "ROE", operator: ">", threshold: 15, value: 12, weightage: 0.5, score_0_100: 40 },
    },
    qualAnalysis: {
      Management: {
        section: "asset",
        score_0_100: 70,
        weightage: 1,
        checklist: [{ criterion: "Track record", verdict: "YES" }],
        risks: "Key man risk",
        analysis: "Long tenure, aligned incentives.",
      },
    },
  });

  it("assembles a deterministic fallback report with an aggregate chart", () => {
    expect(report.source).toBe("fallback");
    expect(report.heroLabel).toContain("GARP Fund");
    const chart = report.blocks.find((b: any) => b.type === "chart");
    expect(chart).toBeDefined();
    expect((chart as any).data.length).toBeGreaterThanOrEqual(3);
    expect(report.blocks.some((b: any) => b.text?.includes("Quantitative gates"))).toBe(true);
    expect(report.blocks.some((b: any) => b.type === "table")).toBe(false);
  });

  it("still produces a report when every qual parameter errored (partial)", () => {
    const minimal = buildFallbackReport({
      agentDisplayName: "GARP Fund",
      totalScore: 55,
      quantScore: 55,
      qualScore: 0,
      partial: true,
      quantAnalysis: {},
      qualAnalysis: { M: { section: "asset", error: "LLM failure" } },
    });
    expect(minimal.blocks.some((b: any) => b.type === "callout" && b.text.includes("failed to score"))).toBe(true);
  });
});

describe("buildReportPdf", () => {
  it("returns a valid PDF for a run with a report (chart + table blocks)", async () => {
    const buf = await buildReportPdf({
      share_name: "Reliance",
      symbol: "RELIANCE",
      source: "NSE",
      agent_name: "GARP Fund",
      model: "gpt-test",
      created_at: "2026-01-01T00:00:00.000Z",
      total_score: 62.4,
      quantitative_score: 55,
      qualitative_score: 70,
      report: {
        heroPct: 62.4,
        heroLabel: "Alignment",
        partial: false,
        source: "llm",
        blocks: [
          { type: "heading", level: 2, text: "Executive Summary" },
          {
            type: "chart",
            chartType: "bar",
            title: "Score by dimension",
            data: [
              { name: "Quantitative", score: 55 },
              { name: "Qualitative", score: 70 },
              { name: "Overall", score: 62 },
            ],
            sourceKeys: ["voyager"],
          },
          {
            type: "table",
            title: "Criteria",
            columns: ["Metric", "Score"],
            rows: [["PE", 70]],
            sourceKeys: ["voyager"],
          },
        ],
      },
      quantitative_analysis: {
        PE: { metric_name: "PE", operator: "<", threshold: 20, value: 14.2, weightage: 0.5, price_unavailable: false, score: 0.7 },
      },
      qualitative_analysis: {
        Management: {
          section: "asset",
          score: 70,
          weightage: 1,
          checklist: [{ criterion: "Track record", verdict: "YES" }],
          risks: "Key man risk",
          analysis: "Long tenure, aligned incentives.",
        },
      },
    });
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(10000);
  });
});