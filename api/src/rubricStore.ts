/**
 * Rubric store (plan §6.3) — persistence + lifecycle of compiled rubrics.
 *
 * Compile on agent save when the md hash changed; runs use the rubric whose
 * `(agent_id, md_hash)` matches, drafts allowed with an "unapproved rubric"
 * banner (D5). Editing the md changes the hash → new compile, approval void.
 */

import { createHash } from "node:crypto";
import { getDb } from "./db.js";
import { log } from "./logger.js";
import { buildCompileRubricPrompt } from "./prompts.js";
import { FEATURE_CATALOG } from "./units.js";
import { compileRubric, compiledRubricSchema, type CompiledRubric, type CompileOptions } from "./rubric.js";

export type RubricStatus = "draft" | "approved" | "auto";

export interface RubricRow {
  id: string;
  agent_id: string;
  md_hash: string;
  compiler_version: string;
  criteria: CompiledRubric;
  status: RubricStatus;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export function mdHash(md: string): string {
  return createHash("sha256").update(md || "").digest("hex").slice(0, 16);
}

/** Feature catalog rendered for the compiler prompt. */
export function featureCatalogPrompt(): string {
  return Object.entries(FEATURE_CATALOG)
    .map(
      ([key, spec]) =>
        `- ${key}: ${spec.desc} (${spec.unit}${spec.series ? ", time series oldest→newest" : ""})`,
    )
    .join("\n");
}

/** Fetch the latest rubric row for an agent (any status), null if never compiled. */
export async function getRubricForAgent(agentId: string): Promise<RubricRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("agent_rubrics")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) {
    // PGRST116 = no rows; anything else is a real error worth surfacing.
    if (String(error.code || error.message).includes("PGRST116")) return null;
    throw error;
  }
  return rowToRubric(data);
}

function rowToRubric(data: any): RubricRow {
  return { ...data, criteria: data.criteria as CompiledRubric };
}

/**
 * Load the rubric matching an md snapshot. Returns null when none exists yet —
 * callers on the v2 path compile-if-absent (shadow mode).
 */
export async function loadRubricForMd(
  agentId: string,
  md: string,
): Promise<{ rubric: RubricRow; fresh: boolean } | null> {
  const db = getDb();
  const hash = mdHash(md);
  const { data, error } = await db
    .from("agent_rubrics")
    .select("*")
    .eq("agent_id", agentId)
    .eq("md_hash", hash)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) {
    if (String(error.code || error.message).includes("PGRST116")) return null;
    throw error;
  }
  return { rubric: rowToRubric(data), fresh: true };
}

/** Compile (if no matching row exists) and persist as draft. */
export async function ensureCompiledRubric(
  agentId: string,
  md: string,
  investorProfile: string,
  parameters: { parameter: string; content: string; weightage: number; section: string }[],
  opts: CompileOptions = {},
): Promise<{ rubric: RubricRow | null; error?: string }> {
  const existing = await loadRubricForMd(agentId, md);
  if (existing) return { rubric: existing.rubric };

  const prompt = buildCompileRubricPrompt({
    investorProfile,
    parameters,
    featureCatalog: featureCatalogPrompt(),
    compilerVersion: "1",
  });

  const result = await compileRubric(prompt, opts);
  if (!result.ok) return { rubric: null, error: result.error };

  const db = getDb();
  const row = {
    agent_id: agentId,
    md_hash: mdHash(md),
    compiler_version: result.compilerVersion,
    criteria: result.rubric,
    status: "draft" as const,
  };
  const { data, error } = await db.from("agent_rubrics").insert(row).select("*").single();
  if (error) {
    // unique(agent_id, md_hash, compiler_version) collision → another save won;
    // return that winner.
    if (String(error.code || error.message).includes("23505")) {
      const winner = await loadRubricForMd(agentId, md);
      if (winner) return { rubric: winner.rubric };
    }
    return { rubric: null, error: error.message };
  }
  log.info("[rubric]", `compiled ${parameters.length} params for agent ${agentId}s`);
  return { rubric: rowToRubric(data) };
}

export async function approveRubric(agentId: string, rubricId: string, userId: string): Promise<RubricRow> {
  const db = getDb();
  const { data, error } = await db
    .from("agent_rubrics")
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", rubricId)
    .eq("agent_id", agentId)
    .select("*")
    .single();
  if (error) throw error;
  if (!data) throw new Error("rubric not found");
  return rowToRubric(data);
}