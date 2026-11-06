/**
 * Compile an agent definition into a runnable context: the skills, the tool
 * allowlist, the budget, and the selected system prompt.
 *
 * ONE skill per run: the request override if given, else the agent's own
 * skillId. Its body is injected whole into the agent's prompt; an agent with
 * no (resolvable) skill runs on the instructions doc alone.
 */

import { resolveSkill } from "../skills/catalog.js";
import type { HarnessSkill } from "../skills/loader.js";
import type { Budget } from "../types.js";
import type { AgentDefinition } from "./store.js";
import { applyVariables, type SystemPrompt } from "../system-prompts/catalog.js";

export interface CompiledAgent {
  allowedTools: string[];
  budget: Budget;
  skills: HarnessSkill[];
  template: SystemPrompt | null;
}

export interface CompileOptions {
  template?: SystemPrompt | null;
  /** `{{placeholders}}` substituted into the prompt body. */
  vars?: Record<string, string | undefined>;
  /** Explicit skill id (request override); omitted/empty = the agent's own pick. */
  skillIds?: string[];
}

export async function compileAgent(userId: string, def: AgentDefinition, opts: CompileOptions = {}): Promise<CompiledAgent> {
  // Request override > the agent's own pick. At most ONE skill runs per request.
  const ids = (opts.skillIds?.length ? opts.skillIds : def.skillIds).slice(0, 1);
  const resolved = await Promise.all(ids.map((id) => resolveSkill(userId, id)));
  const skills = resolved.filter((s): s is HarnessSkill => s !== null);
  const skillTools = new Set(skills.flatMap((s) => s.allowedTools));
  const allowedTools = def.allowedTools.length ? def.allowedTools : [...skillTools];
  const template = opts.template
    ? { ...opts.template, body: applyVariables(opts.template.body, opts.vars ?? {}) }
    : null;
  return { allowedTools, budget: def.budget, skills, template };
}
