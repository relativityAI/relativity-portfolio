import { describe, expect, it } from "vitest";
import { BLOCKS, SECTION_SHAPE } from "../src/harness/report/catalog.js";
import { ChartSpecSchema, SCHEMA_VERSION, supGlyph, type ReportDocument } from "../src/harness/report/document.js";
import { DATA_TOKENS, plotReferenceMarkdown, sectionContractMarkdown } from "../src/harness/report/reference.js";
import { Workspace } from "../src/harness/workspace/fs.js";
import { extractNumbers, verifyDocumentNumbers } from "../src/harness/workspace/verify.js";
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
    expect(extractNumbers(`upside ${supGlyph(11)} and ${supGlyph(12)}`)).toEqual([]);
  });

  it("whitelists numbers a cited source itself quotes; uncited stay flagged", () => {
    const doc = {
      title: "t",
      symbol: "X",
      generatedAt: "2026-10-30",
      schema: SCHEMA_VERSION,
      sections: [para("Base value $218 per share [src:src_019_6]. Upside of 777 is uncited.")],
      sources: [{ id: "src_019_6", label: "Our DCF model (October 2026)", tool: "report_write", value: "Base value $218/share" }],
    } as ReportDocument;
    expect(verifyDocumentNumbers(doc, new Set())).toEqual([777]);
  });
});
