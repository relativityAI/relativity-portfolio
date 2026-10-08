import { describe, it, expect } from "vitest";
import { skillsFromTree, listSkillRepos, getSkillRepo } from "../src/skills/repos.js";

describe("skillsFromTree", () => {
  const tree = [
    { path: "plugins/a/skills/dcf/SKILL.md", type: "blob", sha: "1" },
    { path: "plugins/a/skills/dcf/ref.py", type: "blob", sha: "2" },
    { path: "docs/SKILL.md", type: "blob", sha: "3" },
    { path: "plugins/b/skills", type: "tree", sha: "4" },
    { path: "README.md", type: "blob", sha: "5" },
    { path: "plugins/c/SKILL.MD", type: "blob", sha: "6" },
  ];

  it("keeps SKILL.md blobs under the path prefix", () => {
    expect(skillsFromTree(tree, "plugins/")).toEqual([
      { path: "plugins/a/skills/dcf/SKILL.md", sha: "1" },
      { path: "plugins/c/SKILL.MD", sha: "6" },
    ]);
  });

  it("scans the whole tree when no prefix is set", () => {
    expect(skillsFromTree(tree).map((s) => s.path)).toEqual([
      "plugins/a/skills/dcf/SKILL.md",
      "docs/SKILL.md",
      "plugins/c/SKILL.MD",
    ]);
  });

  it("ignores non-blob nodes", () => {
    expect(skillsFromTree([{ path: "plugins/b/skills/SKILL.md", type: "tree" }])).toEqual([]);
  });
});

describe("skill repo config", () => {
  it("only exposes well-formed entries", () => {
    for (const repo of listSkillRepos()) {
      expect(repo.id).toBeTruthy();
      expect(repo.owner).toBeTruthy();
      expect(repo.repo).toBeTruthy();
    }
  });

  it("looks repos up by id", () => {
    const first = listSkillRepos()[0];
    if (first) expect(getSkillRepo(first.id)?.repo).toBe(first.repo);
    expect(getSkillRepo("no-such-repo")).toBeNull();
  });
});
