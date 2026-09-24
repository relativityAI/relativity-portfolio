#!/usr/bin/env tsx
/**
 * Phase 0 eval runner — offline, deterministic, no network.
 *
 * Runs the golden fixtures through the deterministic parts of both pipelines
 * and compares against BASELINE.json:
 *   - predicates.ts    (§6.3 predicate evaluation)
 *   - evidence.ts      (§6.4 evidence assembly: fact order, budgets, hashing)
 *   - kb/chunks.ts     (§6.4 chunking bounds + determinism)
 *   - scoring.ts       (§5.3 aggregation + checklist scoring)
 *   - v2/score.ts      (§6.7 rubric scoring with an injected stub judge)
 *
 * Usage:
 *   npx tsx evals/run.ts              # run + compare against baseline
 *   npx tsx evals/run.ts --update     # re-bless the baseline
 *
 * Exit code 1 on any drift; prints a per-suite summary.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { evaluatePredicate } from "../src/predicates.js";
import { assembleEvidence, estimateTokens } from "../src/evidence.js";
import { chunkText, docHash } from "../src/kb/chunks.js";
import { deriveFeatures } from "../src/kb/features.js";
import { aggregateWeightedScores, combinePillars, scoreChecklist } from "../src/scoring.js";
import { scoreRubric, parameterOutcomesToAnalysis } from "../src/v2/score.js";
import { FEATURE_CATALOG } from "../src/units.js";
import type { ChunkRow, EventRow, FeatureRow } from "../src/v2/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(HERE, "BASELINE.json");
const UPDATE = process.argv.includes("--update");

// ── golden fixture (reproducible inputs) ────────────────────────────────────

const SYMBOL = "TEST";
const SOURCE = "NSE";

const SNAPSHOT: Record<string, any> = {
  roe_annual: [0.1, 0.22, 0.18, 0.31, 0.26],
  roic_ttm: 0.19,
  net_debt_ebitda: 1.4,
  interest_coverage: 6.2,
  current_ratio: 1.8,
  op_margin: [11, 12, 14, 13, 16],
  net_margin: [8, 9, 9.5, 11, 12],
  period_end_date: "2026-03-31",
};

const FEATURE_ROWS: FeatureRow[] = [
  {
    symbol: SYMBOL,
    source: SOURCE,
    data_version: "v1",
    as_of: "2026-03-31",
    features: {
      roe_annual: [10, 22, 18, 31, 26],
      roic_ttm: 19,
      net_debt_ebitda: 1.4,
      op_margin: [11, 12, 14, 13, 16],
    },
  },
];

const EVENT_ROWS: EventRow[] = [
  {
    id: 2, symbol: SYMBOL, source: SOURCE, doc_hash: "d2", type: "earnings",
    materiality: 4, sentiment: "pos", summary: "Q4 beat", raw_excerpt: "Revenue up 20% yoy with margins expanding.",
    as_of: "2026-06-30", source_ref: "news/1",
  },
  {
    id: 1, symbol: SYMBOL, source: SOURCE, doc_hash: "d1", type: "mgmt_change",
    materiality: 2, sentiment: "neu", summary: "New CFO", raw_excerpt: "Company appointed a new CFO effective April.",
    as_of: "2026-02-28", source_ref: "news/2",
  },
];

const CHUNK_TEXT =
  "The management discussion confirms a durable moat in packaging through logistics scale. ".repeat(6) +
  "Capital allocation has favored disciplined reinvestment over the last five years. ".repeat(4);

const CHUNK_ROWS: ChunkRow[] = [
  { id: 10, symbol: SYMBOL, source: SOURCE, doc_hash: "c1", kind: "filing", text: CHUNK_TEXT, as_of: "2026-05-31", source_ref: "filing/1" },
  { id: 11, symbol: SYMBOL, source: SOURCE, doc_hash: "c2", kind: "filing", text: "Unrelated analyst trivia about packaging trivia.", as_of: "2026-05-31", source_ref: "filing/2" },
];

const RUBRIC = {
  parameters: [
    {
      parameter: "Return Durability",
      section: "asset_evaluation" as const,
      weightage: 8,
      criteria: [
        { kind: "predicate" as const, id: "durability-roe-floor", expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] }, requires: ["roe_annual"] },
        { kind: "judge" as const, id: "durability-allocation", anchors: { yes: "disciplined reinvestment", partial: "mixed", no: "value destruction" }, evidence: { features: ["roe_annual"], retrieval: ["capital allocation moat"], event_types: ["earnings"] } },
      ],
    },
    {
      parameter: "Balance Sheet",
      section: "asset_evaluation" as const,
      weightage: 5,
      criteria: [
        { kind: "predicate" as const, id: "bs-leverage", expr: { "<=": [{ var: "net_debt_ebitda" }, 2] }, requires: ["net_debt_ebitda"] },
        { kind: "predicate" as const, id: "bs-coverage", expr: { ">=": [{ var: "interest_coverage" }, 3] }, requires: ["interest_coverage"] },
        { kind: "predicate" as const, id: "bs-liquidity", expr: { ">=": [{ var: "current_ratio" }, 1.5] }, requires: ["current_ratio"] },
      ],
    },
  ],
};

// Deterministic stub judge: verdict keyed by criterion id, quotes must be
// verbatim substrings of fact text so grounding passes.
const STUB_JUDGE: Record<string, { verdict: string; confidence: string; quote: string; reasoning: string }> = {
  "durability-allocation": {
    verdict: "YES",
    confidence: "high",
    quote: "durable moat in packaging through logistics scale",
    reasoning: "evidence states disciplined reinvestment",
  },
};

// ── suite runners (each returns a JSON-serializable result) ────────────────

function suitePredicates() {
  return {
    roe_floor_yes: evaluatePredicate(
      { expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] }, requires: ["roe_annual"] },
      { roe_annual: SNAPSHOT.roe_annual },
    ),
    roe_floor_no: evaluatePredicate(
      { expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 40] }, requires: ["roe_annual"] },
      { roe_annual: SNAPSHOT.roe_annual },
    ),
    leverage_ok: evaluatePredicate(
      { expr: { "<=": [{ var: "net_debt_ebitda" }, 2] }, requires: ["net_debt_ebitda"] },
      deriveFeatures(SNAPSHOT).features as Record<string, unknown>,
    ),
    null_propagation: evaluatePredicate(
      { expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] },
      { roe_min_10y: null },
    ),
  };
}

function suiteEvidence() {
  const catalog = Object.fromEntries(
    Object.entries(FEATURE_CATALOG).map(([k, v]) => [k, { unit: v.unit, desc: v.desc }]),
  );
  const card = assembleEvidence(
    { criterionId: "durability-allocation", features: ["roe_annual"], eventTypes: ["earnings"], queries: ["moat capital allocation"], maxChunks: 6 },
    { featureRows: FEATURE_ROWS, eventRows: EVENT_ROWS, chunkRows: CHUNK_ROWS, featureCatalog: catalog },
  );
  return {
    fact_ids: card.facts.map((f) => f.id),
    hash: card.hash,
    token_estimate: card.token_estimate,
    under_hard_cap: card.token_estimate <= 2500,
  };
}

function suiteChunks() {
  const longDoc = CHUNK_TEXT.repeat(8);
  const chunks = chunkText({
    symbol: SYMBOL, source: SOURCE, doc_hash: docHash(longDoc, "filing", "f/1"),
    kind: "filing", text: longDoc, as_of: "2026-03-31", source_ref: "f/1",
  });
  return {
    chunk_count: chunks.length,
    all_within_bounds: chunks.every((c) => estimateTokens(c.text) <= 620),
    doc_hash: docHash(longDoc, "filing", "f/1"),
  };
}

function suiteScoring() {
  const checklist = [
    { criterion: "a", verdict: "YES" },
    { criterion: "b", verdict: "PARTIAL" },
    { criterion: "c", verdict: "NO" },
    { criterion: "d", verdict: "INSUFFICIENT DATA" },
  ];
  const agg = aggregateWeightedScores([
    { score: 80, weightage: 5 },
    { score: null, weightage: 3, unscored_reason: "missing_data" as const },
  ]);
  const total = combinePillars([
    { key: "quantitative", result: aggregateWeightedScores([{ score: 0, weightage: 5 }]), weight: 1 },
    { key: "qualitative", result: aggregateWeightedScores([{ score: 80, weightage: 5 }]), weight: 1 },
  ]);
  return { checklist: scoreChecklist(checklist), agg, total };
}

async function suiteRubric() {
  const features = deriveFeatures(SNAPSHOT).features;
  const outcomes = await scoreRubric(RUBRIC as any, {
    symbol: SYMBOL,
    source: SOURCE,
    model: "stub",
    features: features as Record<string, unknown>,
    featureRows: FEATURE_ROWS,
    eventRows: EVENT_ROWS,
    chunkRows: CHUNK_ROWS,
    judgeFn: async (prompt: string) => {
      const id = /Criterion: (.+)/.exec(prompt)?.[1] || "";
      const stub = STUB_JUDGE[id];
      if (!stub) return { verdict: "INSUFFICIENT", confidence: "low", quote: "", reasoning: "no stub" };
      return stub;
    },
  });
  const analysis = parameterOutcomesToAnalysis(outcomes);
  const summary: Record<string, unknown> = {};
  for (const p of outcomes) {
    const scored = scoreChecklist(analysis[p.parameter].checklist);
    analysis[p.parameter].score = scored.score;
    summary[p.parameter] = { score: scored.score, coverage: scored.coverage, counts: scored.counts };
  }
  return summary;
}

// ── comparison ─────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log("Phase 0 eval runner — offline, deterministic\n");

  const results = {
    predicates: suitePredicates(),
    evidence: suiteEvidence(),
    chunks: suiteChunks(),
    scoring: suiteScoring(),
    rubric: await suiteRubric(),
  };

  let pass = true;
  if (UPDATE || !existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + "\n");
    console.log(UPDATE ? "baseline updated." : "no baseline found — wrote a fresh one.");
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const [suite, value] of Object.entries(results)) {
      const ok = deepEqual((baseline as any)[suite], value);
      console.log(`${ok ? "PASS" : "DRIFT"} ${suite}`);
      if (!ok) {
        pass = false;
        console.log("  expected:", JSON.stringify((baseline as any)[suite], null, 2));
        console.log("  actual:  ", JSON.stringify(value, null, 2));
      }
    }
    console.log(pass ? "\nall suites match baseline." : "\nDRIFT DETECTED — review before merging.");
  }

  console.log("\nsummary:");
  console.log(JSON.stringify(results, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
