/**
 * agentstore — normalize agent rows to the canonical v3 (skill-based)
 * AgentConfigV3 shape. Markdown is the source of truth when present; the
 * legacy JSONB columns are the fallback during migration.
 *
 * Lazy migration (D3): a row whose md_config is empty OR parses under the v2
 * grammar is converted on load — qualitative params become a generated
 * "Custom Checklist" skill, quantitative rules become a generated "Quant
 * Screen" skill (both stored per-user in the `skills` table), and the agent's
 * v3 markdown is written back. Legacy columns are never mutated, so rollback
 * is trivial.
 */

import { parseMd, serializeMd, type AgentConfig, type MdIssue } from "./mdconfig.js";
import { parseAgentMd, serializeAgentMd, validateAgentV3, type AgentConfigV3 } from "./agentmd.js";
import { normalizeQuantRules } from "./metrics.js";
import { getDb } from "./db.js";
import { saveCustomSkill } from "./skills/store.js";
import { log } from "./logger.js";

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  source: string;
  md_config?: string | null;
  persona?: any;
  configuration?: any;
  asset_evaluation?: any;
  macro_evaluation?: any;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

export class ValidationError extends Error {
  issues: MdIssue[];
  constructor(message: string, issues: MdIssue[]) {
    super(message);
    this.issues = issues;
  }
}

/** Clamp an integer to [lo, hi], falling back to `def` when the value is non-finite. */
function clampInt(val: any, lo: number, hi: number, def: number): number {
  const n = Math.round(Number(val));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

// ── Migration helpers ─────────────────────────────────────────────────────

const CHECKLIST_SKILL_ID = "custom-checklist";
const QUANTSCREEN_SKILL_ID = "quant-screen";

/** Anchor label cap so generated skills stay readable. */
function trunc(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function isV2Config(v: any): v is AgentConfig {
  return !!v && typeof v === "object" && ("asset_evaluation" in v || "macro_evaluation" in v) && !("skills" in v);
}

function skillIdFor(agentName: string, kind: "checklist" | "quant"): string {
  const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "agent";
  return kind === "checklist" ? `${slug}-${CHECKLIST_SKILL_ID}` : `${slug}-${QUANTSCREEN_SKILL_ID}`;
}

function generateChecklistSkill(agentName: string, qualitative: any[], macro: any[]): string | null {
  const items = [...(qualitative || []), ...(macro || [])].filter((q) => q?.parameter?.trim());
  if (!items.length) return null;
  const anchors = items
    .map((q) => `- ${q.content ? `${trunc(q.parameter)}: ${trunc(q.content, 160)}` : trunc(q.parameter)} — weight ${clampInt(q.weightage, 1, 10, 5)}`)
    .join("\n");
  const md = `---
id: ${skillIdFor(agentName, "checklist")}
name: ${agentName} — Custom Checklist
description: Migrated qualitative evaluation parameters from the previous agent format.
category: custom
version: 1
---

## Purpose

Checklist carried over from the "${agentName}" agent's qualitative evaluation parameters. Each anchor is one of the agent's original criteria; verdicts preserve its original relative weights.

## Data

- web_search

## Method

1. For each anchor, gather the evidence an analyst would need to answer it honestly.
2. Where evidence is unavailable, give INSUFFICIENT — never guess.

## Verdict Anchors

${anchors}
`;
  return md;
}

function generateQuantSkill(agentName: string, quantitative: any[], macroQuant: any[]): string | null {
  const rules = [...(quantitative || []), ...(macroQuant || [])].filter((r) => r?.metric?.trim());
  if (!rules.length) return null;
  const anchors = rules
    .map((r) => {
      const name = r.metric_name || r.metric;
      const op = r.operator === "between" && r.value_upper != null ? `${r.value} to ${r.value_upper}` : `${r.operator === "gt" ? ">" : r.operator === "gte" ? ">=" : r.operator === "lt" ? "<" : r.operator === "lte" ? "<=" : "="} ${r.value}`;
      return `- ${name} ${op} — weight ${clampInt(r.weightage, 1, 10, 5)}`;
    })
    .join("\n");
  const md = `---
id: ${skillIdFor(agentName, "quant")}
name: ${agentName} — Quant Screen
description: Migrated quantitative rules from the previous agent format, evaluated deterministically.
category: custom
version: 1
---

## Purpose

Numeric rules carried over from the "${agentName}" agent's quantitative criteria. These are evaluated in code against the metrics snapshot (soft-boundary thresholds, unknown ≠ 0), not by the model.

## Data

- get_financial_metrics

## Method

1. Pull the TTM metrics snapshot and evaluate each rule below.

## Verdict Anchors

${anchors}
`;
  return md;
}

/** Migrate a v2 agent (md or JSONB columns) to v3, persisting generated skills. */
async function migrateToV3(row: AgentRow): Promise<{ config: AgentConfigV3; md: string } | null> {
  // Parse under the v2 grammar (md first, JSONB fallback) to recover criteria.
  let v2: AgentConfig | null = null;
  if (row.md_config?.trim()) {
    const parsed = parseMd(row.md_config);
    v2 = parsed.agent;
  }
  if (!v2 && (row.asset_evaluation || row.macro_evaluation)) {
    try {
      v2 = {
        name: row.name,
        persona: { philosophy_and_mindset: row.persona?.philosophy_and_mindset || "" },
        configuration: {
          investment_horizon: row.configuration?.investment_horizon || "",
          risk_appetite: clampInt(row.configuration?.risk_appetite, 1, 10, 5),
        },
        asset_evaluation: {
          qualitative: Array.isArray(row.asset_evaluation?.qualitative) ? row.asset_evaluation.qualitative : [],
          quantitative: Array.isArray(row.asset_evaluation?.quantitative) ? row.asset_evaluation.quantitative : [],
        },
        macro_evaluation: {
          qualitative: Array.isArray(row.macro_evaluation?.qualitative) ? row.macro_evaluation.qualitative : [],
          quantitative: Array.isArray(row.macro_evaluation?.quantitative) ? row.macro_evaluation.quantitative : [],
        },
      };
    } catch {
      return null;
    }
  }
  if (!v2) return null;

  const skillIds: { skill_id: string; weight: number }[] = [];
  const userId = row.user_id;

  const checklistMd = generateChecklistSkill(v2.name, v2.asset_evaluation?.qualitative, v2.macro_evaluation?.qualitative);
  if (checklistMd) {
    const qCount = (v2.asset_evaluation?.qualitative?.length || 0) + (v2.macro_evaluation?.qualitative?.length || 0);
    try {
      await saveCustomSkill(userId, checklistMd);
      skillIds.push({ skill_id: skillIdFor(v2.name, "checklist"), weight: 5 });
    } catch (e: any) {
      log.warn("agentstore", `migration: checklist skill save failed: ${e?.message}`);
    }
  }

  const quantRules = normalizeQuantRules([
    ...(v2.asset_evaluation?.quantitative || []),
    ...(v2.macro_evaluation?.quantitative || []),
  ]);
  const quantMd = generateQuantSkill(v2.name, quantRules, []);
  if (quantMd) {
    try {
      await saveCustomSkill(userId, quantMd);
      skillIds.push({ skill_id: skillIdFor(v2.name, "quant"), weight: 5 });
    } catch (e: any) {
      log.warn("agentstore", `migration: quant skill save failed: ${e?.message}`);
    }
  }

  const v3: AgentConfigV3 = {
    name: v2.name || row.name,
    description: v2.description,
    persona: { philosophy: v2.persona?.philosophy_and_mindset || "" },
    configuration: {
      investment_horizon: v2.configuration?.investment_horizon || "",
      risk_appetite: clampInt(v2.configuration?.risk_appetite, 1, 10, 5),
    },
    skills: skillIds,
  };
  const md = serializeAgentMd(v3);
  return { config: v3, md };
}

// ── Canonical row → config ────────────────────────────────────────────────

export interface LoadedAgent {
  row: AgentRow;
  config: AgentConfigV3 | null;
  issues: MdIssue[];
  md: string;
  /** True when this load performed the v2→v3 migration and wrote back. */
  migrated?: boolean;
}

export function agentFromRowSync(row: AgentRow): { config: AgentConfigV3 | null; issues: MdIssue[]; md: string; migrated: boolean } {
  if (row.md_config?.trim()) {
    const parsed = parseAgentMd(row.md_config);
    if (parsed.agent) {
      const check = validateAgentV3(parsed.agent);
      if (check.ok) return { config: check.config, issues: parsed.issues, md: row.md_config, migrated: false };
      return { config: null, issues: [...parsed.issues, ...check.issues], md: row.md_config, migrated: false };
    }
    // md exists but doesn't parse as v3 — try v2 migration below.
    return { config: null, issues: parsed.issues, md: row.md_config, migrated: false };
  }
  return { config: null, issues: [], md: "", migrated: false };
}

/** Parse an agent row (markdown-first, legacy JSONB fallback), migrating lazily. */
export async function agentFromRow(row: AgentRow): Promise<{ config: AgentConfigV3 | null; issues: MdIssue[]; md: string; migrated: boolean }> {
  const sync = agentFromRowSync(row);
  if (sync.config) return sync;

  // Migration path: v2 md (or legacy JSONB) → v3.
  const looksV2 = !!row.md_config?.trim() || !!row.asset_evaluation || !!row.macro_evaluation;
  if (looksV2) {
    try {
      const migrated = await migrateToV3(row);
      if (migrated) {
        const check = validateAgentV3(migrated.config);
        if (check.ok) {
          // Persist the v3 md back to the row (legacy columns untouched).
          try {
            const db = getDb();
            await db.from("agents").update({ md_config: migrated.md }).eq("id", row.id);
          } catch (e: any) {
            log.warn("agentstore", `migration: md write-back failed (run continues on migrated md): ${e?.message}`);
          }
          return { config: migrated.config, issues: [], md: migrated.md, migrated: true };
        }
      }
    } catch (e: any) {
      log.warn("agentstore", `migration failed for agent ${row.id}: ${e?.message}`);
    }
  }
  return sync;
}

/** Shared agent lookup for the analysis orchestrators (name-or-id, md-first). */
export async function loadAgent(userId: string, nameOrId: string): Promise<LoadedAgent> {
  const db = getDb();
  const { data, error } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .or(`name.eq.${nameOrId},id.eq.${nameOrId}`)
    .single();
  if (error || !data) throw new Error(`Agent not found: ${nameOrId}`);
  const row = data as AgentRow;
  const res = await agentFromRow(row);
  return { row, ...res };
}

/**
 * Resolve an incoming write (markdown string OR structured body) to a canonical
 * v3 config. Throws ValidationError when the markdown/structured input is invalid.
 */
export function buildAgentConfigV3(
  body: Record<string, any>,
  existing?: AgentRow | null
): { config: AgentConfigV3; issues: MdIssue[]; md: string } {
  if (typeof body?.md === "string" && body.md.trim()) {
    const parsed = parseAgentMd(body.md);
    const hard = parsed.issues.filter((i) => i.severity === "error");
    if (!parsed.agent || hard.length) throw new ValidationError("markdown failed to parse", parsed.issues);
    const check = validateAgentV3(parsed.agent);
    if (!check.ok) throw new ValidationError("markdown validation failed", check.issues);
    const md = serializeAgentMd(check.config, body.md);
    return { config: check.config, issues: parsed.issues.filter((i) => i.severity === "warn"), md };
  }

  const prevMd = existing?.md_config || undefined;
  const phil = body.philosophy || body.persona?.philosophy || body.persona?.philosophy_and_mindset || existing?.persona?.philosophy_and_mindset || "";
  const rawSkills = Array.isArray(body.skills) ? body.skills : [];
  const config: AgentConfigV3 = {
    name: String(body.name ?? existing?.name ?? "Untitled Agent"),
    description: body.description,
    persona: { philosophy: String(phil) },
    configuration: {
      investment_horizon: String(body.configuration?.investment_horizon ?? existing?.configuration?.investment_horizon ?? ""),
      risk_appetite: clampInt(body.configuration?.risk_appetite || existing?.configuration?.risk_appetite, 1, 10, 5),
    },
    skills: rawSkills
      .map((s: any) =>
        typeof s === "string"
          ? { skill_id: String(s).toLowerCase().trim(), weight: 5 }
          : { skill_id: String(s?.skill_id || "").toLowerCase().trim(), weight: clampInt(s?.weight, 1, 10, 5) },
      )
      .filter((s: any) => s.skill_id),
  };
  const check = validateAgentV3(config);
  if (!check.ok) throw new ValidationError("agent validation failed", check.issues);
  const md = serializeAgentMd(check.config, prevMd);
  return { config: check.config, issues: [], md };
}

export { isV2Config };
