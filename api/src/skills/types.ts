/**
 * Skill types — the runtime shape of a loaded skill.
 *
 * A skill is a self-contained markdown document that individually defines
 * what data to fetch, how to analyze it, what to score (verdict anchors),
 * and what to plot (chart specs). See ./parse.ts for the grammar.
 */
import type { SkillArtifact } from "./artifacts/types.js";

export type SkillCategory =
  | "valuation"
  | "fundamentals"
  | "qualitative"
  | "market"
  | "macro"
  | "custom";

export interface VerdictAnchor {
  /** Anchor text, e.g. "The company has a durable moat". */
  label: string;
  /** Relative weight within the skill, 1-10. */
  weight: number;
}

export type ChartType = "line" | "bar" | "candlestick" | "table";

/**
 * Declarative chart spec from a skill's Charts section. Data is resolved in
 * code from tool results — the LLM never types chart values.
 */
export interface ChartSpec {
  type: ChartType;
  title: string;
  /** Series key from tool results (e.g. "revenue", "close") or a tool name. */
  data: string;
  note?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: number;
  /** Prose describing what this skill investigates and why it matters. */
  purpose: string;
  /** Tool names this skill is allowed to call. */
  data: string[];
  /** Ordered analysis steps. */
  method: string[];
  /** Optional weighted YES/PARTIAL/NO checklist. */
  anchors?: VerdictAnchor[];
  /** Optional declarative chart specs. */
  charts?: ChartSpec[];
  /** Optional extra output instructions appended to the analyst prompt. */
  outputTemplate?: string;
  source: "builtin" | "custom";
  /** Raw markdown, for editors and re-parsing. */
  markdown?: string;
}

export interface SkillCitation {
  /** Human-readable label of the source, e.g. a document heading or report section. */
  label?: string;
  /** External URL when the source is on the public web; empty for internal tool data. */
  url?: string;
  /** The data tool / report section the value came from, e.g. "get_financial_metrics". */
  source: string;
  /** The exact value(s) or quote this citation backs, copied verbatim from the tool result. */
  value: string;
}

export interface SkillVerdict {
  anchor: string;
  verdict: "YES" | "PARTIAL" | "NO" | "INSUFFICIENT";
  /** Short evidence quote or reasoning supporting the verdict. */
  evidence: string;
  /** Tool + external URL the evidence figure/quote came from. */
  citations?: SkillCitation[];
}

export interface SkillFinding {
  title: string;
  detail: string;
  /** Citations for the figures in this finding (source tool + url when web). */
  citations?: SkillCitation[];
}


export interface SkillChartRequest {
  spec_index: number;
  /** Optional LLM-suggested title override; code assembles the data. */
  title?: string;
}

export interface SkillRawObservation {
  /** Tool name that produced the observation. */
  tool: string;
  /** Call arguments, condensed. */
  args?: string;
  /** Verbatim (truncated) tool result body. */
  result: string;
  /** "ok" | "ERR" | "EMPTY" — empty/ERR observations are shown too, honestly. */
  status: string;
  /** External URL when this observation came from the public web (web_search result, PDF url). */
  url?: string;
}

export interface SkillOutput {
  skill_id: string;
  skill_name: string;
  category: SkillCategory;
  weight: number;
  findings: SkillFinding[];
  verdicts: SkillVerdict[];
  chart_requests: SkillChartRequest[];
  tools_used: string[];
  /** Citations: source tool + external url for every figure the skill cites. */
  citations: SkillCitation[];
  /** Raw verbatim tool observations — the unvarnished data the analysis ran on. */
  raw_observations: SkillRawObservation[];
  /**
   * Downloadable files built from the observations. The recipe is JSON and lives
   * in the same row; the binary is rendered only when the user downloads it.
   */
  artifacts?: SkillArtifact[];
  /** Set when the analyst produced no usable result at all. */
  error?: string;
  /** "deterministic" for rule-screen skills scored in code. */
  scored_by: "llm" | "deterministic";
  /** Skill's own markdown report (analyst prose), used by report synthesis. */
  analysis?: string;
  /** Populated by the aggregator. */
  score_0_100?: number;
  coverage?: number;
  /**
   * Verdict anchors the skill DECLARED, as opposed to the number of verdicts
   * the model happened to return. Coverage is measured against this — measuring
   * against the returned verdicts meant a model that answered 2 of 5 anchors
   * scored 2/2 = 100% coverage.
   */
  anchor_count?: number;
}

export function skillToPromptSection(skill: SkillDefinition): string {
  const parts: string[] = [];
  parts.push(`## Skill: ${skill.name} (${skill.category})`);
  parts.push(`Purpose: ${skill.purpose}`);
  if (skill.data.length) parts.push(`Data tools you may use: ${skill.data.join(", ")}.`);
  if (skill.method.length) {
    parts.push("Method:\n" + skill.method.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }
  if (skill.anchors?.length) {
    parts.push(
      "Verdict anchors — give a YES / PARTIAL / NO / INSUFFICIENT verdict for each, with a one-line evidence quote:\n" +
        skill.anchors.map((a) => `- ${a.label} (weight ${a.weight})`).join("\n"),
    );
  } else {
    parts.push("This skill has no verdict anchors — produce findings only, no verdicts.");
  }
  if (skill.charts?.length) {
    parts.push(
      "Charts the final report should include (data is assembled automatically — only reference the specs):\n" +
        skill.charts.map((c, i) => `${i + 1}. [${c.type}] ${c.title} — data: ${c.data}`).join("\n"),
    );
  }
  if (skill.outputTemplate) parts.push(`Output notes: ${skill.outputTemplate}`);
  // Hard anti-hallucination constraint, injected into EVERY skill prompt.
  // This is the contract that makes the run auditable: numbers either come
  // from a tool result in this session, or the anchor is INSUFFICIENT.
  parts.push(
    [
      "Evidence rules (strict):",
      "- Do not hallucinate numbers. Every figure — price, ratio, percentage, growth rate, date, volume — must be copied verbatim from a tool result returned in this session.",
      '- Never compute, estimate, round, or "fill in" a figure from memory, general knowledge, or what you believe about the company.',
      "- CITE YOUR SOURCES. Every finding and verdict evidence line must carry a citation: the tool it came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. Use the citations array for this — one entry per figure or quote.",
      "- If a needed figure was not observed, state that the data was unavailable and mark the affected anchor INSUFFICIENT. Missing data is an honest outcome; an invented number is not.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}
