/**
 * Progressive disclosure for skills.
 *
 * Only metadata (~100 tokens/skill) is injected when an agent is compiled. The
 * full body loads when the loop activates the skill, and `references/` files
 * load only when the model asks for them. This keeps a 5-skill agent's system
 * prompt small while still giving each skill its full instructions on use.
 */

import type { HarnessSkill } from "./loader.js";

/**
 * The skill's report-structure reference — its binding presentation spec.
 * Matched by path (report-structure.md), never inlined into harness code:
 * the skill owns the structure, the harness only surfaces it.
 */
export function reportStructureOf(skill: HarnessSkill): string | null {
  const ref = skill.references.find((r) => /report[-_ ]?structure/i.test(r.path));
  return ref?.text?.trim() || null;
}

/** All active skills' report-structure texts as one binding block ("" when none). */
export function reportStructureBlock(skills: HarnessSkill[]): string {
  const parts = skills
    .map((s) => {
      const text = reportStructureOf(s);
      return text ? `### ${s.id}\n${text}` : null;
    })
    .filter((x): x is string => !!x);
  if (!parts.length) return "";
  return [
    "The report this run produces MUST follow this structure and these writing standards. They override any default formatting habit — including section shapes suggested elsewhere in the skill body. Where the skill body and this structure disagree on presentation, THIS STRUCTURE WINS: present the same findings the way the structure prescribes.",
    "",
    ...parts,
  ].join("\n\n");
}

/**
 * Full instructions for an activated skill: header, body, then the remaining
 * references on demand. The report-structure reference is NOT repeated here —
 * the harness hoists it once as a single BINDING block above every skill body
 * (reportStructureBlock), so the structure ships exactly once per prompt.
 */
export function activateSkill(skill: HarnessSkill): string {
  const refs = skill.references.filter((r) => !/report[-_ ]?structure/i.test(r.path));
  const refsText = refs.length
    ? `\n\n## References\n${refs.map((r) => `### ${r.path}\n${r.text}`).join("\n\n")}`
    : "";
  return `# Skill: ${skill.name} (${skill.id})\n\n${skill.body}${refsText}`;
}
