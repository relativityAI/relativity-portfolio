/**
 * v2 data contracts (plan §5), adapted to the actual rubric schema.
 *
 * This is the single source of truth for cross-module shapes: evidence
 * assembly, judging, scoring. Types are plain TS interfaces — runtime
 * validation lives in the Zod schemas of rubric.ts / predicates.ts.
 */

export const VERDICTS = ["YES", "PARTIAL", "NO", "INSUFFICIENT"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Confidence = "low" | "med" | "high";

export type FactKind = "feature" | "event" | "chunk";

/** One fact the judge may cite. `raw` is source text for quote grounding. */
export interface Fact {
  id: string; // F<n> | E<n> | C<n>, stable per KB row
  kind: FactKind;
  text: string; // compact single-line rendering
  raw?: string; // source text used for grounding (NOT an LLM summary)
  as_of: string; // ISO date
  source_ref: string;
}

/** Deterministic per-criterion evidence bundle. */
export interface EvidenceCard {
  criterion_id: string;
  facts: Fact[]; // deterministic order
  token_estimate: number;
  hash: string; // sha256 of ordered fact ids + as_of + text
  reason?: "no_evidence"; // set when facts were empty → skip judge, gap-fill eligible
}

/** Raw KB rows the assembler reads (matches migration 011 shapes). */
export interface FeatureRow {
  symbol: string;
  source: string;
  data_version: string;
  as_of: string | null;
  features: Record<string, number | number[] | null>;
}

export interface EventRow {
  id: number;
  symbol: string;
  source: string;
  doc_hash: string;
  type: string;
  materiality: number;
  sentiment: string;
  summary: string;
  raw_excerpt: string;
  as_of: string | null;
  source_ref: string | null;
}

export interface ChunkRow {
  id: number;
  symbol: string;
  source: string;
  doc_hash: string;
  kind: string;
  text: string;
  as_of: string | null;
  source_ref: string | null;
}

/** Evidence request for a judge criterion. */
export interface EvidenceRequest {
  criterionId: string;
  features: string[]; // feature keys (§6.2 catalog)
  eventTypes: string[]; // event types to filter (empty = all)
  queries: string[]; // FTS/retrieval queries
  maxChunks: number; // cap on chunk facts, default 6
  /** Pre-loaded KB rows (injected in tests / offline eval; nil loads from DB). */
  featureRows?: FeatureRow[];
  eventRows?: EventRow[];
  chunkRows?: ChunkRow[];
}