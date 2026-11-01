/**
 * Compile an agent definition into a runnable context: the skills, the tool
 * allowlist, the budget, and the selected system prompt.
 *
 * Every run loads ALL skills (builtins + the user's customs) — a request may
 * pass an explicit skill id list to override. Skill bodies are injected whole
 * into the agent's prompt.
 */

import { listAllSkillsForUser, resolveSkill } from "../skills/catalog.js";
import type { HarnessSkill } from "../skills/loader.js";
import type { Budget } from "../types.js";
import type { AgentDefinition } from "./store.js";
import { applyVariables, type OutputTemplate } from "../system-prompts/catalog.js";

export interface CompiledAgent {
  allowedTools: string[];
  budget: Budget;
  skills: HarnessSkill[];
  template: OutputTemplate | null;
}

export interface CompileOptions {
  template?: OutputTemplate | null;
  /** `{{placeholders}}` substituted into the template body. */
  vars?: Record<string, string | undefined>;
  /** Explicit skill ids (request override); omitted/empty = all of the user's skills. */
  skillIds?: string[];
}

export async function compileAgent(userId: string, def: AgentDefinition, opts: CompileOptions = {}): Promise<CompiledAgent> {
  let skills: HarnessSkill[];
  if (opts.skillIds?.length) {
    const resolved = await Promise.all(opts.skillIds.map((id) => resolveSkill(userId, id)));
    skills = resolved.filter((s): s is HarnessSkill => s !== null);
  } else {
    skills = await listAllSkillsForUser(userId);
  }
  const skillTools = new Set(skills.flatMap((s) => s.allowedTools));
  const allowedTools = def.allowedTools.length ? def.allowedTools : [...skillTools];
  const template = opts.template
    ? { ...opts.template, body: applyVariables(opts.template.body, opts.vars ?? {}) }
    : null;
  return { allowedTools, budget: def.budget, skills, template };
}
