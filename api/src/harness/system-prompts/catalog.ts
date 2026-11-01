/**
 * System prompts — drop-in markdown presentation specs, selectable per run.
 *
 * A system prompt is a free-form markdown document describing how a finished
 * analysis should be presented: structure, vocabulary, tone, workflow, which
 * primitives to reach for. It is separate from skills (tool mechanics) and
 * from the agent's analysis (soul prompt). Optional YAML frontmatter adds
 * machine-enforceable rules; everything else is prose the model reads.
 *
 * Storage: ONE file — `api/src/harness/config/prompts/AGENTS.md`, its YAML
 * frontmatter being the machine-enforceable rules (edit the file, the next
 * run picks it up). The path comes from config/agent.yaml prompts.agents.
 * Report structure is NOT defined here — the active skill's report-structure
 * owns it.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { promptDocPath } from "../config.js";
import { countCharts, sectionHeadings, type ReportDocument } from "../report/document.js";

export interface OutputTemplate {
  id: string;
  name: string;
  description: string;
  /** The template body (markdown, already variable-substituted). */
  body: string;
  default?: boolean;
  /** Frontmatter enforcement rules (all optional). */
  required_sections?: string[];
  min_charts?: number;
  section_order?: string[];
  require_sources?: boolean;
  /** Banned words the template's vocabulary forbids (never substitute). */
  never_substitute?: string[];
  allowed_primitives?: string[];
}

const DEFAULT_ID = "default";
const FILE_ID = (file: string) => file.replace(/\.md$/i, "");

/**
 * The single format file = config/prompts/AGENTS.md (frontmatter = verify
 * rules, prose = the agent's system instructions). Path via agent.yaml
 * (memoized per process); the file itself is re-read per call so an edit is
 * live.
 */
let formatFile: string | null = null;
function reportFormatFile(): string {
  if (formatFile) return formatFile;
  formatFile = promptDocPath("agents") || join(dirname(fileURLToPath(import.meta.url)), "..", "config", "prompts", "AGENTS.md");
  return formatFile;
}

function titleFrom(id: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseTemplate(id: string, raw: string): OutputTemplate {
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

/** Read the one format file. Empty = none configured (run stays unformatted). */
export function loadOutputTemplates(file: string = reportFormatFile()): OutputTemplate[] {
  if (!existsSync(file)) return [];
  try {
    return [parseTemplate(FILE_ID(basename(file)), readFileSync(file, "utf8"))];
  } catch {
    return [];
  }
}

export function getOutputTemplate(_id?: string): OutputTemplate | null {
  // ponytail: ONE format (AGENTS.md) — the id is accepted for caller
  // compat (the API stores outputTemplateId) but ignored; restore id matching
  // when a second format file exists.
  return loadOutputTemplates()[0] ?? null;
}

/** `{{name}}` placeholders → run values (symbol, title, date, source, agent). */
export function applyVariables(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => vars[key.toLowerCase()] ?? whole);
}

/**
 * Validate a built document against a template's frontmatter rules. Returns
 * human-readable violations; the run surfaces them in `report.errors`.
 */
export function validateAgainstTemplate(doc: ReportDocument, tpl: OutputTemplate | null): string[] {
  if (!tpl) return [];
  const errors: string[] = [];
  const headings = sectionHeadings(doc);
  const body = doc.sections
    .flatMap((s) => [s.heading.text, ...s.blocks.map((b) => ("text" in b ? String(b.text) : "title" in b && b.title ? String(b.title) : ""))])
    .join("\n")
    .toLowerCase();

  if (tpl.min_charts != null && countCharts(doc) < tpl.min_charts) {
    errors.push(`template "${tpl.id}" wants at least ${tpl.min_charts} chart(s); document has ${countCharts(doc)}`);
  }
  for (const want of tpl.required_sections ?? []) {
    if (!headings.some((h) => h.includes(want.toLowerCase()))) {
      errors.push(`template "${tpl.id}" requires a "${want}" section`);
    }
  }
  if (tpl.section_order?.length) {
    const positions = tpl.section_order.map((want) => headings.findIndex((h) => h.includes(want.toLowerCase())));
    const seen = positions.filter((p) => p >= 0);
    if (seen.length > 1 && seen.some((p, i) => i > 0 && p < seen[i - 1])) {
      errors.push(`template "${tpl.id}" expects sections in order ${tpl.section_order.join(" → ")}`);
    }
  }
  if (tpl.require_sources && doc.sources.length === 0) {
    errors.push(`template "${tpl.id}" requires at least one source`);
  }
  for (const banned of tpl.never_substitute ?? []) {
    const re = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(body)) errors.push(`template "${tpl.id}" forbids the word "${banned}"`);
  }
  return errors;
}

export { DEFAULT_ID as DEFAULT_TEMPLATE_ID };
