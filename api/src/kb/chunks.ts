/**
 * KB chunking (plan §6.4) — pure token-budgeted splitter with 15% overlap,
 * cut at sentence boundaries where possible. Deterministic.
 *
 * The `estimateTokens` heuristic (~4 chars/token) is shared with evidence.ts
 * so the KB budget and the evidence token budget agree.
 */

import { createHash } from "node:crypto";
import type { ChunkRow } from "../v2/types.js";

export interface ChunkInput {
  symbol: string;
  source: string;
  doc_hash: string; // idempotency key per document
  kind: string; // filing | concall | announcement | news
  text: string;
  as_of: string | null;
  source_ref: string | null;
}

/** ~4 chars/token — same heuristic as evidence.ts. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const CHUNK_MIN = 400; // tokens
export const CHUNK_MAX = 600; // tokens
export const CHUNK_OVERLAP = 0.15;

const SENT_BREAK = /(?<=[.!?])\s+/;

/** Split into {min,max}-token chunks with 15% overlap over previous. */
export function chunkText(input: ChunkInput): Omit<ChunkRow, "id" | "tsv">[] {
  const { text, doc_hash } = input;
  if (!text.trim()) return [];

  const words = text.split(/\s+/);
  const chunks: Omit<ChunkRow, "id" | "tsv">[] = [];
  const stride = Math.round(CHUNK_MAX * (1 - CHUNK_OVERLAP)); // tokens

  const budget = (words: string[]): number => estimateTokens(words.join(" "));

  let start = 0;
  let seq = 0;
  while (start < words.length) {
    // Grow until reaching CHUNK_MAX tokens.
    let end = start;
    while (end < words.length && budget(words.slice(start, end + 1)) < CHUNK_MAX) end++;
    let slice = words.slice(start, end === start ? 1 : end);
    // Back off to the last sentence break that keeps ≥ CHUNK_MIN tokens.
    const joined = slice.join(" ");
    const parts = joined.split(SENT_BREAK);
    if (parts.length > 1) {
      let trimmed = parts[0];
      for (let i = 1; i < parts.length; i++) {
        const candidate = `${trimmed} ${parts[i]}`;
        if (budget(candidate.split(" ")) < CHUNK_MIN) break;
        trimmed = candidate;
      }
      slice = trimmed.split(" ");
    }
    chunks.push({
      symbol: input.symbol,
      source: input.source,
      doc_hash,
      kind: input.kind,
      text: slice.join(" "),
      as_of: input.as_of,
      source_ref: input.source_ref,
    });
    const advance = Math.max(slice.length, budget(slice) - stride + 1);
    if (seq > 0 && budget(slice) < CHUNK_MIN) break; // last short tail
    start += Math.max(advance, 1);
    seq++;
    if (start >= words.length) break;
  }
  return chunks;
}

/** Deterministic document-level hash for idempotency. */
export function docHash(text: string, kind: string, sourceRef: string | null): string {
  return createHash("sha256").update(`${kind}|${sourceRef}|${text}`).digest("hex").slice(0, 16);
}