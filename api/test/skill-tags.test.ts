import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "../src/skills/parse.js";

/** VALID with an optional `  tags:` line spliced into metadata. */
function doc(tagsLine = ""): string {
  return `---
name: tagged-skill
description: A skill with tags.
metadata:
  title: Tagged Skill
  category: valuation
${tagsLine}---

## Purpose

Checks tags.
`;
}

describe("skill tags (metadata.tags)", () => {
  it("parses a comma-separated tags string", () => {
    const { skill, issues } = parseSkillMarkdown(doc("  tags: dcf, moat\n"), "custom");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(skill?.tags).toEqual(["dcf", "moat"]);
  });

  it("trims entries and drops empties", () => {
    const { skill } = parseSkillMarkdown(doc('  tags: " a,  ,b "\n'), "custom");
    expect(skill?.tags).toEqual(["a", "b"]);
  });

  it("omits tags entirely when the key is absent", () => {
    const { skill } = parseSkillMarkdown(doc(), "custom");
    expect(skill?.tags).toBeUndefined();
  });
});
