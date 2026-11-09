import { describe, expect, it } from "vitest";
import { ChartSpecSchema, SCHEMA_VERSION, supGlyph, type ReportDocument } from "../src/harness/report/document.js";
import { BLOCKS, SECTION_SHAPE, DATA_TOKENS, plotReferenceMarkdown, sectionContractMarkdown } from "../src/harness/report/reference.js";
import { attachChartData } from "../src/harness/report/builder.js";
import { renderFigure } from "../src/harness/report/figure-kit.js";
import { Workspace } from "../src/harness/workspace/fs.js";
import { validateComposed } from "../src/harness/canvas/canvas.js";

describe("generated prompt reference (schema → system prompt)", () => {
  it("lists every chart kind the schema accepts, all data under spec", () => {
    const md = plotReferenceMarkdown(true);
    for (const kind of ChartSpecSchema.shape.kind.options) expect(md).toContain(`\`${kind}\``);
    expect(md).toContain('"spec"');
    expect(md).toContain("Data tokens available this run");
    expect(DATA_TOKENS).toContain("price");
  });

  it("steers away from data tokens when the toolbox has no series tool", () => {
    expect(plotReferenceMarkdown(false)).toMatch(/will NOT resolve/);
    expect(plotReferenceMarkdown(false)).toContain("categories+values");
    expect(plotReferenceMarkdown(true)).not.toMatch(/will NOT resolve/);
  });

  it("ships the section envelope and a copyable JSON example for every block", () => {
    const md = sectionContractMarkdown();
    expect(md).toContain(SECTION_SHAPE);
    expect(md).toContain('"heading"');
    expect(md).toContain('"blocks"');
    expect(md).toContain("level-1 text must be IMMEDIATELY followed");
    for (const p of BLOCKS) {
      expect(md).toContain(`- ${p.id} —`);
      expect(md).toContain(p.json);
      expect(() => JSON.parse(p.json)).not.toThrow();
    }
    // badges/quote are gone from the vocabulary
    expect(md).not.toMatch(/- badges —/);
    expect(md).not.toMatch(/- quote —/);
    // diagram/code/metrics left the vocabulary
    expect(md).not.toMatch(/- diagram —/);
    expect(md).not.toMatch(/- code —/);
    expect(md).not.toMatch(/- metrics —/);
  });
});

describe("series naming (agent names, honest labels)", () => {
  const doc = (spec: object) =>
    ({
      schema: SCHEMA_VERSION,
      symbol: "AAPL",
      sections: [{ heading: { level: 2, text: "Trend" }, blocks: [{ type: "chart", title: "t", sourceId: "s1", spec }] }],
      sources: [],
    }) as unknown as ReportDocument;

  it("spec.names overrides token labels when tokens resolve", () => {
    const payload = { dates: ["2026-05-06", "2026-05-07"], close: [100, 101], indicators: { sma_50: [99, 100] } };
    const out = attachChartData(doc({ kind: "multiline", data: "price, sma50", names: ["AAPL", "50-day average"] }), [], [
      { callId: "c1", payload },
    ]);
    const spec = (out.sections[0].blocks[0] as any).spec;
    expect(spec.series.map((s: any) => s.label)).toEqual(["AAPL", "50-day average"]);
    expect(spec.data).toBeUndefined();
  });

  it("falls back to harness token labels when names are omitted", () => {
    const payload = { dates: ["2026-05-06", "2026-05-07"], close: [100, 101] };
    const out = attachChartData(doc({ kind: "line", data: "price" }), [], [{ callId: "c1", payload }]);
    const spec = (out.sections[0].blocks[0] as any).spec;
    expect(spec.series[0].label).toBe("close");
  });

  it("end labels are series names, not x-axis dates", () => {
    const t = (d: string) => Math.floor(Date.parse(d) / 1000);
    const svg = renderFigure({
      kind: "multiline",
      series: [
        { label: "AAPL", points: [{ t: t("2026-05-06"), v: 100 }, { t: t("2026-05-07"), v: 101 }] },
        { label: "50-day average", points: [{ t: t("2026-05-06"), v: 99 }, { t: t("2026-05-07"), v: 100 }] },
      ],
    });
    expect(svg).toContain("AAPL");
    expect(svg).toContain("50-day average");
    // under the old bug end labels printed x dates — series names never appeared
  });
});

describe("workspace tree snapshot", () => {
  it("lists files and labels dirs that hold no files", () => {
    const ws = new Workspace();
    ws.write("/workspace/plan.md", "- [x] scout\n");
    const tree = ws.treeMarkdown();
    expect(tree).toContain("/workspace/plan.md");
    expect(tree).toContain("/knowledge_base/ — EMPTY");
    expect(tree).toContain("/workspace/report/sections/ — EMPTY");
    expect(tree).toContain("/knowledge_base/sources/raw/ — EMPTY");
    expect(tree).not.toContain("/workspace/ — EMPTY"); // plan.md lives there
  });
});

describe("report_write rejections identify the section", () => {
  it("prefixes index and heading so the agent can map failure → section", () => {
    const out = validateComposed({
      sections: [
        { heading: { level: 2, text: "Momentum" }, blocks: [{ type: "chart", title: "x" }] },
        { title: "Risks", blocks: [] },
      ],
    });
    expect(out.sections).toHaveLength(0);
    expect(out.invalid[0]).toMatch(/^sections\[0\] \("Momentum"\):/);
    expect(out.invalid[0]).toContain("sourceId");
    expect(out.invalid[1]).toMatch(/^sections\[1\] \("Risks"\):/);
    expect(out.invalid[1]).toContain("heading");
  });
});

describe("numeric fidelity (footnote markers and cited derivations)", () => {
  const para = (text: string) => ({ heading: { level: 2, text: "T" }, blocks: [{ type: "text", level: 2, text }] }) as const;

  it("markers are non-ASCII so extractNumbers never sees them", () => {
    expect(supGlyph(3)).toBe("³");
    expect(supGlyph(11)).toBe("¹¹");
    expect(supGlyph(12)).toBe("¹²");
  });
});
