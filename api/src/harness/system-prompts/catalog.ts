/**
 * System prompts — drop-in markdown presentation specs, selectable per run.
 *
 * A system prompt is a free-form markdown document describing how a finished
 * analysis should be presented: structure, vocabulary, tone, workflow, which
 * primitives to reach for. It is separate from skills (tool mechanics) and
 * from the agent's analysis (soul prompt). Optional YAML frontmatter adds
 * machine-enforceable rules; everything else is prose the model reads.
 *
 * Storage: `api/src/harness/config/prompts/*.md`, one file per named system
 * prompt, mapped by key in config/agent.yaml `prompts:` (edit the file or the
 * config, the next run picks it up). Each file's YAML frontmatter is the
 * machine-enforceable rules; its prose is the agent's system instructions.
 * Report structure is NOT defined here — the active skill's report-structure
 * owns it.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { promptDocPath, promptNames } from "../config.js";
import { countCharts, sectionHeadings, type ReportDocument } from "../report/document.js";

export interface SystemPrompt {
  id: string;
  name: string;
  description: string;
  /** The prompt body (markdown). */
  body: string;
  default?: boolean;
  /** Frontmatter enforcement rules (all optional). */
  required_sections?: string[];
  min_charts?: number;
  section_order?: string[];
  require_sources?: boolean;
  /** Banned words the prompt's vocabulary forbids (never substitute). */
  never_substitute?: string[];
  allowed_primitives?: string[];
}

const DEFAULT_ID = "default";
/** agent.yaml's default system prompt role — its file is the default choice. */
const DEFAULT_ROLE = "agents";

function titleFrom(id: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePrompt(id: string, raw: string): SystemPrompt {
  let frontmatter: Record<string, any> = {};
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    frontmatter = (parseYaml(m[1]) as Record<string, any>) ?? {};
    body = raw.slice(m[0].length);
  }
  return {
    id,
    name: String(frontmatter.name || titleFrom(id, raw)),
    description: String(frontmatter.description || ""),
    body: body.trim(),
    default: frontmatter.default === true || id === DEFAULT_ID,
    required_sections: Array.isArray(frontmatter.required_sections) ? frontmatter.required_sections.map(String) : undefined,
    min_charts: Number.isFinite(frontmatter.min_charts) ? Number(frontmatter.min_charts) : undefined,
    section_order: Array.isArray(frontmatter.section_order) ? frontmatter.section_order.map(String) : undefined,
    require_sources: frontmatter.require_sources === true,
    never_substitute: Array.isArray(frontmatter.never_substitute) ? frontmatter.never_substitute.map(String) : undefined,
    allowed_primitives: Array.isArray(frontmatter.allowed_primitives) ? frontmatter.allowed_primitives.map(String) : undefined,
  };
}

/**
 * Every named system prompt (agent.yaml prompts.* minus the compaction role):
 * id = the config key, so a name picked in the CLI/UI resolves back to its
 * file. Empty = none configured (run stays unformatted). Re-read per call so
 * an edit is live without a restart.
 */
export function loadSystemPrompts(dir?: string): SystemPrompt[] {
  const out: SystemPrompt[] = [];
  for (const name of promptNames(dir)) {
    const path = promptDocPath(name, dir);
    if (!path) continue;
    try {
      const tpl = parsePrompt(name, readFileSync(path, "utf8"));
      out.push({ ...tpl, default: tpl.default || name === DEFAULT_ROLE });
    } catch {
      // unreadable prompt file = skipped; the run falls back to the default
    }
  }
  return out;
}

/** The prompt chosen by name; absent/unknown id → the default (`agents`). */
export function getSystemPrompt(id?: string, dir?: string): SystemPrompt | null {
  const all = loadSystemPrompts(dir);
  return (id ? all.find((t) => t.id === id) : null) ?? all.find((t) => t.default) ?? all[0] ?? null;
}

/** `{{name}}` placeholders → run values (symbol, title, date, source, agent). */
export function applyVariables(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => vars[key.toLowerCase()] ?? whole);
}

/**
 * Validate a built document against the prompt's frontmatter rules. Returns
 * human-readable violations; the run surfaces them in `report.errors`.
 */
export function validateAgainstSystemPrompt(doc: ReportDocument, tpl: SystemPrompt | null): string[] {
  if (!tpl) return [];
  const errors: string[] = [];
  const headings = sectionHeadings(doc);
  const body = doc.sections
    .flatMap((s) => [s.heading.text, ...s.blocks.map((b) => ("text" in b ? String(b.text) : "title" in b && b.title ? String(b.title) : ""))])
    .join("\n")
    .toLowerCase();

  if (tpl.min_charts != null && countCharts(doc) < tpl.min_charts) {
    errors.push(`system prompt "${tpl.id}" wants at least ${tpl.min_charts} chart(s); document has ${countCharts(doc)}`);
  }
  for (const want of tpl.required_sections ?? []) {
    if (!headings.some((h) => h.includes(want.toLowerCase()))) {
      errors.push(`system prompt "${tpl.id}" requires a "${want}" section`);
    }
  }
  if (tpl.section_order?.length) {
    const positions = tpl.section_order.map((want) => headings.findIndex((h) => h.includes(want.toLowerCase())));
    const seen = positions.filter((p) => p >= 0);
    if (seen.length > 1 && seen.some((p, i) => i > 0 && p < seen[i - 1])) {
      errors.push(`system prompt "${tpl.id}" expects sections in order ${tpl.section_order.join(" → ")}`);
    }
  }
  if (tpl.require_sources && doc.sources.length === 0) {
    errors.push(`system prompt "${tpl.id}" requires at least one source`);
  }
  for (const banned of tpl.never_substitute ?? []) {
    const re = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(body)) errors.push(`system prompt "${tpl.id}" forbids the word "${banned}"`);
  }
  return errors;
}
