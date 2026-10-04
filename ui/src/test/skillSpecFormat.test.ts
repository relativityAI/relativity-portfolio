/**
 * The manual skill-creation form must emit the official Agent Skills format,
 * and read it back — otherwise a skill saved from the form can't be re-edited.
 * https://agentskills.io/specification
 */
import { describe, it, expect } from "vitest";
import { assembleMarkdown, parseMarkdown, type FormState } from "../components/skills/SkillCreatePane";

const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const FORM: FormState = {
    name: "M&A Arbitrage Screen",
    description: "Spreads between the offer price and the last close.",
    category: "valuation",
    tools: ["get_quote", "web_search"],
    dataNeeds: [],
    outputs: [],
    purpose: "Finds acquirers whose offer price leaves room.",
    method: ["Pull the offer terms.", "Compare against the last close."],
    anchors: [{ label: "The spread is wide", weight: 9 }],
    charts: [{ type: "bar", title: "Offer vs close", data: "spread_series" }],
};

const topKeys = (md: string) =>
    md
        .split(/\r?\n/)
        .slice(1, md.split(/\r?\n/).indexOf("---", 1))
        .filter((l) => /^[A-Za-z0-9_-]+:/.test(l))
        .map((l) => l.split(":")[0]);

describe("manual skill form emits spec format", () => {
    const md = assembleMarkdown(FORM, "m-a-arbitrage-screen");

    it("has frontmatter and the required spec fields", () => {
        expect(md.startsWith("---\n")).toBe(true);
        expect(md).toContain("name: m-a-arbitrage-screen");
        expect(md).toContain("description: Spreads between the offer price and the last close.");
    });

    it("uses only spec top-level keys", () => {
        for (const k of topKeys(md))
            expect(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]).toContain(k);
    });

    it("puts name in spec form and the title under metadata", () => {
        expect(md).not.toMatch(/^id:/m);
        expect(md).toContain("metadata:");
        expect(md).toContain("  title: M&A Arbitrage Screen");
        expect(md).toContain("  category: valuation");
    });

    it("lists tools via allowed-tools", () => {
        expect(md).toContain("allowed-tools: get_quote web_search");
        expect(md).not.toContain("## Data");
    });

    it("produces a spec-valid name", () => {
        const name = md.split(/\r?\n/).find((l) => l.startsWith("name:"))!.split(":")[1].trim();
        expect(SPEC_NAME_RE.test(name)).toBe(true);
    });

    it("keeps the description on one line and within 1024 chars", () => {
        const lines = md.split(/\r?\n/);
        const desc = lines.find((l) => l.startsWith("description:"))!;
        expect(desc).not.toMatch(/description: [^\n]*\n/);
        expect(lines.filter((l) => l.startsWith("description:")).length).toBe(1);
    });
});

describe("manual skill form reads spec format back", () => {
    it("round-trips without losing the title, tools or anchors", () => {
        const md = assembleMarkdown(FORM, "m-a-arbitrage-screen");
        const back = parseMarkdown(md);
        expect(back).not.toBeNull();
        expect(back!.name).toBe("M&A Arbitrage Screen");
        expect(back!.description).toBe(FORM.description);
        expect(back!.category).toBe("valuation");
        expect(back!.tools).toEqual(FORM.tools);
        expect(back!.purpose).toBe(FORM.purpose);
        expect(back!.anchors).toEqual(FORM.anchors);
        expect(back!.charts).toEqual(FORM.charts);
    });

    it("is idempotent — re-assembling a parsed form gives the same markdown", () => {
        const first = assembleMarkdown(FORM, "m-a-arbitrage-screen");
        const back = parseMarkdown(first)!;
        expect(assembleMarkdown(back, "m-a-arbitrage-screen")).toBe(first);
    });

    it("still reads a legacy id:/name: document", () => {
        const legacy = `---\nid: old-skill\nname: Old Skill\ndescription: d\ncategory: macro\nversion: 1\n---\n\n## Purpose\np\n\n## Data\n- web_search\n\n## Method\n1. m\n`;
        const back = parseMarkdown(legacy);
        expect(back).not.toBeNull();
        expect(back!.name).toBe("Old Skill");
        expect(back!.category).toBe("macro");
        expect(back!.tools).toEqual(["web_search"]);
    });

    it("rejects a document with no name", () => {
        expect(parseMarkdown("## Purpose\np")).toBeNull();
    });
});

describe("slug safety in the form", () => {
    it("always produces a valid name from messy input", () => {
        for (const raw of ["!!!", "  ", "Ünïcödé Näme", "A".repeat(200), "--leading and trailing--", "a  b   c"]) {
            const md = assembleMarkdown({ ...FORM, name: raw }, "!!!");
            const name = md.split(/\r?\n/).find((l) => l.startsWith("name:"))!.split(":")[1].trim();
            expect(SPEC_NAME_RE.test(name)).toBe(true);
        }
    });

    it("falls back to a valid slug when handed a bad id", () => {
        const md = assembleMarkdown(FORM, "Not A Slug!");
        expect(md).toContain("name: m-a-arbitrage-screen");
        expect(SPEC_NAME_RE.test("m-a-arbitrage-screen")).toBe(true);
    });
});