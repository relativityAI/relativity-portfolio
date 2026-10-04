import { describe, it, expect } from "vitest";
import { parseSkillMarkdown, serializeSkill } from "../src/skills/parse.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const skillDir = fileURLToPath(new URL("../config/skills/", import.meta.url));

const VALID = `---
name: test-skill
description: A skill used in tests.
allowed-tools: get_financial_metrics web_search
metadata:
  title: Test Skill
  category: valuation
  version: "1"
---

## Purpose

Checks that the parser works.

## Method

1. Pull the metrics.
2. Judge the numbers.

## Verdict Anchors

- The numbers are good — weight 7
- The numbers are stable

## Charts

- type: line | title: Numbers over time | data: margin_series
- type: candlestick | title: Price | data: price_daily

## Output Template

State the numbers first.
`;

describe("parseSkillMarkdown", () => {
  it("parses a valid skill document", () => {
    const { skill, issues } = parseSkillMarkdown(VALID, "custom");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(skill).toMatchObject({
      id: "test-skill",
      name: "Test Skill",
      category: "valuation",
      version: 1,
    });
    expect(skill!.data).toEqual(["get_financial_metrics", "web_search"]);
    expect(skill!.method).toHaveLength(2);
    expect(skill!.anchors).toEqual([
      { label: "The numbers are good", weight: 7 },
      { label: "The numbers are stable", weight: 5 },
    ]);
    expect(skill!.charts).toHaveLength(2);
    expect(skill!.outputTemplate).toContain("State the numbers first.");
  });

  it("rejects missing frontmatter fields", () => {
    const { skill, issues } = parseSkillMarkdown("## Purpose\nhi");
    expect(skill).toBeNull();
    expect(issues.some((i) => /name is required/.test(i.message))).toBe(true);
  });

  it("rejects a missing Purpose section", () => {
    const md = VALID.replace("## Purpose", "## Porpoise").replace("## Method", "## Mithod");
    const { skill, issues } = parseSkillMarkdown(md);
    expect(skill).toBeNull();
    expect(issues.some((i) => /Purpose/.test(i.message))).toBe(true);
  });

  it("warns on bad chart specs but keeps parsing", () => {
    const md = VALID.replace("type: line | title: Numbers over time", "type: hologram | title: Numbers over time");
    const { skill, issues } = parseSkillMarkdown(md);
    expect(issues.some((i) => i.severity === "warn")).toBe(true);
    expect(skill).not.toBeNull();
    expect(skill!.charts).toHaveLength(1); // the bad spec is dropped, the good one kept
  });

  it("round-trips through serializeSkill", () => {
    const { skill } = parseSkillMarkdown(VALID, "custom");
    const md = serializeSkill(skill!);
    const reparsed = parseSkillMarkdown(md, "custom");
    expect(reparsed.skill).toMatchObject({
      id: "test-skill",
      name: "Test Skill",
      category: "valuation",
      data: ["get_financial_metrics", "web_search"],
      purpose: "Checks that the parser works.",
    });
    expect(reparsed.skill!.anchors).toHaveLength(2);
    expect(reparsed.skill!.charts).toHaveLength(2);
  });

  it("preserves unknown sections as opaque", () => {
    const md = VALID + "\n\n## Notes For Humans\n\nextra context\n";
    const { opaque } = parseSkillMarkdown(md);
    expect(opaque.some((o) => o.heading === "Notes For Humans" && o.text.includes("extra context"))).toBe(true);
  });
});

describe("built-in skill files", () => {
  // Scanned, not listed: a skill added to config/skills must be validated by
  // this suite without anyone remembering to edit the list.
  const ids = readdirSync(skillDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();

  it("finds the shipped skills", () => {
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids).toContain("dcf-valuation");
  });

  for (const id of ids) {
    it(`${id}/SKILL.md parses cleanly and declares a scoreable checklist`, () => {
      const md = readFileSync(join(skillDir, id, "SKILL.md"), "utf8");
      const { skill, issues } = parseSkillMarkdown(md, "builtin");
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(skill?.id).toBe(id);

    });
  }
});
