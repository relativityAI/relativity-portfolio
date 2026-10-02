/**
 * Skill markdown grammar + parser — Agent Skills spec (agentskills.io).
 *
 * On disk a skill is a directory holding SKILL.md:
 *   skills/dcf-valuation/SKILL.md
 *
 * Grammar:
 *   ---                            YAML frontmatter
 *   name: dcf-valuation            required, lowercase kebab, == directory name
 *   description: ...               required, non-empty, <=1024
 *   license: ...                   optional
 *   compatibility: ...             optional, <=500
 *   allowed-tools: web_search x    optional, space-separated tool allowlist
 *   metadata:                      optional nested map of extra keys
 *     title: DCF Valuation
 *     category: valuation
 *     version: "1"
 *   ---                            YAML-ish conventions: flat `key: value`
 *   ## Purpose                    prose: what this skill investigates and why
 *   ## Data                       "- tool_name" bullets (fallback for allowed-tools)
 *   ## Method                     numbered analysis steps
 *   ## Verdict Anchors            "- anchor text — weight N" (optional; default 5)
 *   ## Charts                     "- type: line | title: ... | data: ..." (optional)
 *   ## Output Template            free prose appended to the analyst prompt
 *   ## anything else              opaque — preserved verbatim
 *
 * Body layout is free-form per spec; our sections are a convention on top.
 *
 * Legacy files (pre-spec `id:` + title-case `name:`) are still accepted on read
 * so existing rows in the `skills` table don't break; everything we *write* is
 * spec-shaped.
 *
 * Parsing is pure and sub-millisecond; validation is zod at the boundary.
 */

import { z } from "zod";
import type { ChartSpec, ChartType, SkillCategory, SkillDefinition, VerdictAnchor } from "./types.js";

export const SKILL_CATEGORIES: SkillCategory[] = [
  "valuation",
  "fundamentals",
  "qualitative",
  "market",
  "macro",
  "custom",
];

export const CHART_TYPES: ChartType[] = ["line", "bar", "candlestick", "table"];

/** Official spec name rule: 1-64 chars, a-z0-9 and hyphens, no leading/trailing/double hyphen. */
export const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const SPEC_NAME_ERR =
  "name must be 1-64 chars of lowercase letters, digits and single hyphens (no leading, trailing or doubled hyphen)";

/** Slugify a human title into a spec-valid name. */
export function slugifySkillName(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 64)
    .replace(/-$/, "");
  return s || "custom-skill";
}

export interface SkillIssue {
  line: number;
  message: string;
  severity: "error" | "warn";
}

export interface SkillParseResult {
  skill: SkillDefinition | null;
  issues: SkillIssue[];
  opaque: { heading: string; text: string }[];
  extraFrontmatter: [string, string][];
}

export const skillFrontmatterSchema = z.object({
  /** Official spec `name`: the slug, matching the directory. */
  name: z.string().min(1).regex(SPEC_NAME_RE, SPEC_NAME_ERR),
  description: z.string().min(1, "description is required").max(1024, "description must be 1024 characters or fewer"),
  license: z.string().optional(),
  compatibility: z.string().max(500, "compatibility must be 500 characters or fewer").optional(),
  /** Space-separated per spec. */
  "allowed-tools": z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

/**
 * YAML-ish frontmatter reader: flat `key: value` plus one level of nesting so
 * the spec's `metadata:` block parses. Deeper nesting is flattened to "a.b".
 */
function parseFrontmatter(src: string): {
  entries: [string, string][];
  meta: Record<string, string>;
  endLine: number;
} {
  const lines = src.split("\n");
  if (lines[0]?.trim() !== "---") return { entries: [], meta: {}, endLine: 0 };
  const entries: [string, string][] = [];
  const meta: Record<string, string> = {};
  let key: string | null = null;
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const m = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, indent, rawKey, rawVal] = m;
    const val = rawVal.trim();
    if (indent.length > 0 && key) {
      // Nested line — belongs to the previous top-level key.
      if (val) meta[`${key}.${rawKey.toLowerCase()}`] = stripQuotes(val);
      continue;
    }
    key = rawKey.toLowerCase();
    if (val) entries.push([key, stripQuotes(val)]);
  }
  return { entries, meta, endLine: i };
}

function stripQuotes(v: string): string {
  return v.replace(/^["']|["']$/g, "").trim();
}

export function parseSkillMarkdown(src: string, source: "builtin" | "custom" = "custom"): SkillParseResult {
  const issues: SkillIssue[] = [];
  const lines = src.split("\n");

  const { entries, meta, endLine: fmEnd } = parseFrontmatter(src);
  const known = new Set(["name", "id", "description", "license", "compatibility", "allowed-tools", "metadata"]);
  const extraFrontmatter = entries.filter(([k]) => !known.has(k));

  const fm: Record<string, string> = {};
  for (const [k, v] of entries) fm[k] = v;

  // Spec: `name` is the slug. Legacy: `id` held the slug and `name` a title.
  // Presence of `id` is the legacy marker — those files always had both keys.
  const legacy = !!fm.id;
  const slug = legacy ? fm.id || "" : fm.name || "";
  const title = legacy ? fm.name || "" : meta["metadata.title"] || "";
  const description = fm.description || "";
  const category = (meta["metadata.category"] || fm.category || "") as SkillCategory;
  const version = Number(meta["metadata.version"] || fm.version || "1");

  if (!slug) issues.push({ line: 0, message: "frontmatter name is required", severity: "error" });
  else if (!SPEC_NAME_RE.test(slug))
    issues.push({ line: 0, message: SPEC_NAME_ERR, severity: "error" });
  if (legacy) {
    issues.push({
      line: 0,
      message: "legacy frontmatter (`id:` + title-case `name:`) — rewrite as spec `name:` + `metadata.title:`",
      severity: "warn",
    });
  } else if (!title) {
    issues.push({ line: 0, message: "metadata.title is recommended for display", severity: "warn" });
  }
  if (!description) issues.push({ line: 0, message: "frontmatter description is required", severity: "error" });
  else if (description.length > 1024)
    issues.push({ line: 0, message: "description must be 1024 characters or fewer", severity: "error" });
  if (!SKILL_CATEGORIES.includes(category)) {
    issues.push({
      line: 0,
      message: `category must be one of: ${SKILL_CATEGORIES.join(", ")}`,
      severity: "error",
    });
  }
  if (!Number.isFinite(version) || version < 1) {
    issues.push({ line: 0, message: "version must be a positive integer", severity: "error" });
  }
  const compat = fm.compatibility || "";
  if (compat.length > 500)
    issues.push({ line: 0, message: "compatibility must be 500 characters or fewer", severity: "error" });

  // Body sections: split on "## <Heading>" (level-2 exactly).
  const sections: { heading: string; text: string; line: number }[] = [];
  let current: { heading: string; text: string[]; line: number } | null = null;
  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current) sections.push({ heading: current.heading, text: current.text.join("\n"), line: current.line });
      current = { heading: h[1].trim(), text: [], line: i + 1 };
    } else if (current) {
      current.text.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, text: current.text.join("\n"), line: current.line });

  const getSection = (label: string) =>
    sections.find((s) => s.heading.toLowerCase() === label.toLowerCase());

  const purposeSection = getSection("Purpose");
  if (!purposeSection?.text.trim()) {
    issues.push({ line: 0, message: "## Purpose section is required", severity: "error" });
  }

  // Tools: spec `allowed-tools` (space-separated) wins; `## Data` is the fallback.
  const dataSection = getSection("Data");
  const data: string[] = [];
  if (fm["allowed-tools"]) {
    for (const t of fm["allowed-tools"].split(/[\s,]+/)) {
      const clean = t.replace(/[()]/g, "").trim().toLowerCase();
      if (clean) data.push(clean);
    }
  }
  if (dataSection?.text.trim()) {
    for (const raw of dataSection.text.split("\n")) {
      const m = raw.match(/^\s*[-*]\s+`?([a-z0-9_]+)`?\s*$/i);
      if (m) {
        const tool = m[1].toLowerCase();
        if (!data.includes(tool)) data.push(tool);
      } else if (raw.trim().startsWith("-") || raw.trim().startsWith("*")) {
        issues.push({
          line: 0,
          message: `Data entries must be bare tool names like \`- web_search\` (got: "${raw.trim().slice(0, 60)}")`,
          severity: "warn",
        });
      }
    }
  }

  // Method: numbered steps (also accept bullets).
  const methodSection = getSection("Method");
  const method: string[] = [];
  if (methodSection?.text.trim()) {
    for (const raw of methodSection.text.split("\n")) {
      const m = raw.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)$/);
      if (m && m[1].trim()) method.push(m[1].trim());
    }
  } else {
    issues.push({ line: 0, message: "## Method section is required", severity: "error" });
  }

  // Verdict anchors: "- anchor text — weight N" (weight optional, default 5).
  const anchorSection = getSection("Verdict Anchors");
  const anchors: VerdictAnchor[] = [];
  if (anchorSection?.text.trim()) {
    for (const raw of anchorSection.text.split("\n")) {
      const m = raw.match(/^\s*[-*]\s+(.+)$/);
      if (!m) continue;
      let text = m[1].trim();
      let weight = 5;
      const w = text.match(/[—–-]\s*weight\s+(\d+)\s*$/i) || text.match(/,\s*weight\s+(\d+)\s*$/i);
      if (w) {
        const n = parseInt(w[1], 10);
        if (n >= 1 && n <= 10) weight = n;
        else issues.push({ line: 0, message: `anchor weight must be 1-10 (got ${n})`, severity: "warn" });
        text = text.slice(0, w.index).trim().replace(/[—–-]\s*$/, "").trim();
      }
      if (text) anchors.push({ label: text, weight });
    }
  }

  // Charts: "- type: line | title: ... | data: ..." (pipe-separated k:v pairs).
  const chartSection = getSection("Charts");
  const charts: ChartSpec[] = [];
  if (chartSection?.text.trim()) {
    for (const raw of chartSection.text.split("\n")) {
      const m = raw.match(/^\s*[-*]\s+(.+)$/);
      if (!m) continue;
      const parts = m[1].split("|").map((p) => p.trim());
      const kv: Record<string, string> = {};
      for (const p of parts) {
        const c = p.indexOf(":");
        if (c > 0) kv[p.slice(0, c).trim().toLowerCase()] = p.slice(c + 1).trim();
      }
      const type = (kv.type || "").toLowerCase() as ChartType;
      if (!CHART_TYPES.includes(type)) {
        issues.push({ line: 0, message: `chart type must be one of: ${CHART_TYPES.join(", ")}`, severity: "warn" });
        continue;
      }
      if (!kv.title || !kv.data) {
        issues.push({ line: 0, message: "chart spec needs both `title:` and `data:`", severity: "warn" });
        continue;
      }
      charts.push({ type, title: kv.title, data: kv.data, note: kv.note });
    }
  }

  const outputTemplate = getSection("Output Template")?.text.trim() || undefined;

  // Opaque: any section we don't recognize is preserved verbatim.
  const knownSections = new Set(["purpose", "data", "method", "verdict anchors", "charts", "output template"]);
  const opaque = sections
    .filter((s) => !knownSections.has(s.heading.toLowerCase()))
    .map((s) => ({ heading: s.heading, text: s.text }));

  if (issues.some((i) => i.severity === "error")) {
    return { skill: null, issues, opaque, extraFrontmatter };
  }

  return {
    skill: {
      id: slug,
      // Display title: metadata.title, else derived from the slug.
      name: title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description,
      category,
      version,
      purpose: purposeSection?.text.trim() || "",
      data,
      method,
      anchors: anchors.length ? anchors : undefined,
      charts: charts.length ? charts : undefined,
      outputTemplate,
      source,
      markdown: src,
    },
    issues,
    opaque,
    extraFrontmatter,
  };
}

/** Serialize a skill definition back to markdown, Agent Skills spec shape. */
export function serializeSkill(skill: SkillDefinition): string {
  const slug = SPEC_NAME_RE.test(skill.id) ? skill.id : slugifySkillName(skill.id);
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${slug}`);
  lines.push(`description: ${oneLine(skill.description)}`);
  if (skill.data.length) lines.push(`allowed-tools: ${skill.data.join(" ")}`);
  lines.push("metadata:");
  lines.push(`  title: ${yamlScalar(skill.name)}`);
  lines.push(`  category: ${skill.category}`);
  lines.push(`  version: "${skill.version}"`);
  lines.push("---");
  lines.push("");
  lines.push("## Purpose");
  lines.push(skill.purpose);
  lines.push("");
  lines.push("## Method");
  lines.push(skill.method.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  lines.push("");
  if (skill.anchors?.length) {
    lines.push("## Verdict Anchors");
    lines.push(skill.anchors.map((a) => `- ${a.label} — weight ${a.weight}`).join("\n"));
    lines.push("");
  }
  if (skill.charts?.length) {
    lines.push("## Charts");
    lines.push(
      skill.charts.map((c) => `- type: ${c.type} | title: ${c.title} | data: ${c.data}${c.note ? ` | note: ${c.note}` : ""}`).join("\n"),
    );
    lines.push("");
  }
  if (skill.outputTemplate) {
    lines.push("## Output Template");
    lines.push(skill.outputTemplate);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Rewrite a non-spec frontmatter `name:` to a valid slug, moving the original
 * text to `metadata.title` if no title is set. Returns the source unchanged when
 * the name is already valid. Used to repair LLM-authored drafts in place.
 */
export function repairSkillName(src: string): string {
  const m = src.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return src;
  const [, open, block, close] = m;
  const nameMatch = block.match(/^name:[ \t]*(.+)$/m);
  if (!nameMatch) return src;
  const raw = stripQuotes(nameMatch[1].trim());
  if (SPEC_NAME_RE.test(raw)) return src;
  const slug = slugifySkillName(raw);
  const hasTitle = /^metadata:[ \t]*$[\s\S]*?^[ \t]+title:/m.test(block);
  const lines = block.split(/\r?\n/).map((l) => (l === nameMatch[0] ? `name: ${slug}` : l));
  // Pull legacy top-level category/version under metadata so they survive.
  const MOVED = ["category", "version"];
  const moved = new Set<string>();
  for (const l of lines) {
    const m = l.match(/^(category|version):[ \t]*(.+)$/);
    if (m) moved.add(m[1]);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!moved.size) break;
    const m = lines[i].match(/^(category|version):[ \t]*(.+)$/);
    if (m) lines.splice(i, 1);
  }
  const insert: string[] = [];
  // Put the human text where the UI reads it.
  if (!hasTitle) insert.push(`  title: ${yamlScalar(raw)}`);
  for (const key of MOVED) {
    const m = block.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
    if (m) insert.push(key === "version" ? `  version: "${m[1].trim()}"` : `  ${key}: ${m[1].trim()}`);
  }
  if (insert.length) {
    const idx = lines.findIndex((l) => /^metadata:/i.test(l));
    if (idx >= 0) lines.splice(idx + 1, 0, ...insert);
    else lines.push("metadata:", ...insert);
  }
  // Splice, don't replace — everything after the frontmatter must survive.
  return open + lines.join("\n") + close + src.slice(m[0].length);
}

/** Keep a description on one line — YAML frontmatter can't span lines here. */
function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}

/** Quote a scalar only when it would otherwise misparse. */
function yamlScalar(s: string): string {
  const v = oneLine(s);
  return /^[\w][\w &+./'-]*$/.test(v) ? v : `"${v.replace(/"/g, '\\"')}"`;
}

/** Frontmatter-only peek for listing without a full parse. */
export function peekSkillMeta(src: string): { id: string; name: string; description: string; category: string } | null {
  const { entries, meta } = parseFrontmatter(src);
  const fm: Record<string, string> = {};
  for (const [k, v] of entries) fm[k] = v;
  const slug = fm.name || fm.id || "";
  if (!slug) return null;
  const title = meta["metadata.title"] || (fm.id ? fm.name : "");
  return {
    id: slug,
    name: title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: fm.description || "",
    category: meta["metadata.category"] || fm.category || "custom",
  };
}
