/**
 * Evidence assembler (plan §6.4) — pure and deterministic.
 *
 * Given a judge criterion's evidence spec, produce an EvidenceCard:
 *   F<n> facts from requested features, E<n> from events (newest first, max 5),
 *   C<n> from retrieval (top-maxChunks chunks, ties by id).
 * Token budget: target 1,500, hard cap 2,500; drop lowest-ranked chunks first.
 * Same KB state ⇒ same card, byte for byte.
 */

import { createHash } from "node:crypto";
import { rankChunks } from "./kb/retrieval.js";
import type { ChunkRow, EvidenceCard, EvidenceRequest, EventRow, Fact, FeatureRow } from "./v2/types.js";

/** ~4 chars/token heuristic; deterministic and good enough for a budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const TARGET_TOKENS = 1500;
export const HARD_CAP_TOKENS = 2500;
export const MAX_EVENTS = 5;

/** Render a feature key as a compact, unit-labeled one-liner. */
export function featureLine(key: string, value: number | number[] | null, catalog: Record<string, { unit: string; desc: string }>): string {
  const spec = catalog[key];
  if (value === null || value === undefined) return `${key}: unavailable`;
  const unit = spec?.unit ?? "";
  const v = Array.isArray(value) ? `[${value.map(fmt).join(", ")}]` : fmt(value);
  const unitSuffix = unit === "pct" ? "%" : unit === "currency" ? "" : ` ${unit}`.trimEnd();
  return `${key}: ${v}${unitSuffix}${spec?.desc ? ` (${spec.desc})` : ""}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const asOfIso = (d: string | null): string => (d ? new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) : "");

interface RankedChunk {
  chunk: ChunkRow;
  rank: number; // 0 = most relevant
}
export function assembleEvidence(
  req: EvidenceRequest,
  deps: {
    featureRows: FeatureRow[];
    eventRows: EventRow[];
    chunkRows: ChunkRow[];
    featureCatalog: Record<string, { unit: string; desc: string }>;
    now?: Date;
  },
): EvidenceCard {
  const { featureRows, eventRows, chunkRows, featureCatalog, now = new Date() } = deps;
  const facts: Fact[] = [];

  // 1. Features (always, unmovable). Latest row per (symbol, source) wins.
  const wanted = new Set(req.features);
  if (wanted.size) {
    const latest = featureRows
      .filter((r) => r.as_of)
      .sort((a, b) => String(a.as_of).localeCompare(String(b.as_of)) || b.data_version.localeCompare(a.data_version));
    if (latest.length === 0) {
      // No dated rows: still surface the first row's features.
      if (featureRows[0]) {
        for (const key of req.features) {
          if (key in featureRows[0].features) {
            facts.push({
              id: `F${facts.filter((f) => f.kind === "feature").length + 1}`,
              kind: "feature",
              text: featureLine(key, featureRows[0].features[key], featureCatalog),
              raw: String(featureRows[0].features[key] ?? ""),
              as_of: asOfIso(featureRows[0].as_of),
              source_ref: featureRows[0].source,
            });
          }
        }
      }
    } else {
      const row = latest[latest.length - 1];
      for (const key of req.features) {
        if (!(key in row.features)) continue;
        facts.push({
          id: `F${facts.filter((f) => f.kind === "feature").length + 1}`,
          kind: "feature",
          text: featureLine(key, row.features[key], featureCatalog),
          raw: String(row.features[key] ?? ""),
          as_of: asOfIso(row.as_of),
          source_ref: row.source,
        });
      }
    }
  }

  // 2. Events (newest first, max 5) filtered by type.
  const filteredEvents = req.eventTypes.length
    ? eventRows.filter((e) => req.eventTypes.includes(e.type))
    : eventRows;
  const events = filteredEvents
    .slice()
    .sort((a, b) => (b.as_of || "").localeCompare(a.as_of || "") || b.id - a.id)
    .slice(0, MAX_EVENTS);
  for (const e of events) {
    facts.push({
      id: `E${e.id}`,
      kind: "event",
      text: `[${e.type}] ${e.summary} (materiality ${e.materiality}/5, ${e.sentiment})`,
      raw: e.raw_excerpt,
      as_of: asOfIso(e.as_of),
      source_ref: e.source_ref || e.source,
    });
  }

  // 3. Chunks via retrieval: top-maxChunks, budget-sorted so we drop lowest
  //    ranked (last) first when over cap.
  const top = rankChunks(chunkRows, req.queries, req.maxChunks, 60);
  const baseTokens = facts.reduce((s, f) => s + estimateTokens(f.text), 0);

  // Max 3 chunks if we're already heavy, else 6. Features are never dropped.
  let headroom = HARD_CAP_TOKENS - baseTokens;
  const kept: RankedChunk[] = [];
  for (const [i, chunk] of top.entries()) {
    const t = estimateTokens(chunk.text);
    if (t > headroom && kept.length >= 1) break; // cut the tail once over cap
    kept.push({ chunk, rank: i });
    headroom -= t;
  }
  for (const c of kept) {
    facts.push({
      id: `C${c.chunk.id}`,
      kind: "chunk",
      text: c.chunk.text,
      raw: c.chunk.text,
      as_of: asOfIso(c.chunk.as_of),
      source_ref: c.chunk.source_ref || c.chunk.source,
    });
  }

  const total = facts.length;
  const tokenEstimate = facts.reduce((s, f) => s + estimateTokens(f.text), 0);
  const hash = createHash("sha256")
    .update(facts.map((f) => `${f.id}|${f.as_of}|${f.text}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

  if (total === 0) {
    return { criterion_id: req.criterionId, facts: [], token_estimate: 0, hash, reason: "no_evidence" };
  }
  return { criterion_id: req.criterionId, facts, token_estimate: tokenEstimate, hash };
}