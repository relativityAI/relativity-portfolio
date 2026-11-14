import { describe, it, expect } from "vitest";
import { getSkillTags, setSkillTags } from "../lib/skillTags";

const MD = `---
name: my-skill
description: A skill.
metadata:
  title: My Skill
  category: valuation
---

## Purpose

Body text.
`;

describe("skill frontmatter tags", () => {
    it("returns no tags when the line is absent", () => {
        expect(getSkillTags(MD)).toEqual([]);
    });

    it("adds a tags line under metadata and reads it back", () => {
        const md = setSkillTags(MD, "dcf, moat");
        expect(md).toContain('tags: "dcf, moat"');
        expect(md).toContain("  title: My Skill");
        expect(getSkillTags(md)).toEqual(["dcf", "moat"]);
        expect(md).toContain("---\n\n## Purpose");
        expect(md.endsWith("Body text.\n")).toBe(true);
    });

    it("replaces an existing line instead of duplicating it", () => {
        const md = setSkillTags(setSkillTags(MD, "a, b"), "c");
        expect(md.match(/tags:/g)).toHaveLength(1);
        expect(getSkillTags(md)).toEqual(["c"]);
        expect(md).toContain("---\n\n## Purpose");
    });

    it("clears tags without dropping the rest of the frontmatter", () => {
        const md = setSkillTags(setSkillTags(MD, "a"), "");
        expect(getSkillTags(md)).toEqual([]);
        expect(md).toContain("  title: My Skill");
        expect(md).toContain("Body text.");
        expect(md).toContain("---\n\n## Purpose");
    });

    it("writes into metadata even when the document has no frontmatter yet", () => {
        const md = setSkillTags("Just prose.", "x");
        expect(getSkillTags(md)).toEqual(["x"]);
        expect(md).toContain("Just prose.");
    });
});
