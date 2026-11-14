/**
 * skills/artifacts — turns the raw tool evidence of a skill run into workbook
 * artifacts.
 *
 * Currently the only builder is the DCF model (dcf.ts). Each builder returns
 * one or more `ArtifactDraft`s; this module maps those into the `SkillArtifact`
 * shape stored with the analysis run and handed to the PDF report.
 */

import { buildDcfRecipe } from "./dcf.js";
import type { ArtifactDraft, ArtifactInput, SkillArtifact } from "./types.js";

function toArtifact(input: ArtifactInput, draft: ArtifactDraft): SkillArtifact {
  const base: SkillArtifact = {
    id: `${input.skillId}:workbook`,
    skill_id: input.skillId,
    kind: "workbook",
    status: draft.status,
    summary: draft.summary,
    note: draft.note,
  };
  return draft.recipe ? { ...base, recipe: draft.recipe } : base;
}

/**
 * Build the workbook artifact for a single skill run.
 *
 * One artifact per ready/partial builder; a builder with nothing to say
 * returns an `unavailable` draft with a `note`, which the download route
 * reports as a 409.
 */
export function buildArtifacts(input: ArtifactInput): SkillArtifact[] {
  // ponytail: DCF is only meaningful for valuation skills; gating here avoids
  // building workbooks for skills like growth-analysis that never asked for one.
  // Add when a second artifact category exists — replace this check with a
  // per-category builder map.
  if (input.skillCategory !== "valuation") return [];
  return buildDcfRecipe(input).map((draft) => toArtifact(input, draft));
}