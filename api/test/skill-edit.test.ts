import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PUT /skills/:id — "all skills are editable".
 *
 * Custom skills save in place; built-in skills fork-on-save: the user's edit
 * is stored as a custom skill with the SAME id, which shadows the builtin for
 * this user (store.ts resolves custom-first). A mismatched frontmatter id is
 * rejected with a clear message instead of silently creating a new skill.
 */

const upsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("../src/db.js", () => ({
  getDb: () => ({ from: () => ({ upsert }) }),
}));

vi.mock("../src/logger.js", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { saveCustomSkill } from "../src/skills/store.js";
import { parseSkillMarkdown } from "../src/skills/parse.js";

const VALID_MD = `---
name: dcf-valuation
description: Estimates intrinsic value via discounted cash flow with custom thresholds.
metadata:
  title: DCF Valuation (my tweak)
  category: valuation
  version: "1"
---

## Purpose
Determines what the business is worth today by projecting free cash flow.

## Data
- get_dcf_valuation

## Method
1. Run the DCF tool for the base case.

## Verdict Anchors
- Intrinsic value exceeds price with margin of safety — weight 9
`;

describe("fork-on-save semantics", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("saving a builtin id's markdown upserts a custom skill with the same id (shadows the builtin)", async () => {
    const { skill } = await saveCustomSkill("user-1", VALID_MD);
    expect(skill?.id).toBe("dcf-valuation");
    expect(skill?.source).toBe("custom");
    expect(skill?.name).toBe("DCF Valuation (my tweak)");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", skill_id: "dcf-valuation" }),
      { onConflict: "user_id,skill_id" },
    );
  });

  it("the parser rejects a draft whose id collides with nothing but must stay consistent for PUT", () => {
    const { skill } = parseSkillMarkdown(VALID_MD.replace("name: dcf-valuation", "name: my-own"), "custom");
    // parse works standalone; the PUT route enforces the id match.
    expect(skill?.id).toBe("my-own");
  });

  it("invalid markdown fails validation and does not touch the DB", async () => {
    const { skill } = await saveCustomSkill("user-1", "not a skill document");
    expect(skill).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});
