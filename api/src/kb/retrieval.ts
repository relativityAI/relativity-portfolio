/**
 * KB retrieval (plan §6.4, D7) — pure FTS ranking over stock_chunks rows.
 *
 * Query is naive but deterministic: term matching over chunk text, recency
 * boost, ties broken by chunk id. Postgres `websearch_to_tsquery` (or FTS
 * rank) replaces this when wired to the real table; the function stays the
 * same signature so tests and offline evals can inject rows.
 */

import type { ChunkRow } from "../v2/types.js";

/** Deterministic FTS-ish rank: term hits weighted, recency boost, id tiebreak. */
export function rankChunks(
  rows: ChunkRow[],
  queries: string[],
  maxChunks = 6,
  maxAgeDays = 60,
): ChunkRow[] {
  if (!rows.length || !queries.length) return [];

  const terms = queries
    .flatMap((q) => q.split(/\s+/))
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2);

  const now = Date.now();
  const day = 86_400_000;

  const scored = rows
    .map((row) => {
      const text = row.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const hits = (text.match(new RegExp(term, "g")) || []).length;
        if (hits > 0) score += 1 + Math.min(hits, 3);
      }
      if (row.as_of) {
        const ageDays = (now - new Date(row.as_of).getTime()) / day;
        // Linear recency boost: fresh → +1, hits maxAge → 0.
        if (ageDays <= maxAgeDays) score += 1 - ageDays / maxAgeDays;
      }
      return { row, score };
    })
    .filter((s) => s.score > 0)
    // Score desc, then id asc (stable tiebreak).
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id);

  return scored.slice(0, maxChunks).map((s) => s.row);
}