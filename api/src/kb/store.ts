/**
 * KB ingestion (plan §6.4) — idempotent by doc_hash.
 *
 * chunks: insert-ignore into stock_chunks keyed on (symbol, source, doc_hash).
 * events: classify an announcement/news string ONCE via generateObject, store
 *   raw_excerpt + prompt_version + model. Grounding checks run against raw text.
 */

import { z } from "zod";
import { generateObject } from "ai";
import { getDb } from "../db.js";
import { log } from "../logger.js";
import { keyPool } from "../keypool.js";
import { config } from "../config.js";
import { docHash, chunkText, type ChunkInput } from "./chunks.js";

export const EVENT_TYPES = [
  "guidance",
  "earnings",
  "mgmt_change",
  "capex",
  "mna",
  "litigation",
  "regulatory",
  "pledge",
  "rating",
  "dividend",
  "other",
] as const;

const EventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  materiality: z.number().int().min(1).max(5),
  sentiment: z.enum(["neg", "neu", "pos"]),
  summary: z.string().max(40),
});

export interface ClassifyInput {
  symbol: string;
  source: string;
  text: string; // raw announcement/news text
  as_of: string | null;
  source_ref: string | null;
  llmKeys?: Record<string, string | undefined>;
  model?: string;
}

/** Insert chunks for a document, ignoring duplicates on (symbol, source, doc_hash). */
export async function persistChunks(input: ChunkInput, db = getDb()): Promise<{ inserted: number }> {
  const rows = chunkText(input);
  if (!rows.length) return { inserted: 0 };
  const { error } = await db
    .from("stock_chunks")
    .upsert(rows, { onConflict: "symbol,source,doc_hash" });
  if (error) {
    log.warn("[kb]", `chunk upsert failed for ${input.symbol}: ${error.message}`);
    return { inserted: 0 };
  }
  return { inserted: rows.length };
}

/** Load KB rows for a symbol as the evidence assembler expects. */
export async function loadKbRows(
  symbol: string,
  source: string,
): Promise<{ features: any[]; events: any[]; chunks: any[] }> {
  const db = getDb();
  const [f, e, c] = await Promise.all([
    db.from("stock_features").select("*").eq("symbol", symbol).eq("source", source),
    db.from("stock_events").select("*").eq("symbol", symbol).order("as_of", { ascending: false }),
    db.from("stock_chunks").select("*").eq("symbol", symbol),
  ]);
  return {
    features: (f.data || []) as any[],
    events: (e.data || []) as any[],
    chunks: (c.data || []) as any[],
  };
}

/** Classify an announcement/news item and insert a deduped stock_events row. */
export async function ingestEvent(
  input: ClassifyInput,
  opts: { years?: number } = {},
): Promise<{ id?: number; skipped: "dedup" | "none" | "empty"; error?: string }> {
  const text = input.text.trim();
  if (!text) return { skipped: "empty" };
  const _hash = docHash(text, "event", input.source_ref);
  const db = getDb();

  // Already classified? Idempotent by the same doc_hash key.
  const { data: existing } = await db.from("stock_events").select("id").eq("doc_hash", _hash).maybeSingle();
  if (existing?.id) return { id: existing.id, skipped: "dedup" };

  const model = input.model || config.rubricCompilerModel;
  if (!model) return { skipped: "none", error: "no classifier model configured" };
  const { buildModel } = await import("../agent.js");
  const llmKeys = (input.llmKeys || {}) as Record<string, string | undefined>;
  const { apiKey } = keyPool.pickKey(model, llmKeys);
  const finalModel = buildModel(model, llmKeys, apiKey);

  const classify = await generateObject({
    model: finalModel,
    schema: EventSchema,
    system: `You classify exactly one exchange announcement/news item for the v2 knowledge base.`,
    prompt: `Classify this announcement:\n\n${text.slice(0, 4000)}`,
    temperature: 0,
  });

  const row = {
    symbol: input.symbol,
    source: input.source,
    doc_hash: _hash,
    type: classify.object.type,
    materiality: classify.object.materiality,
    sentiment: classify.object.sentiment,
    summary: classify.object.summary,
    raw_excerpt: text.slice(0, 2000),
    as_of: input.as_of,
    source_ref: input.source_ref,
    model: String(model),
    prompt_version: "event-v1",
  };
  const { data, error } = await db.from("stock_events").insert(row).select("id").maybeSingle();
  if (error) {
    if (String(error.code || error.message).includes("23505")) return { skipped: "dedup" }; // unique doc_hash
    return { skipped: "none", error: error.message };
  }
  return { id: data?.id, skipped: "none" };
}