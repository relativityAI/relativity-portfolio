/**
 * v2 criterion scoring engine (plan §6.7) — runs a compiled rubric's criteria
 * against the KB and produces per-parameter verdict checklists.
 *
 * Contract:
 * - Predicate criteria are computed by predicates.ts (deterministic).
 * - Judge criteria are graded by the micro-judge (§6.5) over assembled
 *   evidence cards (§6.4).
 * - Verdicts map to the SAME YES/PARTIAL/NO/INSUFFICIENT shape as the v1
 *   checklist so scoreChecklist (§5.3) scores them identically and the UI
 *   needs no changes.
 * - Unknown ≠ 0: a criterion with missing features / empty evidence is
 *   INSUFFICIENT, never NO.
 * - Offline-first: callers may inject feature/event/chunk rows (evals, tests);
 *   nil loads from the DB.
 */

import type { CompiledRubric } from "../rubric.js";
import { evaluatePredicate, type PredicateResult } from "../predicates.js";
import { assembleEvidence } from "../evidence.js";
import { judgeCriterion, type JudgeResult } from "./judge.js";
import { FEATURE_CATALOG, type Unit } from "../units.js";
import type { ChunkRow, EventRow, EvidenceRequest, Fact, FeatureRow } from "./types.js";

/** Same verdict strings as the v1 checklist parser (scoring.ts). */
export type ChecklistVerdict = "YES" | "PARTIAL" | "NO" | "INSUFFICIENT DATA";

export interface CriterionOutcome {
  criterion_id: string;
  kind: "predicate" | "judge";
  verdict: ChecklistVerdict;
  /** Raw deterministic verdict for predicates (before mapping). */
  predicate?: Pick<PredicateResult, "verdict" | "unscored_reason" | "inputs">;
  /** Raw judge output for judge criteria. */
  judge?: Pick<JudgeResult, "verdict" | "confidence" | "quote" | "reasoning" | "cache_hit" | "grounded">;
  /** Deterministic evidence card hash for judge criteria (auditable). */
  evidence_hash?: string;
  /** Facts cited by the verdict (ids + text) for the UI disclosure. */
  facts?: Pick<Fact, "id" | "text">[];
}

export interface ParameterOutcome {
  parameter: string;
  section: "asset_evaluation" | "macro_evaluation";
  weightage: number;
  criteria: CriterionOutcome[];
}

export interface V2ScoreOptions {
  symbol: string;
  source: string;
  model?: string;
  llmKeys?: Record<string, string | undefined>;
  runId?: string;
  /** Feature map for predicates (keyed by §6.2 feature keys). */
  features: Record<string, unknown>;
  /** Pre-loaded KB rows; nil loads from the DB per judge criterion. */
  featureRows?: FeatureRow[];
  eventRows?: EventRow[];
  chunkRows?: ChunkRow[];
  /** Injected judge (offline evals); passes through to judgeCriterion. */
  judgeFn?: (prompt: string, system: string) => Promise<{ verdict: string; confidence: string; quote: string; reasoning: string }>;
  maxConcurrency?: number;
}

/** Map a predicate verdict to the checklist shape (YES/PARTIAL/NO). */
function predicateToVerdict(r: PredicateResult): ChecklistVerdict {
  if (r.verdict === "INSUFFICIENT") return "INSUFFICIENT DATA";
  return r.verdict; // YES | NO
}

/** Map a judge verdict; PARTIAL stays PARTIAL, INSUFFICIENT maps to the checklist string. */
function judgeToVerdict(v: string): ChecklistVerdict {
  if (v === "INSUFFICIENT") return "INSUFFICIENT DATA";
  return v as ChecklistVerdict;
}

const FEATURE_CATALOG_TYPED = FEATURE_CATALOG as Record<string, { unit: Unit; desc: string }>;

/**
 * Run one compiled rubric against the feature map + KB rows. Deterministic
 * given the same inputs (LLM judge aside, which is cache-keyed by evidence
 * hash). Criteria run sequentially per parameter to keep judge calls cheap;
 * parameters run sequentially too — the v1 pipeline parallelizes at a higher
 * level if needed.
 */
export async function scoreRubric(rubric: CompiledRubric, opts: V2ScoreOptions): Promise<ParameterOutcome[]> {
  const out: ParameterOutcome[] = [];

  for (const item of rubric.parameters) {
    const criteria: CriterionOutcome[] = [];
    for (const c of item.criteria) {
      if (c.kind === "predicate") {
        const r = evaluatePredicate({ expr: c.expr, requires: c.requires }, opts.features);
        criteria.push({
          criterion_id: c.id,
          kind: "predicate",
          verdict: predicateToVerdict(r),
          predicate: { verdict: r.verdict, unscored_reason: r.unscored_reason, inputs: r.inputs },
        });
        continue;
      }

      // ---- judge criterion: assemble evidence, then grade ----
      const req: EvidenceRequest = {
        criterionId: c.id,
        features: c.evidence.features || [],
        eventTypes: c.evidence.event_types || [],
        queries: c.evidence.retrieval || [],
        maxChunks: 6,
        featureRows: opts.featureRows,
        eventRows: opts.eventRows,
        chunkRows: opts.chunkRows,
      };
      const card = assembleEvidence(req, {
        featureRows: opts.featureRows || [],
        eventRows: opts.eventRows || [],
        chunkRows: opts.chunkRows || [],
        featureCatalog: FEATURE_CATALOG_TYPED,
      });

      if (card.reason === "no_evidence") {
        // Gap-fill eligible: empty card → INSUFFICIENT without an LLM call.
        criteria.push({
          criterion_id: c.id,
          kind: "judge",
          verdict: "INSUFFICIENT DATA",
          evidence_hash: card.hash,
          judge: {
            verdict: "INSUFFICIENT",
            confidence: "low",
            quote: "",
            reasoning: "no evidence found for this criterion",
            cache_hit: false,
            grounded: true,
          },
        });
        continue;
      }

      const res = await judgeCriterion({
        criterionId: c.id,
        anchors: c.anchors,
        card,
        model: opts.model,
        llmKeys: opts.llmKeys,
        runId: opts.runId,
        judgeFn: opts.judgeFn as any,
      });
      criteria.push({
        criterion_id: c.id,
        kind: "judge",
        verdict: judgeToVerdict(res.verdict),
        judge: {
          verdict: res.verdict,
          confidence: res.confidence,
          quote: res.quote,
          reasoning: res.reasoning,
          cache_hit: res.cache_hit,
          grounded: res.grounded,
        },
        evidence_hash: card.hash,
        facts: card.facts.map((f) => ({ id: f.id, text: f.text })),
      });
    }
    out.push({
      parameter: item.parameter,
      section: item.section,
      weightage: item.weightage,
      criteria,
    });
  }
  return out;
}

/**
 * Convert parameter outcomes into the v1-style per-parameter analysis record
 * consumed by aggregateWeightedScores / scoreChecklist / the report renderer.
 * The per-parameter score is computed HERE by scoreChecklist (§5.3) — the
 * judge's verdicts are evidence, the arithmetic is ours.
 */
export function parameterOutcomesToAnalysis(outcomes: ParameterOutcome[]): Record<
  string,
  {
    score: number | null;
    weightage: number;
    section: string;
    checklist: { criterion: string; verdict: ChecklistVerdict }[];
    score_source: "v2_rubric";
    criteria_detail: CriterionOutcome[];
  }
> {
  const out: Record<string, any> = {};
  for (const p of outcomes) {
    out[p.parameter] = {
      score: null, // filled by caller via scoreChecklist; kept null here for honesty
      weightage: p.weightage,
      section: p.section,
      checklist: p.criteria.map((c) => ({ criterion: c.criterion_id, verdict: c.verdict })),
      score_source: "v2_rubric" as const,
      criteria_detail: p.criteria,
    };
  }
  return out;
}

// Self-check: npx tsx src/v2/score.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const rubric: CompiledRubric = {
    parameters: [
      {
        parameter: "Return Durability",
        section: "asset_evaluation",
        weightage: 8,
        criteria: [
          { kind: "predicate", id: "p1", expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] }, requires: ["roe_annual"] },
        ],
      },
    ],
  } as any;
  // min_last is registered by predicates.ts (imported above through judge? no —
  // via predicates.js). Evaluate directly to confirm wiring.
  const r = evaluatePredicate(
    { expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] }, requires: ["roe_annual"] },
    { roe_annual: [10, 22, 18, 31, 26] },
  );
  if (r.verdict !== "YES") throw new Error(`predicate wiring: ${JSON.stringify(r)}`);
  void rubric;
  console.log("score OK");
}
