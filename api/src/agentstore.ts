/**
 * agentstore — normalize agent rows (DB / body / markdown) to the canonical
 * AgentConfig shape the pipeline and routes consume. Markdown is the source of
 * truth when present; the legacy JSONB columns are the fallback during the
 * migration window.
 */

import { parseMd, serializeMd, type AgentConfig, type EvaluationSection, type MdIssue } from "./mdconfig.js";
import { agentSchema, zodIssues } from "./agentSchema.js";
import { normalizeQuantRules } from "./metrics.js";
import { getDb } from "./db.js";

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

function toSection(ev: any): EvaluationSection {
  if (!ev || typeof ev !== "object") return { qualitative: [], quantitative: [] };
  const normalized = normalizeQuantRules(Array.isArray(ev.quantitative) ? ev.quantitative : []);
  return {
    qualitative: (Array.isArray(ev.qualitative) ? ev.qualitative : [])
      .filter((q: any) => q?.parameter?.trim())
      .map((q: any) => ({ ...q, weightage: clampInt(q.weightage, 1, 10, 5) })),
    quantitative: normalized
      .filter((r: any) => r.metric?.trim())
      .map((r: any) => ({ ...r, weightage: clampInt(r.weightage, 1, 10, 5) })),
  };
}

/** Rich issues from an agent config (zod shape validation). */
export function validateConfig(config: AgentConfig): { ok: true; config: AgentConfig; issues: MdIssue[] } | { ok: false; config: null; issues: MdIssue[] } {
  const r = agentSchema.safeParse(config);
  if (r.success) return { ok: true, config: r.data, issues: [] };
  return { ok: false, config: null, issues: zodIssues(r as any) };
}

/**
 * Resolve an incoming write (markdown string OR structured body) to a canonical
 * config. Throws ValidationError when the markdown/structured input is invalid.
 */
export function buildAgentConfig(
  body: Record<string, any>,
  existing?: AgentRow | null
): { config: AgentConfig; issues: MdIssue[]; md: string } {
  if (typeof body?.md === "string" && body.md.trim()) {
    const { agent, issues } = parseMd(body.md);
    const hard = issues.filter((i) => i.severity === "error");
    if (!agent || hard.length) throw new ValidationError("markdown failed to parse", issues);
    const check = validateConfig(agent);
    if (!check.ok) throw new ValidationError("markdown validation failed", check.issues.concat(issues));
    const md = serializeMd(check.config, body.md);
    return { config: check.config, issues: issues.filter((i) => i.severity === "warn"), md };
  }

  const prevMd = existing?.md_config || undefined;
  const phil =
    body.philosophy || body.persona?.philosophy_and_mindset || existing?.persona?.philosophy_and_mindset || "";
  const config: AgentConfig = {
    name: String(body.name ?? existing?.name ?? "Untitled Agent"),
    description: body.description,
    persona: { philosophy_and_mindset: String(phil) },
    configuration: {
      investment_horizon: String(body.configuration?.investment_horizon ?? existing?.configuration?.investment_horizon ?? ""),
      risk_appetite: clampInt(body.configuration?.risk_appetite || existing?.configuration?.risk_appetite, 1, 10, 5),
    },
    asset_evaluation: toSection(body.asset_evaluation ?? existing?.asset_evaluation),
    macro_evaluation: toSection(body.macro_evaluation ?? existing?.macro_evaluation),
  };
  const check = validateConfig(config);
  if (!check.ok) throw new ValidationError("agent validation failed", check.issues);
  const md = serializeMd(check.config, prevMd);
  return { config: check.config, issues: [], md };
}

/** Parse an agent row (markdown-first, legacy JSONB fallback). */
export function agentFromRow(row: AgentRow): { config: AgentConfig | null; issues: MdIssue[]; md: string } {
  if (row.md_config?.trim()) {
    const { agent, issues } = parseMd(row.md_config);
    if (agent) return { config: agent, issues, md: row.md_config };
    return { config: null, issues, md: row.md_config };
  }    try {
      const config: AgentConfig = {
        name: row.name,
        description: (row.description as string | undefined) ?? undefined,
      persona: { philosophy_and_mindset: row.persona?.philosophy_and_mindset || "" },
      configuration: {
        investment_horizon: row.configuration?.investment_horizon || "",
        risk_appetite: row.configuration?.risk_appetite ?? 5,
      },
      asset_evaluation: toSection(row.asset_evaluation),
      macro_evaluation: toSection(row.macro_evaluation),
    };
    return { config, issues: [], md: serializeMd(config) };
  } catch (e: any) {
    return { config: null, issues: [{ line: 0, message: e.message, severity: "error" }], md: "" };
  }
}

export interface LoadedAgent {
  row: AgentRow;
  config: AgentConfig | null;
  issues: MdIssue[];
  md: string;
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
  return { row, ...agentFromRow(row) };
}