/**
 * quant-screen — deterministic evaluation of migrated numeric rules (D3/D4).
 *
 * A migrated "Quant Screen" skill's anchors encode numeric rules like
 * "Return on Equity > 15". These are evaluated in code against the metrics
 * snapshot with the same soft-boundary logic as the v1 quant engine — the
 * LLM never scores a numeric rule.
 */

import type { SkillDefinition, SkillOutput, SkillVerdict } from "./types.js";

type Operator = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

interface ParsedRule {
  metric: string;
  operator: Operator;
  value: number;
  value_upper?: number;
  weight: number;
}

function parseRuleAnchor(label: string, weight: number): ParsedRule | null {
  // e.g. "Return on Equity > 15", "Debt to Equity < 0.5", "P/E Ratio between 10 and 25"
  const between = label.match(/^(.+?)\s+between\s+([\d.,]+)\s+and\s+([\d.,]+)\s*$/i);
  if (between) {
    return {
      metric: between[1].trim(),
      operator: "between",
      value: parseFloat(between[2].replace(/,/g, "")),
      value_upper: parseFloat(between[3].replace(/,/g, "")),
      weight,
    };
  }
  const m = label.match(/^(.+?)\s*(>=|<=|>|<|=)\s*([+-]?[\d.,]+)\s*%?$/);
  if (!m) return null;
  const opMap: Record<string, Operator> = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "=": "eq" };
  const value = parseFloat(m[3].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { metric: m[1].trim(), operator: opMap[m[2]], value, weight };
}

/** Linear decay from full credit at the threshold to zero at ±spread. */
function decay(value: number, threshold: number, dir: "above" | "below"): number {
  const spread = Math.max(Math.abs(threshold), 1) * 0.5;
  const distance = dir === "above" ? value - threshold : threshold - value;
  if (distance >= 0) return 1;
  return Math.max(0, 1 + distance / spread);
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recursive case-insensitive metric lookup in the snapshot. */
function findMetricValue(metrics: Record<string, unknown>, name: string): number | null {
  const target = normKey(name);
  const aliases = new Map<string, string>([["returnonequity", "roe"]]);
  const want = aliases.get(target) || target;
  let found: number | null = null;
  const visit = (v: unknown): void => {
    if (found !== null || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (found !== null) return;
      const nk = normKey(k);
      if ((nk === want || (want === "roe" && nk === "returnonequity")) && typeof val === "number") {
        found = val;
        return;
      }
      visit(val);
    }
  };
  visit(metrics);
  return found;
}

/** Convert a numeric evaluation into an honest verdict. */
function evaluateRule(rule: ParsedRule, metrics: Record<string, unknown> | null): SkillVerdict {
  if (!metrics) {
    return { anchor: rule.metric, verdict: "INSUFFICIENT", evidence: "Metrics snapshot unavailable (provider outage)." };
  }
  const value = findMetricValue(metrics, rule.metric);
  if (value === null || !Number.isFinite(value)) {
    return { anchor: rule.metric, verdict: "INSUFFICIENT", evidence: `Metric "${rule.metric}" not found in the snapshot — unscored, not zero.` };
  }
  let credit: number;
  switch (rule.operator) {
    case "between": {
      if (rule.value_upper == null) { credit = 0; break; }
      credit = value >= rule.value && value <= rule.value_upper ? 1 : 0;
      break;
    }
    case "gt": credit = decay(value, rule.value, "above"); break;
    case "gte": credit = value >= rule.value ? 1 : decay(value, rule.value, "above"); break;
    case "lt": credit = decay(value, rule.value, "below"); break;
    case "lte": credit = value <= rule.value ? 1 : decay(value, rule.value, "below"); break;
    case "eq": credit = Math.abs(value - rule.value) < 1e-9 ? 1 : 0; break;
  }
  const verdict = credit >= 1 ? "YES" : credit >= 0.5 ? "PARTIAL" : "NO";
  return {
    anchor: rule.metric,
    verdict,
    evidence: `${rule.metric} = ${value} vs rule ${rule.operator === "between" ? `${rule.value}\u2013${rule.value_upper}` : `${rule.operator} ${rule.value}`}`,
  };
}

/**
 * Re-score a quant-screen skill's output deterministically, replacing any LLM
 * verdicts. `metrics` null (provider outage) ⇒ all anchors INSUFFICIENT.
 */
export async function runQuantScreen(
  skill: SkillDefinition,
  output: SkillOutput,
  metrics: Record<string, unknown> | null,
  _priceData?: string,
): Promise<SkillOutput> {
  const weights = new Map((skill.anchors || []).map((a) => [a.label.toLowerCase(), a.weight]));
  const verdicts: SkillVerdict[] = [];
  for (const anchor of skill.anchors || []) {
    const rule = parseRuleAnchor(anchor.label, anchor.weight);
    if (!rule) {
      // Non-parseable anchor: leave it to whatever the analyst said, or mark it
      // insufficient when the analyst produced nothing usable.
      const existing = output.verdicts.find((v) => v.anchor.toLowerCase() === anchor.label.toLowerCase());
      verdicts.push(existing || { anchor: anchor.label, verdict: "INSUFFICIENT", evidence: "Rule could not be parsed as a numeric criterion." });
      continue;
    }
    verdicts.push(evaluateRule(rule, metrics));
  }
  return {
    ...output,
    verdicts,
    scored_by: "deterministic",
    error: undefined,
    findings: output.findings.length
      ? output.findings
      : verdicts.map((v) => ({ title: v.anchor, detail: v.evidence })),
    tools_used: Array.from(new Set([...(output.tools_used || []), "get_financial_metrics"])),
    // Quant screens are scored in code against the metrics snapshot — record
    // that snapshot as the citation so the result page / PDF can show exactly
    // where every rule's number came from.
    citations: (output.citations || []).concat(
      verdicts.map((v) => ({
        label: v.anchor,
        source: "get_financial_metrics",
        value: v.evidence,
      })),
    ).slice(0, 24),
  };
}
