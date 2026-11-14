/**
 * Report builder — chart-token resolution and system-prompt rules over the
 * typed ReportDocument.
 *
 * The canvas pipeline owns document construction; this module supplies the
 * assembly-time helpers: expanding chart `data` tokens into real series from
 * this run's archived payloads (or trace fallback). extractJson (fence-aware,
 * jsonrepair) is shared with the structured JSON calls.
 */

import {
  allBlocks,
  type ChartSpec,
  type ReportDocument,
  type Series,
} from "./document.js";
import type { TraceEvent } from "../types.js";
import { renderFigure } from "./figure-kit.js";
import { jsonrepair } from "jsonrepair";

export function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate || !candidate.trim().startsWith("{")) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    // Models garble JSON constantly (unquoted values, markdown) — jsonrepair
    // is battle-tested for exactly this; hand-rolled regex would be worse.
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      return null;
    }
  }
}

// ponytail: fixed window. 320 bars inflate every stored report; 250 ≈ a year of
// daily bars (or 5y weekly). Make it per-chart if a caller ever wants otherwise.
const MAX_BARS = 250;

type Bar = Record<string, unknown>;
type Pt = { t: number; v: number; o?: number; h?: number; l?: number };

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const isNums = (a: unknown): a is number[] => Array.isArray(a) && a.length > 0 && typeof a[0] === "number";

/** epoch seconds from a `date` (YYYY-MM-DD), a `t`, or a `time` field. */
export function barTime(b: Bar): number | null {
  if (typeof b.t === "number") return b.t;
  const raw = b.date ?? b.time;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

/** Unwrap an MCP tool result envelope; plain REST results pass through. */
export function unwrapResult(res: unknown): any | null {
  // Text-only MCP payloads arrive as a JSON string (adapter falls back to
  // content[0].text) — parsing them here is what lets text-shaped tools feed charts.
  if (typeof res === "string") {
    try {
      return JSON.parse(res);
    } catch {
      return null; // prose payload — no structured data to chart from
    }
  }
  if (!res || typeof res !== "object") return null;
  const o = res as any;
  if (o.structuredContent && typeof o.structuredContent === "object") return o.structuredContent;
  if (Array.isArray(o.content)) {
    const text = o.content.find((c: any) => c?.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return null; // prose payload — no structured data to chart from
      }
    }
    return null;
  }
  return o;
}

/** Newest-first OK tool results, unwrapped — whatever tools this run had. */
function dataResults(trace: TraceEvent[]): any[] {
  return trace
    .filter((e) => e.type === "tool_result" && e.status === "ok")
    .map((e) => unwrapResult((e as any).result))
    .filter((r) => r && typeof r === "object")
    .reverse();
}

/** OHLCV bars in whatever nesting the fetcher used. */
function barsIn(o: any): Bar[] | null {
  const cands = [
    o?.candles_recent,
    o?.bars,
    o?.daily,
    o?.sections?.price_history?.data?.daily,
    o?.sections?.price_history?.daily,
    o?.data,
  ];
  for (const c of cands) {
    if (Array.isArray(c) && c.length && c[0] && typeof c[0] === "object" && barTime(c[0]) != null) return c;
  }
  return null;
}

/** OHLCV bars → points; `v` is always close, with o/h/l riding along for candles. */
function ptsFromBars(bars: Bar[]): Pt[] {
  const out: Pt[] = [];
  for (const b of bars) {
    const t = barTime(b);
    const v = num(b.c ?? b.close);
    if (t == null || v == null) continue;
    const p: Pt = { t, v };
    const o = num(b.o ?? b.open);
    const h = num(b.h ?? b.high);
    const l = num(b.l ?? b.low);
    if (o != null) p.o = o;
    if (h != null) p.h = h;
    if (l != null) p.l = l;
    out.push(p);
  }
  return out;
}

/** Columnar OHLC (dates[] + open/high/low/close[]) → points, else null. */
function ptsFromColumnar(o: any): Pt[] | null {
  const dates = Array.isArray(o?.dates) ? o.dates : null;
  if (!dates || !isNums(o?.close)) return null;
  const open = isNums(o?.open) ? o.open : null;
  const high = isNums(o?.high) ? o.high : null;
  const low = isNums(o?.low) ? o.low : null;
  const out: Pt[] = [];
  for (let i = 0; i < dates.length; i++) {
    const t = barTime({ date: dates[i] });
    const v = num(o.close[i]);
    if (t == null || v == null) continue;
    const p: Pt = { t, v };
    if (open) p.o = open[i];
    if (high) p.h = high[i];
    if (low) p.l = low[i];
    out.push(p);
  }
  return out.length ? out : null;
}

function objPts(arr: any[], pick: (p: any) => any): Pt[] {
  return (Array.isArray(arr) ? arr : [])
    .map((p) => ({ t: barTime(p), v: pick(p) }))
    .filter((p): p is Pt => p.t != null && typeof p.v === "number");
}

function zipDates(dates: any[], vals: number[]): Pt[] {
  return dates
    .map((d, i) => ({ t: barTime({ date: d }), v: vals[i] }))
    .filter((p): p is Pt => p.t != null && typeof p.v === "number");
}

/**
 * Domain token → labeled series points from one tool result. Reads shapes, not
 * tool names: columnar time series (dates[] + numeric arrays), OHLCV bars, and
 * object-form named series ({date, v} lists).
 */
function tokenSeries(token: string, o: any): Series[] | null {
  const t = token.trim().toLowerCase();
  const label = t === "price" ? "close" : t === "volume" ? "volume" : t.toUpperCase();
  const dates: any[] | null = Array.isArray(o?.dates) ? o.dates : null;

  // Candidates run in preference order: sources that carry OHLC first, so a
  // candle request gets real candles instead of a close-only line.
  const candidates: Pt[][] = [];

  // OHLCV bars carry price and volume only.
  const bars = barsIn(o);
  if (bars && t === "price") candidates.push(ptsFromBars(bars));
  if (bars && t === "volume") candidates.push(objPts(bars, (p) => p?.volume ?? p?.v));

  // Columnar OHLC (indicator tools ship open/high/low next to close).
  if (t === "price") {
    const col = ptsFromColumnar(o);
    if (col) candidates.push(col);
  }

  // Columnar series: a date axis plus an aligned numeric array.
  const arr =
    t === "price"
      ? o?.close
      : t === "volume"
        ? o?.volume
        : t === "rsi14"
          ? (o?.indicators?.rsi_14 ?? o?.rsi_14 ?? o?.rsi14)
          : (o?.indicators?.[`sma_${t.slice(3)}`] ?? o?.[`sma_${t.slice(3)}`] ?? o?.[t]);
  if (dates && isNums(arr)) candidates.push(zipDates(dates, arr));

  // Object-form named series: bar-shaped rows ({date, close, o/h/l}) become
  // real OHLCV points; {date, v} lists keep the scalar pick. (Yahoo bars use
  // v for VOLUME — picking v off a bar would chart volume as price.)
  if (t !== "price" && t !== "volume") {
    const named = o?.[t] ?? o?.[t.replace(/^sma/, "sma_")];
    if (Array.isArray(named) && named.length && typeof named[0] !== "number") {
      const barPts = named[0] && typeof named[0] === "object" ? ptsFromBars(named) : [];
      candidates.push(barPts.length ? barPts : objPts(named, (p) => p?.v ?? p?.value));
    }
  }

  const first = candidates.find((c) => c.length);
  // ponytail: no local indicator math — overlay tokens (sma*, rsi*) resolve only
  // from a series-bearing tool result (the MCP's indicator/plot-history tools).
  return first ? [{ label, points: first.slice(-MAX_BARS) }] : null;
}

function resolveSpec(spec: ChartSpec, results: any[]): ChartSpec {
  const tokens = spec.data?.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens?.length) return spec;
  const series = tokens.flatMap((tok, i) => {
    for (const o of results) {
      const s = tokenSeries(tok, o);
      // agent-supplied positional name wins over the harness token label
      if (s) return s.map((x) => ({ ...x, label: spec.names?.[i] ?? x.label }));
    }
    return [];
  });
  if (!series.length) return spec;
  // Preserve the model's kind. Candles render natively only when the resolved
  // points carry o/h/l; otherwise the UI falls back to a line.
  return { ...spec, series, data: undefined };
}

/**
 * Expand chart `data` domain tokens into real series.
 *
 * D10: when workspace payloads are provided (FS-workspace runs), tokens
 * resolve through the archived payloads — one per stub, keyed by callId,
 * newest first (single-symbol runs; the latest call of a tool wins). The
 * trace scan remains the fallback for empty-KB / legacy-loop runs.
 */
export function attachChartData(
  doc: ReportDocument,
  trace: TraceEvent[],
  payloads?: { callId: string; payload: unknown }[],
): ReportDocument {
  const archived = (payloads ?? [])
    .map((p) => p.payload)
    .filter((r): r is any => r != null && typeof r === "object")
    .reverse(); // newest first, matching dataResults
  const results = archived.length ? archived : dataResults(trace);
  if (!results.length) return doc;
  for (const block of allBlocks(doc)) {
    if (block.type === "chart") {
      block.spec = resolveSpec(block.spec, results);
      if (block.panels?.length) block.panels = block.panels.map((p) => resolveSpec(p, results));
    }
    if (block.type === "compare") {
      // Compare sides are ChartSpecs or diagrams; only charts can carry tokens.
      if ("kind" in block.before) block.before = resolveSpec(block.before, results);
      if ("kind" in block.after) block.after = resolveSpec(block.after, results);
    }
  }
  return doc;
}

/** Real-data tokens for injected charts, in usefulness order. */
/**
 * Deterministic figure rendering: every chart block gains `svgs`
 * (self-contained, theme-var'd — see figure-kit). Runs at assembly after
 * attachChartData so tokens are already resolved. Atomic
 * per block: all-or-nothing keeps svgs index-aligned with [spec, ...panels].
 * Candles are skipped — the UI keeps its live MarketChart (hover readout);
 * dumpMarkdown renders them statically for the .md artifact.
 */
export function renderFigures(doc: ReportDocument): void {
  for (const block of allBlocks(doc)) {
    if (block.type !== "chart") continue;
    const specs = [block.spec, ...(block.panels ?? [])];
    if (specs.some((sp) => sp.kind === "candle")) continue;
    const svgs = specs.map((sp) => renderFigure(sp, { label: block.title, unit: block.measure, ink: block.color }));
    if (svgs.length && svgs.every((x): x is string => x != null)) block.svgs = svgs;
  }
}
