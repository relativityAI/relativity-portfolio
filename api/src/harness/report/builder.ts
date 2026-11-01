/**
 * Report builder — chart-token resolution and template enforcement over the
 * typed ReportDocument.
 *
 * The canvas pipeline owns document construction; this module supplies the
 * assembly-time helpers: expanding chart `data` tokens into real series from
 * this run's archived payloads (or trace fallback), and injecting resolved
 * charts when a system prompt's `min_charts` rule demands them. extractJson
 * (fence-aware, jsonrepair) is shared with the structured JSON calls.
 */

import {
  countCharts,
  supGlyph,
  type ChartSpec,
  type ReportDocument,
  type Section,
  type Series,
} from "./document.js";
import type { TraceEvent } from "../types.js";
import { validateAgainstTemplate, type OutputTemplate } from "../system-prompts/catalog.js";
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
function barTime(b: Bar): number | null {
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

  // Object-form named series ({date, v} lists).
  if (t !== "price" && t !== "volume") {
    const named = o?.[t] ?? o?.[t.replace(/^sma/, "sma_")];
    if (Array.isArray(named) && named.length && typeof named[0] !== "number") {
      candidates.push(objPts(named, (p) => p?.v ?? p?.value));
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
  const series = tokens.flatMap((tok) => {
    for (const o of results) {
      const s = tokenSeries(tok, o);
      if (s) return s;
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
  for (const section of doc.sections) {
    if (section.type === "chart") {
      section.spec = resolveSpec(section.spec, results);
      if (section.panels?.length) section.panels = section.panels.map((p) => resolveSpec(p, results));
    }
    if (section.type === "compare") {
      // Compare sides are ChartSpecs or diagrams; only charts can carry tokens.
      if ("kind" in section.before) section.before = resolveSpec(section.before, results);
      if ("kind" in section.after) section.after = resolveSpec(section.after, results);
    }
  }
  return doc;
}

/** Real-data tokens for injected charts, in usefulness order. */
const INJECT_TOKENS = ["price", "volume", "price, sma200"];

/**
 * Template enforcement that needs this run's data: when a template demands
 * `min_charts` and the document falls short, inject a resolved price/volume
 * chart built from real tool results — never a placeholder.
 */
export function enforceTemplate(
  doc: ReportDocument,
  tpl: OutputTemplate | null | undefined,
  trace: TraceEvent[],
  payloads?: { callId: string; payload: unknown }[],
): ReportDocument {
  if (!tpl?.min_charts) return doc;
  const missing = tpl.min_charts - countCharts(doc);
  if (missing <= 0) return doc;
  const archived = (payloads ?? [])
    .map((p) => p.payload)
    .filter((r): r is any => r != null && typeof r === "object")
    .reverse();
  const results = archived.length ? archived : dataResults(trace);
  const injected: ReportDocument["sections"] = [];
  for (let i = 0; i < missing; i++) {
    const spec = resolveSpec({ kind: "line", data: INJECT_TOKENS[Math.min(i, INJECT_TOKENS.length - 1)] }, results);
    if (!spec.series?.length) break;
    injected.push({ type: "chart", title: i === 0 ? "Price" : `Supporting chart ${i}`, spec });
  }
  if (!injected.length) return doc;
  // Keep citations last, as the contract asks.
  const at = doc.sections.map((s) => s.type).lastIndexOf("citations");
  doc.sections.splice(at < 0 ? doc.sections.length : at, 0, ...injected);
  return doc;
}

/**
 * Deterministic figure rendering: every chart section gains `svgs`
 * (self-contained, theme-var'd — see figure-kit). Runs at assembly after
 * attachChartData/enforceTemplate so tokens are already resolved. Atomic
 * per section: all-or-nothing keeps svgs index-aligned with [spec, ...panels],
 * and a candle among them hands the whole section to the client path
 * (live MarketChart).
 */
export function renderFigures(doc: ReportDocument): void {
  for (const s of doc.sections) {
    if (s.type !== "chart") continue;
    const svgs = [s.spec, ...(s.panels ?? [])].map((sp) => renderFigure(sp, { label: s.title, unit: s.measure, ink: s.color }));
    if (svgs.length && svgs.every((x): x is string => x != null)) s.svgs = svgs;
  }
}

// Matches `[src:<any_id>]` (agents invent ids like s1, src_009…) and the
// legacy bracketless `[src_<id>]` form.
const TOKEN = /\[src:(\w+)\]|\[src_(\w+)\]/g;

/**
 * Citations as footnotes (never a separate sources list): resolve every
 * inline citation to a Source, assign first-citation numbers, rewrite the
 * `[src:…]` tokens in prose to superscript markers, and store the ordered
 * ids on `doc.footnotes`. Runs at assembly — renderers only print numbers.
 * Resolution tolerates id namespacing (src_019 → src_019_6): exact match,
 * else first id the token is a base of.
 */
export function computeFootnotes(doc: ReportDocument): void {
  const resolve = (id: string): string | undefined =>
    doc.sources.find((x) => x.id === id)?.id ?? doc.sources.find((x) => x.id.startsWith(id + "_"))?.id;
  const order: string[] = [];
  const note = (raw?: string) => {
    if (!raw) return;
    const id = resolve(raw);
    if (id && !order.includes(id)) order.push(id);
  };
  const prose = (sec: Section): sec is Extract<Section, { type: "paragraph" } | { type: "callout" }> =>
    sec.type === "paragraph" || sec.type === "callout";
  for (const sec of doc.sections) {
    if (prose(sec)) {
      for (const m of (sec.text ?? "").matchAll(TOKEN)) note(m[1] ?? `src_${m[2]}`);
      for (const h of sec.highlights ?? []) note(h.sourceId);
    } else if (sec.type === "quote") note(sec.sourceId);
    else if (sec.type === "table") {
      // Agents cite inside table cells — those tokens are citations too.
      for (const m of (sec.caption ?? "").matchAll(TOKEN)) note(m[1] ?? `src_${m[2]}`);
      for (const row of sec.rows) for (const cell of row) if (typeof cell === "string") for (const m of cell.matchAll(TOKEN)) note(m[1] ?? `src_${m[2]}`);
    }
  }
  if (order.length) {
    const sup = (id: string | undefined) => {
      const r = id ? resolve(id) : undefined;
      const n = r ? order.indexOf(r) : -1;
      return n >= 0 ? supGlyph(n + 1) : "";
    };
    for (const sec of doc.sections) {
      if (sec.type === "table") {
        const sub = (t: string) => t.replace(TOKEN, (whole, a?: string, b?: string) => sup(a ?? `src_${b}`) || whole);
        if (sec.caption) sec.caption = sub(sec.caption);
        sec.rows = sec.rows.map((row) => row.map((cell) => (typeof cell === "string" ? sub(cell) : cell)));
        continue;
      }
      if (sec.type === "chart" && sec.caption) {
        sec.caption = sec.caption.replace(TOKEN, (whole, a?: string, b?: string) => sup(a ?? `src_${b}`) || whole);
        continue;
      }
      if (!prose(sec)) continue;
      const tokened = new Set(
        [...sec.text.matchAll(TOKEN)].map((m) => resolve(m[1] ?? `src_${m[2]}`)).filter((x): x is string => !!x),
      );
      let text = sec.text.replace(TOKEN, (whole, a?: string, b?: string) => sup(a ?? `src_${b}`) || whole);
      // a highlight whose source has no token in this paragraph gets the
      // marker right after its span (first occurrence)
      for (const h of sec.highlights ?? []) {
        const r = h.sourceId ? resolve(h.sourceId) : undefined;
        if (!r || !h.text || tokened.has(r) || !text.includes(h.text)) continue;
        text = text.replace(h.text, h.text + sup(r));
      }
      sec.text = text;
    }
  }
  doc.footnotes = order.length ? order : undefined;
}

/**
 * Inline clickable citations — the skill override for report-structures that
 * say "No footnotes" (frontmatter `citations: inline`). Rewrites `[src:…]`
 * tokens in prose to `[label](url)` links in place, turns sourceId highlights
 * into links when their paragraph carries no token for that source, links
 * quotes' sourceId, and leaves doc.footnotes unset — no superscript markers,
 * no end-of-report footnote block. Called at assembly INSTEAD of
 * computeFootnotes, after number verify (links are prose, never parsed).
 */
export function computeInlineCitations(doc: ReportDocument): void {
  const resolve = (id: string): string | undefined =>
    doc.sources.find((x) => x.id === id)?.id ?? doc.sources.find((x) => x.id.startsWith(id + "_"))?.id;
  const source = (id?: string): (typeof doc.sources)[number] | undefined => {
    const r = id ? resolve(id) : undefined;
    return r ? doc.sources.find((x) => x.id === r) : undefined;
  };
  /** token → inline link; unknown id keeps the token (validation flags it). */
  const tokenText = (raw?: string): string | undefined => {
    const s = source(raw);
    if (!s) return undefined;
    return s.url ? `[${s.label}](${s.url})` : s.label;
  };
  const prose = (sec: Section): sec is Extract<Section, { type: "paragraph" } | { type: "callout" }> =>
    sec.type === "paragraph" || sec.type === "callout";
  for (const sec of doc.sections) {
    if (prose(sec)) {
      const tokened = new Set(
        [...(sec.text ?? "").matchAll(TOKEN)].map((m) => resolve(m[1] ?? `src_${m[2]}`)).filter((x): x is string => !!x),
      );
      let text = (sec.text ?? "").replace(TOKEN, (whole, a?: string, b?: string) => tokenText(a ?? `src_${b}`) || whole);
      // Highlight whose source has no token here: the span itself becomes the
      // link (skill rule: "link source names, numbers, … directly").
      for (const h of sec.highlights ?? []) {
        const r = h.sourceId ? resolve(h.sourceId) : undefined;
        if (!r || !h.text || tokened.has(r) || !text.includes(h.text)) continue;
        const s = doc.sources.find((x) => x.id === r);
        if (s?.url) text = text.replace(h.text, `[${h.text}](${s.url})`);
      }
      sec.text = text;
    } else if (sec.type === "quote") {
      const s = source(sec.sourceId);
      if (s?.url && !sec.text.includes(s.url)) sec.text = `${sec.text} — [${s.label}](${s.url})`;
    } else if (sec.type === "table") {
      const sub = (t: string) => t.replace(TOKEN, (whole, a?: string, b?: string) => tokenText(a ?? `src_${b}`) || whole);
      if (sec.caption) sec.caption = sub(sec.caption);
      sec.rows = sec.rows.map((row) => row.map((cell) => (typeof cell === "string" ? sub(cell) : cell)));
    } else if (sec.type === "chart" && sec.caption) {
      sec.caption = sec.caption.replace(TOKEN, (whole, a?: string, b?: string) => tokenText(a ?? `src_${b}`) || whole);
    }
  }
  doc.footnotes = undefined;
}
