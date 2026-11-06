/**
 * Harness agent definitions — the agent-definition seam.
 *
 * The harness owns the concept (name, soul prompt, skills, tools, model,
 * budget, output template) but NOT the storage. Persistence sits behind
 * AgentRepository: this module ships a hermetic in-memory implementation
 * (CLI, tests), and the API installs the Supabase adapter (see
 * api/src/harness-adapters.ts) at boot via setAgentRepository.
 *
 * Migration 019 (the harness columns + agent_runs table) was never applied to
 * the Supabase project, so the Supabase adapter stores the harness fields
 * inside the existing `configuration` jsonb column under the same names the
 * migration would have used as columns (soul_prompt, skill_ids, allowed_tools,
 * model_id, budget), marked with `configuration.harness_version = 2`. Row
 * mapping is the adapter's concern, not this module's.
 */

import { clampBudget, type Budget } from "../types.js";

export const HARNESS_VERSION = 2;

export interface AgentDefinition {
  id: string;
  userId: string;
  name: string;
  soulPrompt: string;
  skillIds: string[];
  allowedTools: string[];
  modelId: string | null;
  budget: Budget;
  /** The agent's default system prompt (agent.yaml prompts.* name); null = default prompt. */
  systemPrompt: string | null;
  createdAt: string | null;
}

export interface AgentInput {
  name: string;
  soulPrompt?: string;
  skillIds?: string[];
  allowedTools?: string[];
  modelId?: string | null;
  budget?: Partial<Budget>;
  systemPrompt?: string | null;
}

/** Seeded for a user with no harness agents: the built-in technical read. */
export const DEFAULT_HARNESS_AGENT: AgentInput = {
  name: "Technical Analysis Agent",
  soulPrompt:
    "You are a technical analyst. Judge the market's own record — trend structure, momentum, volume, and support/resistance — over opinion. Read price and indicator evidence from the tools, and say INSUFFICIENT where the data does not cover the question.",
  skillIds: ["technical-analysis"],
};

/** Where agent definitions live. Two real adapters: Supabase (server) + memory. */
export interface AgentRepository {
  list(userId: string): Promise<AgentDefinition[]>;
  get(userId: string, id: string): Promise<AgentDefinition | null>;
  create(userId: string, input: AgentInput): Promise<AgentDefinition>;
  update(userId: string, id: string, input: Partial<AgentInput>): Promise<AgentDefinition | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

/** Hermetic default — no network, no DB. Good for the CLI and tests. */
export function createMemoryAgentRepository(): AgentRepository {
  const rows = new Map<string, AgentDefinition>();

  return {
    async list(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
    async get(userId, id) {
      const row = rows.get(id);
      return row && row.userId === userId ? row : null;
    },
    async create(userId, input) {
      const row: AgentDefinition = {
        id: crypto.randomUUID(),
        userId,
        name: input.name,
        soulPrompt: input.soulPrompt ?? "",
        skillIds: input.skillIds ?? [],
        allowedTools: input.allowedTools ?? [],
        modelId: input.modelId ?? null,
        budget: clampBudget(input.budget),
        systemPrompt: input.systemPrompt ?? null,
        createdAt: new Date().toISOString(),
      };
      rows.set(row.id, row);
      return row;
    },
    async update(userId, id, input) {
      const existing = rows.get(id);
      if (!existing || existing.userId !== userId) return null;
      const merged: AgentDefinition = {
        ...existing,
        name: input.name ?? existing.name,
        soulPrompt: input.soulPrompt ?? existing.soulPrompt,
        skillIds: input.skillIds ?? existing.skillIds,
        allowedTools: input.allowedTools ?? existing.allowedTools,
        modelId: input.modelId !== undefined ? input.modelId : existing.modelId,
        budget: input.budget ? clampBudget({ ...existing.budget, ...input.budget }) : existing.budget,
        systemPrompt: input.systemPrompt !== undefined ? input.systemPrompt : existing.systemPrompt,
      };
      rows.set(id, merged);
      return merged;
    },
    async delete(userId, id) {
      const existing = rows.get(id);
      if (!existing || existing.userId !== userId) return false;
      rows.delete(id);
      return true;
    },
  };
}

let repository: AgentRepository = createMemoryAgentRepository();

/** Install the persistence adapter (called once at server boot). */
export function setAgentRepository(repo: AgentRepository): void {
  repository = repo;
}

export function getAgentRepository(): AgentRepository {
  return repository;
}

// ── Facade — stable call surface; the repository does the work ──────────────

export async function listAgents(userId: string): Promise<AgentDefinition[]> {
  return repository.list(userId);
}

export async function getAgent(userId: string, id: string): Promise<AgentDefinition | null> {
  return repository.get(userId, id);
}

export async function createAgent(userId: string, input: AgentInput): Promise<AgentDefinition> {
  return repository.create(userId, input);
}

export async function updateAgent(userId: string, id: string, input: Partial<AgentInput>): Promise<AgentDefinition | null> {
  return repository.update(userId, id, input);
}

export async function deleteAgent(userId: string, id: string): Promise<boolean> {
  return repository.delete(userId, id);
}
