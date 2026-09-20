/**
 * mdconfig — markdown persistence for agent settings.
 *
 * One markdown file per agent is the editing/storage artifact; the parsed
 * agent config object below is the runtime shape every consumer (pipeline,
 * builder, UI) already works with. Parsing is a pure sub-ms function run on
 * read. Unknown headings are preserved verbatim (never clobbered by a
 * structured-format save), so adding new sections needs no engine change.
 *
 * Grammar:
 *   ---                           YAML-ish frontmatter. Unknown keys carry
 *   name: Warren Buffett          through verbatim (kept in sync on write by
 *   source: NSE                   round-tripping the last md).
 *   description: ...
 *   investment_horizon: ...
 *   risk_appetite: 4
 *   ---
 *   ## Philosophy                 persona.philosophy_and_mindset (prose)
 *   ## Asset Evaluation           same section shape as Macro Evaluation
 *   ### Qualitative               #### <Name> — weight N  + prose body
 *   ### Quantitative              | Metric | Rule | Weight |
 *                                            Rule: "> 15%", "55 to 75", "= Yes"
 *   ## anything else              opaque — preserved verbatim in both directions
 */

import { findMetricId } from "./metrics.js";

export type Operator = "gt" | "gte" | "lt" | "lte" | "eq" | "between";
export type MetricType = "number" | "percentage" | "currency" | "date" | "text";

export interface QualitativeItem {
  parameter: string;
  content: string;
  weightage: number;
}

export interface QuantitativeItem {
  metric: string;
  metric_name: string;
  metric_type: MetricType;
  operator: Operator;
  value?: number | string;
  value_upper?: number | string;
  weightage: number;
}

export interface EvaluationSection {
  qualitative: QualitativeItem[];
  quantitative: QuantitativeItem[];
}

export interface AgentConfig {
  name: string;
  description?: string;
  persona: { philosophy_and_mindset: string };
  configuration: { investment_horizon: string; risk_appetite: number };
  asset_evaluation: EvaluationSection;
  macro_evaluation: EvaluationSection;
}

export interface MdIssue {
  line: number;
  message: string;
  severity: "error" | "warn";
}

export interface OpaqueBlock {
  heading: string;
  text: string;
  order: number;
}

export interface ParseResult {
  /** null when the file has a hard structural error. */
  agent: AgentConfig | null;
  issues: MdIssue[];
  opaque: OpaqueBlock[];
  /** Unknown frontmatter keys, in file order — carried back on serialize. */
  extraFrontmatter: [string, string][];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const OP_SYMBOL: Record<string, Operator> = {
  ">": "gt",
  ">=": "gte",
  "≥": "gte",
  "<": "lt",
  "<=": "lte",
  "≤": "lte",
  "=": "eq",
};

function parseValue(raw: string): { value: number | string; type: MetricType } {
  const s = raw.trim().replace(/,/g, "");
  if (/^[+-]?\d+(\.\d+)?%$/.test(s)) return { value: parseFloat(s), type: "percentage" };
  if (/^[₹$]/.test(s)) {
    const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? { value: n, type: "currency" } : { value: s, type: "text" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { value: s, type: "date" };
  if (/^[+-]?\d[\d.]*$/.test(s)) return { value: parseFloat(s), type: "number" };
  return { value: raw.trim(), type: "text" };
}

/** Parse a natural-language threshold like "> 15%", "55 to 75", "= Yes". */
export function parseRule(text: string): { operator: Operator; value: number | string; value_upper?: number | string; metric_type: MetricType } | null {
  const t = text.trim().replace(/^between\s+/i, "");
  if (!t) return null;

  const opMatch = t.match(/^(>=|<=|>|<|=|≥|≤)\s*([\s\S]*)$/);
  let operator: Operator | undefined = opMatch ? OP_SYMBOL[opMatch[1]] : undefined;
  let rest = (opMatch ? opMatch[2] : t).trim();
  if (!opMatch && text.trim().toLowerCase().startsWith("between")) operator = "between";

  const range =
    operator === "between" || operator === undefined
      ? rest.match(/^(.+?)\s+(?:to|and)\s+(.+?)$/) || rest.match(/^(.+?)\s+-\s+(.+?)$/)
      : null;
  if (range) {
    const a = parseValue(range[1]);
    const b = parseValue(range[2]);
    return {
      operator: "between",
      value: a.value,
      value_upper: b.value,
      metric_type: a.type === b.type ? a.type : "number",
    };
  }

  if (operator === "between") return null; // "between X" without a range
  if (!operator) return null;
  const v = parseValue(rest);
  return { operator, value: v.value, metric_type: v.type };
}

function parseWeightage(raw: string, line: number, issues: MdIssue[]): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    issues.push({ line, message: `weightage must be an integer 1-10, got "${raw}"`, severity: "error" });
  }
  return n;
}

function parseParamTitle(title: string, line: number, issues: MdIssue[]): QualitativeItem {
  const m = title.match(/^(.*?)\s*[—–-]\s*weight\s*:?\s*(\d{1,2})\s*$/i);
  if (!m) {
    issues.push({ line, message: `missing weight in parameter heading — use "#### <Name> — weight N"`, severity: "error" });
    return { parameter: title.trim(), content: "", weightage: 1 };
  }
  const w = parseWeightage(m[2], line, issues);
  return { parameter: m[1].trim(), content: "", weightage: w };
}

function parseTableRow(line: string, section: EvaluationSection, ln: number, issues: MdIssue[]): void {
  let cells: string[] = [];
  if (line.trim().startsWith("|")) {
    const parts = line.trim().split("|").map((c) => c.trim());
    cells = parts.slice(1, parts.length - 1);
  } else {
    cells = line.trim().split("|").map((c) => c.trim());
  }

  if (cells.length >= 1 && cells.every((c) => /^:?-{3,}:?$/.test(c))) return; // separator row
  if (cells.length === 3 && cells[0].toLowerCase() === "metric" && cells[1].toLowerCase() === "rule") return; // header row

  if (cells.length < 3) {
    issues.push({ line: ln, message: `quantitative row must have 3 columns (Metric | Rule | Weight), got: "${line.trim()}"`, severity: "error" });
    return;
  }

  const metricName = cells[0].trim();
  const rule = parseRule(cells[1]);
  if (!rule) {
    issues.push({ line: ln, message: `unparseable rule "${cells[1]}" — use e.g. "> 15%", "55 to 75", "= Yes"`, severity: "error" });
    return;
  }
  const weightage = parseWeightage(cells[2], ln, issues);
  const metric = findMetricId(metricName) || metricName;
  if (!findMetricId(metricName)) {
    issues.push({ line: ln, message: `unknown metric "${metricName}" — passes through to the LLM as-is`, severity: "warn" });
  }
  section.quantitative.push({ metric, metric_name: metricName, ...rule, weightage });
}

export function parseMd(raw: string): ParseResult {
  const issues: MdIssue[] = [];
  const opaque: OpaqueBlock[] = [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  if (!lines.length || lines[0].trim() !== "---") {
    issues.push({ line: 1, message: "missing YAML frontmatter (file must start with ---)", severity: "error" });
    return { agent: null, issues, opaque, extraFrontmatter: [] };
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
    return { agent: null, issues, opaque, extraFrontmatter: [] };
  }
  const KNOWN_FM = new Set(["name", "source", "description", "investment_horizon", "risk_appetite"]);
  // `source` in the frontmatter is a legacy key (agents used to carry a market).
  // Agents are market-independent now, so it's parsed, tolerated silently as
  // round-trip metadata, and dropped from the canonical config.
  const extraFrontmatter = fmOrder.filter((k) => !KNOWN_FM.has(k)).map((k) => [k, fm[k]] as [string, string]);

  const riskRaw = parseInt(fm.risk_appetite ?? "", 10);
  const agent: AgentConfig = {
    name: fm.name ?? "",
    description: fm.description || undefined,
    persona: { philosophy_and_mindset: fm.philosophy_and_mindset || "" },
    configuration: {
      investment_horizon: fm.investment_horizon || "",
      risk_appetite: Number.isInteger(riskRaw) ? riskRaw : 5,
    },
    asset_evaluation: { qualitative: [], quantitative: [] },
    macro_evaluation: { qualitative: [], quantitative: [] },
  };
  if (!agent.name.trim()) issues.push({ line: 1, message: "frontmatter is missing required key \"name\"", severity: "error" });

  type Ctx = { section: "philosophy" | "asset" | "macro" | null; sub: "qualitative" | "quantitative" | null; param: QualitativeItem | null };
  const ctx: Ctx = { section: null, sub: null, param: null };
  let opaqueHead = "";
  const opaqueBuf: string[] = [];
  const flushOpaque = () => {
    if (opaqueHead) opaque.push({ heading: opaqueHead, text: opaqueBuf.join("\n").trim(), order: opaque.length });
    opaqueHead = "";
    opaqueBuf.length = 0;
  };

  const evalOf = (): EvaluationSection => (ctx.section === "macro" ? agent.macro_evaluation : agent.asset_evaluation);

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,2}\s+\S/.test(line)) {
      const sec = norm(line.replace(/^#{1,2}\s+/, ""));
      const hit =
        sec === "philosophy" || sec === "investment philosophy"
          ? "philosophy"
          : sec === "asset evaluation"
            ? "asset"
            : sec === "macro evaluation"
              ? "macro"
              : null;
      ctx.param = null;
      if (hit) {
        ctx.section = hit;
        ctx.sub = null;
        flushOpaque();
      } else {
        ctx.section = null;
        ctx.sub = null;
        flushOpaque();
        opaqueHead = line;
      }
      continue;
    }
    if (/^###\s+\S/.test(line)) {
      const sub = norm(line.replace(/^###\s+/, ""));
      if ((ctx.section === "asset" || ctx.section === "macro") && (sub === "qualitative" || sub === "quantitative")) {
        ctx.sub = sub;
        ctx.param = null;
        flushOpaque();
      } else {
        flushOpaque();
        opaqueHead = line;
        ctx.param = null;
      }
      continue;
    }
    if (/^####\s+\S/.test(line)) {
      if (ctx.section && ctx.sub === "qualitative") {
        const p = parseParamTitle(line.replace(/^####\s+/, ""), i + 1, issues);
        evalOf().qualitative.push(p);
        ctx.param = p;
      } else {
        opaqueBuf.push(line);
      }
      continue;
    }

    if (ctx.param && ctx.sub === "qualitative") {
      if (line.trim()) ctx.param.content = ctx.param.content ? `${ctx.param.content}\n${line}` : line;
    } else if (ctx.sub === "quantitative" && line.trim()) {
      if (line.trim().startsWith("|") || line.includes("|")) parseTableRow(line, evalOf(), i + 1, issues);
      // stray prose between rows is ignored
    } else if (ctx.section === "philosophy" && ctx.sub === null) {
      if (line.trim())
        agent.persona.philosophy_and_mindset = agent.persona.philosophy_and_mindset ? `${agent.persona.philosophy_and_mindset}\n${line}` : line;
    } else if (ctx.section === null || opaqueHead) {
      opaqueBuf.push(line);
    }
  }
  flushOpaque();

  agent.persona.philosophy_and_mindset = agent.persona.philosophy_and_mindset.trim();
  return { agent, issues, opaque, extraFrontmatter };
}

function fmtValue(v: number | string, type: MetricType): string {
  if (type === "percentage" && typeof v === "number") return `${v}%`;
  if (type === "currency" && typeof v === "number") return `$${v}`;
  return `${v}`;
}

export function formatRule(c: QuantitativeItem): string {
  if (c.operator === "between" && c.value_upper != null) {
    return `${fmtValue(c.value!, c.metric_type)} to ${fmtValue(c.value_upper, c.metric_type)}`;
  }
  if (c.operator === "between") return `>= ${fmtValue(c.value ?? 0, c.metric_type)}`;
  const sym = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=" }[c.operator] ?? ">";
  return `${sym} ${fmtValue(c.value ?? 0, c.metric_type)}`;
}

function emitEval(lines: string[], heading: string, ev: EvaluationSection): void {
  if (!ev.qualitative.length && !ev.quantitative.length) return;
  lines.push(`## ${heading}`, "");
  if (ev.qualitative.length) {
    lines.push("### Qualitative", "");
    for (const q of ev.qualitative) {
      lines.push(`#### ${q.parameter} — weight ${q.weightage}`, "", q.content, "");
    }
  }
  if (ev.quantitative.length) {
    lines.push("### Quantitative", "", "| Metric | Rule | Weight |", "|---|---|---|");
    for (const c of ev.quantitative) {
      lines.push(`| ${c.metric_name || c.metric} | ${formatRule(c)} | ${c.weightage} |`);
    }
    lines.push("");
  }
}

/**
 * Serialize an agent config to markdown. Pass the previous raw md (if any) so
 * opaque/unknown sections hand-edited there survive the round-trip.
 */
export function serializeMd(agent: AgentConfig, prevMd?: string): string {
  const prev = prevMd ? parseMd(prevMd) : { opaque: [], extraFrontmatter: [] };
  const opaque = prev.opaque;
  const L: string[] = [];

  L.push("---");
  L.push(`name: ${agent.name}`);
  if (agent.description) L.push(`description: ${agent.description}`);
  L.push(`investment_horizon: ${agent.configuration.investment_horizon || ""}`);
  L.push(`risk_appetite: ${agent.configuration.risk_appetite ?? 5}`);
  for (const [k, v] of (prev as { extraFrontmatter: [string, string][] }).extraFrontmatter) L.push(`${k}: ${v}`);
  L.push("---");

  if (agent.persona.philosophy_and_mindset?.trim()) {
    L.push("", "## Philosophy", "", agent.persona.philosophy_and_mindset.trim(), "");
  }
  emitEval(L, "Asset Evaluation", agent.asset_evaluation);
  emitEval(L, "Macro Evaluation", agent.macro_evaluation);

  for (const block of [...opaque].sort((a, b) => a.order - b.order)) {
    L.push(block.heading);
    if (block.text) L.push("", block.text, "");
  }

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}