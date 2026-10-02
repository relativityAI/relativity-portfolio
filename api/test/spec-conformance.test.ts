/**
 * Agent Skills spec conformance — https://agentskills.io/specification
 *
 * Enforces the rules that matter on both the bundled skills and anything we
 * write: directory-per-skill, SKILL.md, and frontmatter field constraints.
 * These assertions are the gate; if one fails, a skill is not spec-valid.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  parseSkillMarkdown, serializeSkill, repairSkillName,
  SPEC_NAME_RE, SPEC_NAME_ERR, slugifySkillName,
} from "../src/skills/parse.js";
import { loadBuiltinSkills } from "../src/skills/store.js";

const SKILL_ROOT = fileURLToPath(new URL("../config/skills/", import.meta.url));

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Flatten a SKILL.md frontmatter block into top-level keys + metadata pairs. */
function readFrontmatter(md: string): { top: Map<string, string>; meta: Map<string, string> } {
  const top = new Map<string, string>();
  const meta = new Map<string, string>();
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { top, meta };
  let key = "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, indent, k, v] = kv;
    const clean = v.replace(/^["']|["']$/g, "").trim();
    if (indent.length > 0 && key) {
      if (clean) meta.set(`${key}.${k.toLowerCase()}`, clean);
    } else {
      key = k.toLowerCase();
      if (clean) top.set(key, clean);
    }
  }
  return { top, meta };
}

const skillDirs = readdirSync(SKILL_ROOT).filter((d) => {
  try {
    return statSync(join(SKILL_ROOT, d)).isDirectory();
  } catch {
    return false;
  }
}).sort();

describe("Agent Skills spec conformance", () => {
  it("bundles skills as a directory per skill", () => {
    expect(skillDirs.length).toBeGreaterThan(0);
    // No stray flat .md files left over from the legacy layout.
    const flat = readdirSync(SKILL_ROOT).filter((f) => f.endsWith(".md"));
    expect(flat).toEqual([]);
  });

  for (const slug of skillDirs) {
    describe(slug, () => {
      const md = readFileSync(join(SKILL_ROOT, slug, "SKILL.md"), "utf8");
      const { top, meta } = readFrontmatter(md);

      it("has a SKILL.md with YAML frontmatter", () => {
        expect(md.startsWith("---")).toBe(true);
        expect(FRONTMATTER_RE.test(md)).toBe(true);
      });

      it("has a spec-valid name matching its directory", () => {
        expect(top.get("name")).toBe(slug);
        expect(SPEC_NAME_RE.test(top.get("name") || "")).toBe(true);
        expect(slug.length).toBeLessThanOrEqual(64);
        expect(slug).not.toMatch(/^-|-$|--/);
      });

      it("has a non-empty description of at most 1024 chars", () => {
        const d = top.get("description") || "";
        expect(d.length).toBeGreaterThan(0);
        expect(d.length).toBeLessThanOrEqual(1024);
      });

      it("keeps optional fields within spec limits", () => {
        const compat = top.get("compatibility");
        if (compat !== undefined) expect(compat.length).toBeLessThanOrEqual(500);
        expect((top.get("allowed-tools") || "").length).toBeGreaterThanOrEqual(0);
      });

      it("exposes our extras through metadata, not invented top-level keys", () => {
        const SPEC_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
        for (const k of top.keys()) expect(SPEC_KEYS.has(k)).toBe(true);
        expect(meta.get("metadata.category")).toBeTruthy();
        expect(meta.get("metadata.title")).toBeTruthy();
      });

      it("parses with no errors and round-trips", () => {
        const { skill, issues } = parseSkillMarkdown(md, "builtin");
        expect(issues.filter((i) => i.severity === "error")).toEqual([]);
        expect(skill?.id).toBe(slug);
        const { skill: reparsed, issues: reIssues } = parseSkillMarkdown(serializeSkill(skill!), "custom");
        expect(reIssues.filter((i) => i.severity === "error")).toEqual([]);
        expect(reparsed?.id).toBe(skill?.id);
        expect(reparsed?.name).toBe(skill?.name);
        expect(reparsed?.description).toBe(skill?.description);
        expect(reparsed?.category).toBe(skill?.category);
        expect(reparsed?.version).toBe(skill?.version);
        expect(reparsed?.data.sort()).toEqual(skill?.data.sort());
        expect(reparsed?.method).toEqual(skill?.method);
      });
    });
  }

  it("loads all bundled skills through the store", () => {
    const loaded = loadBuiltinSkills();
    expect(loaded.length).toBe(skillDirs.length);
    expect(loaded.map((s) => s.id).sort()).toEqual(skillDirs);
    for (const s of loaded) {
      expect(SPEC_NAME_RE.test(s.id)).toBe(true);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });

  describe("name rules", () => {
    it("accepts spec-valid names", () => {
      for (const n of ["a", "pdf-processing", "data-analysis", "code-review", "skill2"])
        expect(SPEC_NAME_RE.test(n)).toBe(true);
    });

    it("rejects the invalid examples the spec calls out", () => {
      for (const n of ["PDF-Processing", "-pdf", "pdf--processing", "pdf-", "with space", "", "a".repeat(65)])
        expect(SPEC_NAME_RE.test(n)).toBe(false);
    });

    it("rejects an invalid name at parse time", () => {
      const bad = `---\nname: Bad-Name\ndescription: x\nmetadata:\n  title: x\n  category: valuation\n---\n\n## Purpose\np\n\n## Method\n1. m\n`;
      const { skill, issues } = parseSkillMarkdown(bad);
      expect(skill).toBeNull();
      expect(issues.some((i) => i.message === SPEC_NAME_ERR)).toBe(true);
    });

    it("slugifies a human title into a valid name", () => {
      expect(slugifySkillName("DCF Valuation")).toBe("dcf-valuation");
      expect(slugifySkillName("Moat & Ownership Signals")).toBe("moat-ownership-signals");
      expect(SPEC_NAME_RE.test(slugifySkillName("  ---  "))).toBe(true);
      expect(slugifySkillName("!!!").length).toBeGreaterThan(0);
    });
  });

  describe("back-compat", () => {
    const LEGACY = `---
id: legacy-skill
name: Legacy Skill
description: An older-format skill.
category: valuation
version: 1
---

## Purpose
Still parses.

## Data
- web_search

## Method
1. Do it.
`;

    it("still reads legacy files with a warning instead of failing", () => {
      const { skill, issues } = parseSkillMarkdown(LEGACY, "custom");
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(issues.some((i) => i.severity === "warn" && /legacy frontmatter/.test(i.message))).toBe(true);
      expect(skill?.id).toBe("legacy-skill");
      expect(skill?.name).toBe("Legacy Skill");
      expect(skill?.data).toEqual(["web_search"]);
    });

    it("rewrites legacy into spec format when serialized", () => {
      const { skill } = parseSkillMarkdown(LEGACY, "custom");
      const out = serializeSkill(skill!);
      expect(out).toContain("name: legacy-skill");
      expect(out).toContain("metadata:");
      expect(out).toContain("  title: Legacy Skill");
      expect(out).toContain("allowed-tools: web_search");
      expect(out).not.toMatch(/^id:/m);
    });
  });
});
describe("repairSkillName (LLM drafts self-correct)", () => {
  it("leaves an already-valid name untouched", () => {
    const good = `---\nname: my-skill\ndescription: d\nmetadata:\n  title: My Skill\n  category: valuation\n---\n\n## Purpose\np\n\n## Method\n1. m\n`;
    expect(repairSkillName(good)).toBe(good);
  });

  it("slugifies a title-case name and preserves the title", () => {
    const bad = `---\nname: DCF Valuation\ndescription: d\ncategory: valuation\n---\n\n## Purpose\np\n\n## Method\n1. m\n`;
    const out = repairSkillName(bad);
    expect(out).toContain("name: dcf-valuation");
    expect(out).toContain("  title: DCF Valuation");
    expect(out).toContain("  category: valuation");
    const { skill, issues } = parseSkillMarkdown(out);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(skill?.id).toBe("dcf-valuation");
    expect(skill?.name).toBe("DCF Valuation");
  });

  it("does not clobber an existing metadata.title", () => {
    const bad = `---\nname: Bad Name!\ndescription: d\nmetadata:\n  title: Existing Title\n  category: macro\n---\n\n## Purpose\np\n\n## Method\n1. m\n`;
    const out = repairSkillName(bad);
    expect(out).toContain("name: bad-name");
    expect(out).toContain("  title: Existing Title");
    expect(out.match(/title:/g)?.length).toBe(1);
  });

  it("quotes a title that would otherwise misparse", () => {
    const bad = `---\nname: Needs: quoting\ndescription: d\n---\n\n## Purpose\np\n\n## Method\n1. m\n`;
    expect(repairSkillName(bad)).toContain('title: "Needs: quoting"');
  });

  it("leaves a document with no frontmatter alone", () => {
    expect(repairSkillName("no frontmatter")).toBe("no frontmatter");
  });

  it("preserves the entire body after the frontmatter", () => {
    const bad = `---\nname: DCF Valuation\ndescription: d\ncategory: valuation\n---\n\n## Purpose\n\nWhy it matters.\n\n## Method\n\n1. Step one.\n\n## Verdict Anchors\n\n- Intrinsic value beats price — weight 9\n`;
    const out = repairSkillName(bad);
    expect(out).toContain("## Purpose");
    expect(out).toContain("Why it matters.");
    expect(out).toContain("## Method");
    expect(out).toContain("1. Step one.");
    expect(out).toContain("## Verdict Anchors");
    expect(out).toContain("- Intrinsic value beats price — weight 9");
    const { skill, issues } = parseSkillMarkdown(out);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(skill?.method).toEqual(["Step one."]);
    expect(skill?.anchors?.[0]?.weight).toBe(9);
  });
});
