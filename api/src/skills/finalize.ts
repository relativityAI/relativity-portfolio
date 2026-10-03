/**
 * finalize — the shared tail of the v3 skills pipeline (both orchestrators).
 *
 * Three rules this module exists to enforce, all of them learned the hard way:
 *
 * 1. The consistency gate reads the NARRATIVE ONLY. It runs before the
 *    code-rendered blocks (scorecard tables, score charts, Sources) are
 *    appended. It was reading its own Sources section, whose cells hold raw
 *    tool output — a news snippet saying "looks overbought" tripped the
 *    RSI rule and voided the whole report.
 * 2. A failed gate is ADVISORY. It renders a caution callout; it never
 *    replaces the report. The gate is a regex over prose, so a false
 *    positive must never be able to delete a finished analysis.
 * 3. Code blocks are appended ONCE, after the gate settles. Appending them
 *    inside the regeneration branch meant a gate-passing regeneration threw
 *    away the scorecard tables, the score charts and the Sources section.
 */

import { sanitizeReport, type AnalysisReport, type ReportBlock } from "../agent.js";
import { gateReport, type GateResult } from "../reportGate.js";
import type { StanceResult } from "../marketdata.js";

export interface FinalizeInput {
  /** The LLM's narrative. `blocks` here must be the model's own output only. */
  narrative: AnalysisReport;
  factsPack: string;
  /** Code-rendered blocks appended after the narrative, in display order. */
  codeBlocks: ReportBlock[];
  /** Numeric-integrity allowlist for sanitizeReport. */
  known: Set<number>;
  /** Our deterministic aggregate; null when coverage was too thin to show one. */
  totalScore: number | null;
  stance?: StanceResult | null;
  /**
   * Re-synthesis when the gate fails, handed the issues to correct. NOTE: same
   * inputs and near-zero temperature reproduce near-identical prose, so the
   * caller must vary something (see SkillSynthesisInput.temperature) or this
   * is a wasted call. Returns null to skip.
   */
  regenerate?: (issues: string[]) => Promise<AnalysisReport | null>;
  onLog?: (message: string) => void;
}

export interface FinalizeResult {
  report: AnalysisReport;
  gate: GateResult;
}

export async function finalizeReport(input: FinalizeInput): Promise<FinalizeResult> {
  let narrative = input.narrative;
  let gate = gateReport(narrative, input.factsPack);

  if (!gate.pass && input.regenerate) {
    input.onLog?.(`consistency gate failed (${gate.issues.length} issue(s)) — regenerating once`);
    const regenerated = await input.regenerate(gate.issues);
    if (regenerated && regenerated.source !== "fallback") {
      const regenGate = gateReport(regenerated, input.factsPack);
      if (regenGate.pass) {
        narrative = regenerated;
        gate = regenGate;
        input.onLog?.("consistency gate passed after regeneration");
      }
    }
  }

  // ONE assembly site: narrative, then the code-rendered sections, sanitized
  // once. Nothing downstream can drop the scorecard or the sources.
  const assembled: AnalysisReport = {
    ...narrative,
    blocks: [...narrative.blocks, ...input.codeBlocks],
  };
  const { report, dropped } = sanitizeReport(assembled, input.known);
  if (dropped.length) {
    input.onLog?.(`report sanitized — dropped ${dropped.length} block(s): ${dropped.slice(0, 5).join("; ")}`);
  }

  const blocks = [...report.blocks];
  // Soft checks first, then hard ones: a failed gate reads as a caution the
  // reader can weigh, not as a reason the report does not exist.
  if (gate.warnings.length) {
    blocks.unshift({
      type: "callout",
      tone: "caution",
      text: `Worth verifying: ${gate.warnings.slice(0, 3).join("; ")}`,
    });
  }
  if (!gate.pass) {
    const reason = gate.issues.slice(0, 2).join("; ").slice(0, 400);
    blocks.unshift({
      type: "callout",
      tone: "caution",
      text:
        `The narrative contradicts a few computed figures (${reason}). ` +
        `The verdict tables, scorecard and plots below are computed in code from the same data — trust those over the prose.`,
    });
  }

  return {
    report: {
      ...report,
      blocks,
      // The hero number is OUR stored total, not the model's: clamp it to the
      // deterministic aggregate so the headline can never drift from
      // analysis_runs.total_score.
      heroPct: input.totalScore != null ? Math.round(input.totalScore * 10) / 10 : report.heroPct,
      heroLabel: input.stance
        ? `${input.stance.overall} · ${input.stance.confidence}% confidence`
        : report.heroLabel,
    },
    gate,
  };
}