/**
 * Skill resolution — turn an agent's v3 skill references into concrete
 * skill definitions. Custom skills shadow builtins; unknown skill ids are
 * logged and skipped (never guessed).
 */

import { resolveSkill } from "./store.js";
import type { AgentConfigV3 } from "../agentmd.js";
import type { SkillDefinition } from "./types.js";

export interface ResolvedSkill {
  skill: SkillDefinition;
  weight: number;
}

export async function resolveSkillsForAgent(userId: string, agent: AgentConfigV3): Promise<ResolvedSkill[]> {
  const out: ResolvedSkill[] = [];
  const seen = new Set<string>();
  for (const ref of agent.skills || []) {
    if (seen.has(ref.skill_id)) continue; // dedupe repeated refs, keep first
    seen.add(ref.skill_id);
    const skill = await resolveSkill(userId, ref.skill_id);
    if (!skill) {
      continue;
    }
    out.push({ skill, weight: ref.weight });
  }
  return out;
}
