/**
 * Progressive disclosure for skills.
 *
 * Only metadata (~100 tokens/skill) is injected when an agent is compiled. The
 * full body loads when the loop activates the skill, and `references/` files
 * load only when the model asks for them. This keeps a 5-skill agent's system
 * prompt small while still giving each skill its full instructions on use.
 */

import type { HarnessSkill } from "./loader.js";

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
}

export function skillMetadata(skill: HarnessSkill): SkillMetadata {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    allowedTools: skill.allowedTools,
  };
}

/** Compact catalog injected into the system prompt at compile time. */
export function compileSkillCatalog(skills: HarnessSkill[]): string {
  if (!skills.length) return "(no skills)";
  return skills
    .map((s) => `- ${s.id} [${s.category}]: ${s.description}`)
    .join("\n");
}

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
 * Full instructions for an activated skill. The report-structure reference is
 * hoisted to a BINDING section right under the header (models ignore specs
 * appended after a long body); the remaining references stay on demand.
 */
export function activateSkill(skill: HarnessSkill): string {
  const header = `# Skill: ${skill.name} (${skill.id})`;
  const structure = reportStructureOf(skill);
  const structureBlock = structure ? `\n\n## Report structure (BINDING)\n${structure}` : "";
  const refs = skill.references.filter((r) => !/report[-_ ]?structure/i.test(r.path));
  const refsText = refs.length
    ? `\n\n## References\n${refs.map((r) => `### ${r.path}\n${r.text}`).join("\n\n")}`
    : "";
  return `${header}${structureBlock}\n\n${skill.body}${refsText}`;
}
