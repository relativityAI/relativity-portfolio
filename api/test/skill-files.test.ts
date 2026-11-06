import { describe, it, expect, vi } from "vitest";

/**
 * normalizeSkillFiles — the trust boundary for multi-file skill writes.
 * The tree comes straight from the request body, so a bad payload must be
 * rejected before anything touches the database.
 */

vi.mock("../src/db.js", () => ({ getDb: () => ({ from: () => ({}) }) }));
vi.mock("../src/logger.js", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { normalizeSkillFiles } from "../src/skills/store.js";

const VALID = {
  "SKILL.md": "---\nname: my-skill\ndescription: One line.\n---\n\n# Body\n",
  "references/": "",
  "references/case.md": "see also",
  "assets/": "",
};

describe("normalizeSkillFiles", () => {
  it("accepts a well-formed tree", () => {
    expect(normalizeSkillFiles(VALID)).toEqual(VALID);
  });

  it("rejects a tree without SKILL.md", () => {
    const { "SKILL.md": _, ...rest } = VALID;
    expect(normalizeSkillFiles(rest)).toBeNull();
    expect(normalizeSkillFiles({ ...VALID, "SKILL.md": "   " })).toBeNull();
  });

  it("rejects escaping or absolute paths", () => {
    expect(normalizeSkillFiles({ ...VALID, "../secrets.md": "x" })).toBeNull();
    expect(normalizeSkillFiles({ ...VALID, "references/../../etc/passwd": "x" })).toBeNull();
    expect(normalizeSkillFiles({ ...VALID, "/etc/passwd": "x" })).toBeNull();
  });

  it("rejects folders with content and non-string values", () => {
    expect(normalizeSkillFiles({ ...VALID, "references/": "not empty" })).toBeNull();
    expect(normalizeSkillFiles({ ...VALID, "notes.txt": 42 })).toBeNull();
    expect(normalizeSkillFiles("nope")).toBeNull();
    expect(normalizeSkillFiles(null)).toBeNull();
  });
});
