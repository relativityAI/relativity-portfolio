/**
 * Source archiving — harness-driven offload of data-tool results into the
 * knowledge base (the model never has to remember to archive).
 *
 * Every structured result: full payload → knowledge_base/sources/raw/<name>.json (pretty-
 * printed; excluded from DB compaction — the trace persists it), generated
 * stub → knowledge_base/sources/<name>.json with callId, derived facts, recent table rows
 * and seriesKeys. File names are human-readable (SYMBOL_tool_args), so fs_ls
 * /knowledge_base/sources tells the model what it has without reading. The result
 * handed to the model is the compact stub view plus a _source pointer —
 * scalars, series stats AND the last rows of each table (dates included), so
 * prose citations never require an fs_read. Chart data is injected from the
 * KB at assembly (attachChartData), not from prose.
 */

import { createHash } from "node:crypto";
import { unwrapResult } from "../report/builder.js";
import { loadAgentConfig } from "../config.js";
import type { Workspace } from "./fs.js";
import { PATHS } from "./paths.js";

const SNIPPET_CAP = 2_048;
const SERIES_MIN_POINTS = 20;
const MAX_SERIES = 25;
const MAX_ROW_PREVIEWS = 6;
const ROWS_ALL_MAX = 12; // show every row when the table is this small
const ROWS_TAIL = 6; // otherwise show the LAST n (recent rows are what prose cites)
const ROW_PREVIEW_CHARS = 3_500; // total inline-row budget per source
// Prose results (non-JSON strings, MCP text blocks) bypass the structured
// offload above — over the threshold they spill to /knowledge_base/tool-output/
// and the model gets a head preview + fs_read pointer instead of the whole
// text. Caps live in config/agent.yaml (read per call, live; defaults in
// AGENT_CONFIG_DEFAULT).

export interface SourceStub {
  id: string;
  callId: string;
  tool: string;
  args: unknown;
  symbol?: string;
  capturedAt: string;
  snippet: string;
  derived: DerivedFacts;
  /** Compact tail-of-table previews (dates included) — prose never needs a re-read. */
  rows?: RowPreview[];
  seriesKeys: string[];
  rawPath: string;
}

export interface RowPreview {
  /** Dotted path of the array in the payload, e.g. "income_statements". */
  key: string;
  /** Total row count in the payload. */
  total: number;
  /** The rows shown (all of them for small tables, the last N for long ones). */
  rows: Record<string, unknown>[];
}

export interface DerivedFacts {
  /** Top-level scalar metrics, e.g. { rsi_14: 38.98 }. */
  scalars?: Record<string, number>;
  /** Numeric arrays ≥ SERIES_MIN_POINTS. */
  series?: { key: string; n: number; first: number; last: number; min: number; max: number; changePct: number }[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function seriesStats(key: string, nums: number[]): NonNullable<DerivedFacts["series"]>[number] {
  const first = nums[0];
  const last = nums[nums.length - 1];
  let min = first;
  let max = first;
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return { key, n: nums.length, first: round2(first), last: round2(last), min: round2(min), max: round2(max), changePct: first === 0 ? 0 : round2(((last - first) / Math.abs(first)) * 100) };
}

/** Pull derived scalars + numeric series out of a payload (generic, tool-agnostic). */
export function deriveFacts(payload: unknown): { derived: DerivedFacts; seriesKeys: string[] } {
  const scalars: Record<string, number> = {};
  const series: NonNullable<DerivedFacts["series"]> = [];
  const seriesKeys: string[] = [];

  const walk = (val: unknown, path: string, depth: number): void => {
    if (depth > 5 || series.length + seriesKeys.length > MAX_SERIES * 2) return;
    if (typeof val === "number" && Number.isFinite(val)) {
      if (path && Object.keys(scalars).length < 60) scalars[path] = round2(val);
      return;
    }
    if (Array.isArray(val)) {
      if (val.length >= SERIES_MIN_POINTS && val.every((x) => typeof x === "number" && Number.isFinite(x))) {
        seriesKeys.push(path);
        series.push(seriesStats(path, val as number[]));
        return;
      }
      // array of point objects ({v|value} or OHLCV bars with close)
      if (val.length >= SERIES_MIN_POINTS && val.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
        const pick = (o: Record<string, unknown>): number | null => {
          for (const k of ["v", "value", "close", "Close"]) if (typeof o[k] === "number") return o[k];
          return null;
        };
        const nums = (val as Record<string, unknown>[]).map(pick);
        if (nums.every((n): n is number => typeof n === "number")) {
          seriesKeys.push(path);
          series.push(seriesStats(path, nums));
        }
      }
      return;
    }
    if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(payload, "", 0);

  return {
    derived: {
      scalars: Object.keys(scalars).length ? scalars : undefined,
      series: series.length ? series.slice(0, MAX_SERIES) : undefined,
    },
    seriesKeys: seriesKeys.slice(0, MAX_SERIES),
  };
}

/** Keep only scalar fields of a table row; long strings get truncated. */
function pickRowScalars(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(row)) {
    if (n >= 30) break;
    if (v == null || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      n++;
    } else if (typeof v === "string") {
      out[k] = v.length > 100 ? `${v.slice(0, 100)}…` : v;
      n++;
    }
  }
  return out;
}

/**
 * Compact previews of every table in the payload — small tables in full,
 * long ones as the last N rows (recent rows are what prose cites, and they
 * carry the dates the derived scalars drop). Budget-capped so a wide payload
 * can't flood the model's context.
 */
export function extractRowPreviews(payload: unknown): RowPreview[] {
  const out: RowPreview[] = [];
  let budget = ROW_PREVIEW_CHARS;
  const walk = (val: unknown, path: string, depth: number): void => {
    if (depth > 4 || budget <= 0 || out.length >= MAX_ROW_PREVIEWS) return;
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      val.length <= 500 &&
      val.every((x) => x && typeof x === "object" && !Array.isArray(x))
    ) {
      const rows = val.map((r) => pickRowScalars(r as Record<string, unknown>));
      if (rows.some((r) => Object.keys(r).length > 0)) {
        const show = rows.length <= ROWS_ALL_MAX ? rows : rows.slice(-ROWS_TAIL);
        const chunk = JSON.stringify(show);
        if (chunk.length <= budget) {
          budget -= chunk.length;
          out.push({ key: path || "rows", total: rows.length, rows: show });
        }
      }
      return;
    }
    if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(payload, "", 0);
  return out;
}

/** Words that make a query slug unreadable without carrying meaning. */
const SLUG_STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "at", "with", "vs", "by", "is", "are",
]);

/** First meaningful query words as a filename slug: "Apple fiscal 2026 full year results" → "apple-fiscal-2026-results". */
function querySlug(query: string): string {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((w) => w && !SLUG_STOPWORDS.has(w));
  const slug = words.slice(0, 6).join("-").slice(0, 48).replace(/-+$/g, "");
  return slug;
}

/** URL → `sec.gov_aapl-10k.htm` (host + last path segment; query string dropped). */
function urlSlug(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    return last ? `${host}_${last}` : host;
  } catch {
    return "";
  }
}

/**
 * Readable, unique file base: SYMBOL_tool[_query-slug|_discriminator] — fs_ls
 * tells the model what every source holds without opening it:
 *   AAPL_web_search_apple-fiscal-2026-quarterly-results.json
 *   AAPL_get_financials_annual.json
 */
function sourceFileBase(ws: Workspace, input: ArchiveInput): string {
  const args = (input.args && typeof input.args === "object" ? input.args : {}) as Record<string, unknown>;
  const parts = [input.symbol || "run", input.tool];
  if (typeof args.query === "string" && args.query.trim()) {
    const slug = querySlug(args.query);
    if (slug) parts.push(slug);
  }
  if (typeof args.url === "string" && args.url.trim()) {
    // web_fetch sources: host + last path segment read as a name —
    // AAPL_web_fetch_sec.gov_aapl-10k.htm, not AAPL_web_fetch-8.
    const slug = urlSlug(args.url);
    if (slug) parts.push(slug);
  }
  for (const k of ["period", "interval", "range", "type", "statement", "section", "ticker", "tf"]) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  const base = parts.join("_").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
  if (ws.read(`${PATHS.sources}/${base}.json`) == null) return base;
  for (let n = 2; n < 100; n++) {
    const cand = `${base}-${n}`;
    if (ws.read(`${PATHS.sources}/${cand}.json`) == null) return cand;
  }
  return base;
}

/**
 * No evidence to archive: empty search outcomes (stuffing Sources with
 * "returned zero results" entries the model then cites) and tool failures
 * ({error: …} — a failed fetch is not a source). Hand both back untouched
 * (no KB id, no file).
 */
function hasNoEvidence(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { count?: unknown; results?: unknown; error?: unknown };
  if (typeof p.error === "string" && p.error.trim()) return true;
  return p.count === 0 && Array.isArray(p.results) && p.results.length === 0;
}

export interface ArchiveInput {
  tool: string;
  args: unknown;
  result: unknown;
  symbol: string;
}

/** The prose inside a tool result: a plain string or an MCP text block. */
function proseText(res: unknown): string | null {
  if (typeof res === "string") return res;
  if (res && typeof res === "object" && Array.isArray((res as any).content)) {
    const t = (res as any).content.find((c: any) => c?.type === "text")?.text;
    if (typeof t === "string") return t;
  }
  return null;
}

/** Offload oversized prose: full text to the workspace, preview + pointer back. */
function spillProse(ws: Workspace, text: string, headChars: number): Record<string, unknown> {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const path = `${PATHS.toolOutput}/${hash}.md`;
  ws.write(path, text);
  return {
    message: `Tool output stored at ${path} (${text.length} chars). fs_read it (paginated) for the rest.`,
    path,
    total_chars: text.length,
    head: text.slice(0, headChars),
  };
}

/**
 * Archive one structured data-tool result. Prose (non-JSON) results pass
 * through unchanged — nothing to archive. Returns the compact view to hand to
 * the model: the derived stub summary (scalars, series stats, recent table
 * rows with dates) plus a `_source` pointer. The full payload stays in the KB
 * at `rawPath` and is only worth fs_reading for raw series bars the summary
 * doesn't carry.
 */
export function archiveResult(ws: Workspace, input: ArchiveInput): unknown {
  const payload = unwrapResult(input.result);
  if (payload == null) {
    // Prose payload: oversized → spill; otherwise hand through untouched.
    const prose = proseText(input.result);
    if (prose) {
      const limits = loadAgentConfig().limits;
      if (prose.length >= limits.spillThresholdChars) return spillProse(ws, prose, limits.spillHeadChars);
    }
    return input.result;
  }
  if (typeof payload !== "object") return input.result;
  if (hasNoEvidence(payload)) return input.result;
  let raw: string;
  try {
    raw = JSON.stringify(payload, null, 1);
  } catch {
    return input.result;
  }
  if (!raw || raw === "{}" || raw === "[]") return input.result;

  const id = ws.nextSourceId();
  const base = sourceFileBase(ws, input);
  const rawPath = `${PATHS.raw}/${base}.json`;
  const stubPath = `${PATHS.sources}/${base}.json`;
  ws.write(rawPath, raw);

  const { derived, seriesKeys } = deriveFacts(payload);
  const rows = extractRowPreviews(payload);
  const stub: SourceStub = {
    id,
    callId: id,
    tool: input.tool,
    args: input.args,
    symbol: input.symbol,
    capturedAt: new Date().toISOString(),
    snippet: raw.slice(0, SNIPPET_CAP),
    derived,
    rows: rows.length ? rows : undefined,
    seriesKeys,
    rawPath,
  };
  ws.write(stubPath, JSON.stringify(stub, null, 1));
  ws.registerStub(stub, payload);

  // Compact KB view for the model — scalars + series stats + recent table
  // rows (dates included) + the payload head (prose sources store their text
  // in strings the row/scalar extractors drop — without this the agent
  // fs_reads the raw file just to see the snippets).
  return {
    _source: { id, path: stubPath },
    tool: input.tool,
    args: input.args,
    scalars: derived.scalars ?? {},
    series: (derived.series ?? []).map((s) => ({ key: s.key, n: s.n, first: s.first, last: s.last, min: s.min, max: s.max, changePct: s.changePct })),
    seriesKeys,
    rows: rows.length ? rows : undefined,
    snippet: raw.slice(0, SNIPPET_CAP),
    note: `This summary carries the rows and dates prose needs. fs_read the full payload at ${rawPath} only for rows or fields beyond this preview (paginated). Cite this source as [src:${id}].`,
  };
}
