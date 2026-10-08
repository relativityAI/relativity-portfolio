import { describe, expect, it } from "vitest";
import { fixSkillMarkdown, parseSkillMarkdown } from "../src/skills/parse.js";
import { fixAgentMarkdown, parseAgentMd, validateAgentV3 } from "../src/agentmd.js";

function skillIssues(md: string) {
  const { skill, issues } = parseSkillMarkdown(md, "custom");
  return { skill, issues: issues.filter((i) => i.severity === "error") };
}

describe("fixSkillMarkdown", () => {
  it("leaves a valid document untouched", () => {
    const md = "---\nname: momentum\ncompatibility: stocks\ndescription: Momentum check.\n---\n\n## What it does\n\nRanks moves.\n";
    expect(fixSkillMarkdown(md)).toBeNull();
  });

  it("injects a slug name when the frontmatter name is invalid", () => {
    const md = "---\nname: Momentum Snapshot\ncompatibility: stocks\ndescription: A check.\n---\n\n## What it does\nRanks moves.\n";
    const fixed = fixSkillMarkdown(md);
    expect(fixed).not.toBeNull();
    const { skill, issues } = skillIssues(fixed!);
    expect(issues).toHaveLength(0);
    expect(skill?.id).toBe("momentum-snapshot");
  });

  it("adds frontmatter when the document has none", () => {
    const md = "## What it does\n\nBrief body.\n";
    const fixed = fixSkillMarkdown(md, "fallback-id");
    expect(fixed).not.toBeNull();
    expect(fixed).toMatch(/^---\nname: fallback-id\n/);
    const { skill, issues } = skillIssues(fixed!);
    expect(issues).toHaveLength(0);
    expect(skill?.id).toBe("fallback-id");
  });

  it("derives a description from the body when one is missing", () => {
    const md = "---\nname: steady\ncompatibility: stocks\n---\n\n## Purpose\n\nMarks steady earners.\n";
    const fixed = fixSkillMarkdown(md);
    expect(fixed).not.toBeNull();
    const { skill, issues } = skillIssues(fixed!);
    expect(issues).toHaveLength(0);
    expect(skill?.description).toContain("Marks steady earners");
  });

  it("recovers an unterminated frontmatter block", () => {
    const md = "---\nname: Broken\ncompatibility: stocks\ndescription: Fix me.\n## What it does\n\nRanks moves.\n";
    const fixed = fixSkillMarkdown(md);
    expect(fixed).not.toBeNull();
    const { issues } = skillIssues(fixed!);
    expect(issues).toHaveLength(0);
  });
});

describe("fixAgentMarkdown", () => {
  it("leaves a valid agent document untouched", () => {
    const md = "---\nname: Buffet\ndescription: Value hunter\n---\n\n## Philosophy\n\nBuy good companies.\n\n## Skills\n\n- moat — weight 7\n";
    expect(fixAgentMarkdown(md)).toBeNull();
    expect(validateAgentV3(parseAgentMd(md).agent!).ok).toBe(true);
  });

  it("adds a missing name to the frontmatter", () => {
    const md = "---\ndescription: Value hunter\n---\n\n## Philosophy\n\nBuy good companies.\n";
    const fixed = fixAgentMarkdown(md);
    expect(fixed).not.toBeNull();
    expect(fixed).toMatch(/^---\nname: Untitled agent\n/);
    expect(validateAgentV3(parseAgentMd(fixed!).agent!).ok).toBe(true);
  });

  it("wraps a body with no frontmatter in one", () => {
    const md = "## Philosophy\n\nBuy good companies.\n";
    const fixed = fixAgentMarkdown(md);
    expect(fixed).not.toBeNull();
    expect(fixed).toMatch(/^---\nname: Untitled agent\n---\n\n## Philosophy/);
    expect(parseAgentMd(fixed!).agent).not.toBeNull();
  });

  it("recloses an unterminated frontmatter block", () => {
    const md = "---\nname: Value Hunter\ndescription: Deep value\n## Philosophy\n\nBuy good companies.\n";
    const fixed = fixAgentMarkdown(md);
    expect(fixed).not.toBeNull();
    const parsed = parseAgentMd(fixed!);
    expect(parsed.agent?.name).toBe("Value Hunter");
    expect(parsed.agent.persona.philosophy).toContain("Buy good companies");
  });
});