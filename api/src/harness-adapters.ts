/**
 * Supabase adapters for the harness persistence ports.
 *
 * The harness defines AgentRepository / SkillRepository (see
 * src/harness/agents/store.ts and src/harness/skills/catalog.ts) and ships
 * hermetic in-memory defaults; this file is the server's adapter — row
 * mapping and SQL live here, next to ./db.js, never inside the harness.
 * index.ts calls installHarnessAdapters() once at boot.
 *
 * Migration 019 (harness columns + agent_runs) was never applied to the
 * Supabase project, so agent fields live in the existing `configuration`
 * jsonb column under the names the migration would have used, marked with
 * `configuration.harness_version = 2`. Legacy columns stay untouched for the
 * old builder.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import {
  HARNESS_VERSION,
  clampBudget,
  setAgentRepository,
  setSkillRepository,
  type AgentDefinition,
  type AgentInput,
  type AgentRepository,
  type CustomSkillRecord,
  type SkillRepository,
} from "./harness/index.js";

// ── Agents ──────────────────────────────────────────────────────────────────

function isHarness(row: any): boolean {
  return row?.configuration?.harness_version === HARNESS_VERSION;
}

function rowToDefinition(row: any): AgentDefinition {
  const c = row.configuration ?? {};
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    soulPrompt: c.soul_prompt ?? "",
    skillIds: c.skill_ids ?? [],
    allowedTools: c.allowed_tools ?? [],
    modelId: c.model_id ?? null,
    budget: clampBudget(c.budget ?? undefined),
    systemPrompt: c.system_prompt ?? null,
    createdAt: row.created_at ?? null,
  };
}

function toConfig(input: AgentInput, base?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(base ?? {}),
    harness_version: HARNESS_VERSION,
    soul_prompt: input.soulPrompt ?? "",
    skill_ids: input.skillIds ?? [],
    allowed_tools: input.allowedTools ?? [],
    model_id: input.modelId ?? null,
    budget: clampBudget(input.budget),
    system_prompt: input.systemPrompt ?? null,
  };
}

export const supabaseAgentRepository: AgentRepository = {
  async list(userId) {
    const { data, error } = await getDb()
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).filter(isHarness).map(rowToDefinition);
  },

  async get(userId, id) {
    const { data, error } = await getDb().from("agents").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data && isHarness(data) ? rowToDefinition(data) : null;
  },

  async create(userId, input) {
    const row = {
      id: randomUUID(),
      user_id: userId,
      name: input.name,
      source: "harness",
      configuration: toConfig(input),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await getDb().from("agents").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return rowToDefinition(data);
  },

  async update(userId, id, input) {
    const { data: existing, error: fetchErr } = await getDb().from("agents").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing || !isHarness(existing)) return null;
    const c = existing.configuration ?? {};
    const merged: AgentInput = {
      name: input.name ?? existing.name,
      soulPrompt: input.soulPrompt ?? c.soul_prompt ?? "",
      skillIds: input.skillIds ?? c.skill_ids ?? [],
      allowedTools: input.allowedTools ?? c.allowed_tools ?? [],
      modelId: input.modelId !== undefined ? input.modelId : c.model_id ?? null,
      budget: input.budget ?? c.budget,
      systemPrompt: input.systemPrompt !== undefined ? input.systemPrompt : c.system_prompt ?? null,
    };
    const patch: Record<string, unknown> = {
      configuration: toConfig(merged, c),
      updated_at: new Date().toISOString(),
    };
    if (input.name !== undefined) patch.name = input.name;
    const { data, error } = await getDb().from("agents").update(patch).eq("user_id", userId).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data ? rowToDefinition(data) : null;
  },

  async delete(userId, id) {
    const { error } = await getDb().from("agents").delete().eq("user_id", userId).eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  },
};

// ── Custom skills ───────────────────────────────────────────────────────────

interface CustomSkillRow {
  user_id: string;
  skill_id: string;
  markdown: string;
  created_at?: string;
  updated_at?: string;
}

function rowToRecord(row: CustomSkillRow): CustomSkillRecord {
  return { skillId: row.skill_id, markdown: row.markdown, updatedAt: row.updated_at ?? row.created_at };
}

export const supabaseSkillRepository: SkillRepository = {
  async list(userId) {
    const { data, error } = await getDb().from("skills").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToRecord);
  },

  async get(userId, skillId) {
    const { data, error } = await getDb().from("skills").select("*").eq("user_id", userId).eq("skill_id", skillId).maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data as CustomSkillRow);
  },

  async upsert(userId, skillId, markdown) {
    const { error } = await getDb().from("skills").upsert(
      { user_id: userId, skill_id: skillId, markdown, updated_at: new Date().toISOString() },
      { onConflict: "user_id,skill_id" },
    );
    if (error) throw new Error(`Failed to save skill: ${error.message}`);
  },

  async delete(userId, skillId) {
    const { error } = await getDb().from("skills").delete().eq("user_id", userId).eq("skill_id", skillId);
    if (error) throw new Error(error.message);
    return true;
  },
};

/** Install both Supabase adapters into the harness (once, at server boot). */
export function installHarnessAdapters(): void {
  setAgentRepository(supabaseAgentRepository);
  setSkillRepository(supabaseSkillRepository);
}

// ── Console view mapping ────────────────────────────────────────────────────
// Row mapping belongs on this side of the seam: the console's view shape
// (persona.philosophy, skills[]) is a server concern, not a harness one.

/** Project a harness definition into the shape the console expects. */
export function harnessToView(d: AgentDefinition) {
  return {
    id: d.id,
    _id: d.id,
    user_id: d.userId,
    name: d.name,
    source: "harness",
    harness: true,
    created_at: d.createdAt,
    persona: { philosophy: d.soulPrompt },
    skills: d.skillIds.map((skill_id) => ({ skill_id, weight: 5 })),
    soul_prompt: d.soulPrompt,
    skill_ids: d.skillIds,
    allowed_tools: d.allowedTools,
    model_id: d.modelId,
    budget: d.budget,
    system_prompt: d.systemPrompt,
  };
}

/** Map a console write into a harness patch — only fields actually present,
 *  so a partial update never wipes the rest of the configuration. */
export function viewToHarnessPatch(body: Record<string, any>) {
  const patch: Record<string, any> = {};
  if (body.name !== undefined) patch.name = String(body.name);
  const phil = body.soulPrompt ?? body.soul_prompt ?? body.philosophy
    ?? body.persona?.philosophy ?? body.persona?.philosophy_and_mindset;
  if (phil !== undefined) patch.soulPrompt = String(phil);
  const raw = Array.isArray(body.skillIds) ? body.skillIds
    : Array.isArray(body.skill_ids) ? body.skill_ids
      : Array.isArray(body.skills) ? body.skills : undefined;
  if (raw) patch.skillIds = raw.map((s: any) => (typeof s === "string" ? s : s?.skill_id)).filter(Boolean);
  const tools = body.allowedTools ?? body.allowed_tools;
  if (Array.isArray(tools)) patch.allowedTools = tools;
  if (body.modelId !== undefined || body.model_id !== undefined) patch.modelId = body.modelId ?? body.model_id;
  if (body.systemPrompt !== undefined || body.system_prompt !== undefined) {
    patch.systemPrompt = body.systemPrompt ?? body.system_prompt ?? null;
  }
  return patch;
}
