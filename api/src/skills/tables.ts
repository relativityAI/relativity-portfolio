/**
 * tables — deterministic score tables for skill outputs (D2 preserved: code
 * renders every number; the LLM never authors a scorecard row). Emits report
 * blocks directly.
 */

import type { ReportBlock } from "../agent.js";
import type { AggregatedScores } from "./aggregate.js";
import type { SkillOutput } from "./types.js";

const VERDICT_ORDER = { YES: 0, PARTIAL: 1, NO: 2, INSUFFICIENT: 3 } as const;

export function buildSkillScoreTables(outputs: SkillOutput[], agg: AggregatedScores, agentName: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];

  const perSkill: (string | number)[][] = [];
  for (const s of agg.per_skill) {
    const out = outputs.find((o) => o.skill_id === s.skill_id);
    perSkill.push([
      out?.skill_name || s.skill_id,
      out?.scored_by === "deterministic" ? "rules" : "analyst",
      s.score_0_100 == null ? "N/A" : s.score_0_100,
      `${Math.round(s.coverage * 100)}%`,
      `${s.verdict_counts.yes}Y / ${s.verdict_counts.partial}P / ${s.verdict_counts.no}N / ${s.verdict_counts.insufficient} insuff.`,
    ]);
  }
  blocks.push({
    type: "table",
    title: "Skill Scores",
    columns: ["Skill", "Scored by", "Score", "Coverage", "Verdicts"],
    rows: perSkill,
    sourceKeys: ["skill_outputs"],
  });

  blocks.push({
    type: "table",
    title: "Aggregate",
    columns: ["Agent", "Total Score", "Uncertainty Band", "Coverage"],
    rows: [[
      agentName,
      agg.scored_count > 0 ? agg.total_score : "N/A",
      `${agg.fit_low}\u2013${agg.fit_high}`,
      `${Math.round(agg.coverage * 100)}%`,
    ]],
    sourceKeys: ["skill_outputs"],
  });

  // Deterministic score chart — the same per-skill numbers as the table above,
  // drawn. Code-assembled from agg (D5: the LLM never types these figures),
  // and only when two or more skills scored (a one-bar chart is noise).
  const scoredForChart = agg.per_skill.filter((s) => s.score_0_100 != null);
  if (scoredForChart.length >= 2) {
    blocks.push({
      type: "chart",
      chartType: "bar",
      title: "Skill scores (0–100)",
      data: scoredForChart.map((s) => {
        const out = outputs.find((o) => o.skill_id === s.skill_id);
        return { name: out?.skill_name || s.skill_id, score: Math.round(s.score_0_100!) };
      }),
      sourceKeys: ["skill_outputs"],
    });
  }

  // Verdict detail per skill with anchors.
  for (const out of outputs) {
    if (!out.verdicts?.length) continue;
    const rows = [...out.verdicts]
      .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])
      .map((v) => [v.anchor, v.verdict, v.evidence]);
    blocks.push({
      type: "table",
      title: `${out.skill_name} — Verdicts`,
      columns: ["Anchor", "Verdict", "Evidence"],
      rows,
      sourceKeys: ["skill_outputs"],
    });
  }

  return blocks;
}
