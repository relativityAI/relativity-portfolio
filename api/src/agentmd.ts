/**
 * agentmd v3 — markdown persistence for skill-based agents.
 *
 * An agent is metadata + investment philosophy + a list of skills. The
 * qualitative/quantitative evaluation sections of the v2 grammar are gone;
 * the v2 parser (./mdconfig.ts) survives only to power one-time migration.
 *
 * Grammar:
 *   ---                           YAML-ish frontmatter (flat key: value).
 *   name: Warren Buffett          Unknown keys carry through verbatim.
 *   description: ...
 *   ---
 *   ## Philosophy                 persona.philosophy (prose)
 *   ## Skills                     "- skill_id — weight N" bullets (weight 1-10)
 *   ## anything else              opaque — preserved verbatim
 *
 * `investment_horizon` / `risk_appetite` were removed from the schema; old
 * files carrying them parse fine and the keys are dropped on the next save.
 */

import { z } from "zod";
import type { MdIssue } from "./mdconfig.js";

export interface AgentSkillRef {
  skill_id: string;
  weight: number;
}

export interface AgentConfigV3 {
  name: string;
  description?: string;
  persona: { philosophy: string };
  /** Ordered skill list — order is preserved in prompts and the report. */
  skills: AgentSkillRef[];
}

export interface AgentMdResult {
  agent: AgentConfigV3 | null;
  issues: MdIssue[];
  /** Unknown ## sections, preserved verbatim on write. */
  opaque: { heading: string; text: string; order: number }[];
  /** Unknown frontmatter keys in file order — carried back on serialize. */
  extraFrontmatter: [string, string][];
}

export const agentSkillRefSchema = z.object({
  skill_id: z
    .string()
    .min(1, "skill_id is required")
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "skill_id must be a slug"),
  weight: z.number().int().min(1).max(10).default(5),
});

export const agentSchemaV3 = z.object({
  name: z.string().min(1, "agent name is required"),
  description: z.string().optional(),
  persona: z.object({ philosophy: z.string().default("") }).default({ philosophy: "" }),
  skills: z.array(agentSkillRefSchema).default([]),
});

export type AgentConfigV3Schema = z.infer<typeof agentSchemaV3>;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function parseAgentMd(raw: string): AgentMdResult {
  const issues: MdIssue[] = [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  if (!lines.length || lines[0].trim() !== "---") {
    issues.push({ line: 1, message: "missing YAML frontmatter (file must start with ---)", severity: "error" });
    return { agent: null, issues, opaque: [], extraFrontmatter: [] };
  }

  const fm: Record<string, string> = {};
  const fmOrder: string[] = [];
  let fmEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      fmEnd = i;
      break;
    }
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) {
      if (m[1] in fm) issues.push({ line: i + 1, message: `duplicate frontmatter key "${m[1]}"`, severity: "warn" });
      else fmOrder.push(m[1]);
      fm[m[1]] = m[2].trim();
    } else if (lines[i].trim() !== "") {
      issues.push({ line: i + 1, message: `unparseable frontmatter line: "${lines[i].trim()}"`, severity: "warn" });
    }
  }
  if (fmEnd < 0) {
    issues.push({ line: 1, message: "unterminated YAML frontmatter (missing closing ---)", severity: "error" });
    return { agent: null, issues, opaque: [], extraFrontmatter: [] };
  }

  // `source`, `investment_horizon`, `risk_appetite` are legacy keys —
  // tolerated silently and dropped on the next serialize.
  const KNOWN_FM = new Set(["name", "source", "description", "investment_horizon", "risk_appetite"]);
  const extraFrontmatter = fmOrder.filter((k) => !KNOWN_FM.has(k)).map((k) => [k, fm[k]] as [string, string]);

  const agent: AgentConfigV3 = {
    name: fm.name ?? "",
    description: fm.description || undefined,
    persona: { philosophy: "" },
    skills: [],
  };
  if (!agent.name.trim()) issues.push({ line: 1, message: 'frontmatter is missing required key "name"', severity: "error" });

  type Ctx = { section: "philosophy" | "skills" | null };
  const ctx: Ctx = { section: null };
  const opaque: { heading: string; text: string; order: number }[] = [];
  let opaqueHead = "";
  const opaqueBuf: string[] = [];
  const flushOpaque = () => {
    if (opaqueHead) opaque.push({ heading: opaqueHead, text: opaqueBuf.join("\n").trim(), order: opaque.length });
    opaqueHead = "";
    opaqueBuf.length = 0;
  };

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,2}\s+\S/.test(line)) {
      const sec = norm(line.replace(/^#{1,2}\s+/, ""));
      const hit = sec === "philosophy" || sec === "investment philosophy" ? "philosophy" : sec === "skills" ? "skills" : null;
      if (hit) {
        ctx.section = hit;
        flushOpaque();
      } else {
        ctx.section = null;
        flushOpaque();
        opaqueHead = line;
      }
      continue;
    }

    if (ctx.section === "skills") {
      const m = line.match(/^\s*[-*]\s+(.+)$/);
      if (m) {
        let ref = m[1].trim();
        let weight = 5;
        const w = ref.match(/[—–-]\s*weight\s*:?(\d{1,2})\s*$/i);
        if (w) {
          const n = parseInt(w[1], 10);
          if (n >= 1 && n <= 10) weight = n;
          else issues.push({ line: i + 1, message: `skill weight must be 1-10, got ${n}`, severity: "warn" });
          ref = ref.slice(0, w.index).trim().replace(/[—–-]\s*$/, "").trim();
        }
        const slug = ref.replace(/^`|`$/g, "").trim().toLowerCase().replace(/\s+/g, "-");
        if (slug) agent.skills.push({ skill_id: slug, weight });
      }
      // stray prose inside ## Skills is ignored
    } else if (ctx.section === "philosophy") {
      if (line.trim())
        agent.persona.philosophy = agent.persona.philosophy ? `${agent.persona.philosophy}\n${line}` : line;
    } else if (ctx.section === null || opaqueHead) {
      opaqueBuf.push(line);
    }
  }
  flushOpaque();

  agent.persona.philosophy = agent.persona.philosophy.trim();
  return { agent, issues, opaque, extraFrontmatter };
}

/**
 * Repair an agent document so it parses. Conservative: no body line moves;
 * only the frontmatter is rebuilt (a missing opener/closer, or an absent
 * `name`). Returns null when nothing changed.
 */
export function fixAgentMarkdown(raw: string): string | null {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const fm: [string, string][] = [];
  const body: string[] = [];

  const parseKv = (line: string): [string, string] | null => {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    return m ? [m[1], m[2].trim()] : null;
  };

  if (lines[0]?.trim() !== "---") {
    body.push(...lines);
  } else {
    let i = 1;
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === "---") { i++; break; }
      const kv = parseKv(lines[i]);
      if (kv) fm.push(kv);
      else if (t) break; // content with no closing delimiter ends the block
    }
    body.push(...lines.slice(i));
  }

  if (!fm.some(([k]) => k === "name")) fm.unshift(["name", "Untitled agent"]);

  const out = `---\n${fm.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body.join("\n").replace(/^\n+/, "").trimEnd()}\n`;
  return out.trim() === raw.trim() ? null : out.trimEnd();
}

/** Serialize an agent config to markdown; opaque sections survive round-trips. */
export function serializeAgentMd(agent: AgentConfigV3, prevMd?: string): string {
  const prev = prevMd ? parseAgentMd(prevMd) : { opaque: [], extraFrontmatter: [] };
  const L: string[] = [];

  L.push("---");
  L.push(`name: ${agent.name}`);
  L.push(`description: ${agent.description || ""}`);
  for (const [k, v] of prev.extraFrontmatter) L.push(`${k}: ${v}`);
  L.push("---", "");

  L.push("## Philosophy", "", agent.persona.philosophy || "(no philosophy written)", "");

  L.push("## Skills", "");
  if (agent.skills.length) {
    for (const s of agent.skills) L.push(`- ${s.skill_id} — weight ${s.weight}`);
  } else {
    L.push("(no skills attached)");
  }
  L.push("");

  for (const o of prev.opaque) {
    L.push(o.heading, "", o.text, "");
  }
  return L.join("\n");
}

/** Rich zod validation for a v3 config. */
export function validateAgentV3(config: AgentConfigV3): { ok: true; config: AgentConfigV3 } | { ok: false; issues: MdIssue[] } {
  const r = agentSchemaV3.safeParse(config);
  if (r.success) return { ok: true, config: r.data as AgentConfigV3 };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ line: 0, message: `"${i.path.join(".")}": ${i.message}`, severity: "error" as const })),
  };
}
