/**
 * marketdata — server-side price-history client for the technical-analysis
 * skill (decision D5).
 *
 * Primary source: Yahoo Finance chart API (no API key, 15-minute cache).
 * Graceful failure: any outage returns null and the pipeline degrades to
 * Voyager's indicator metrics (RSI/SMA in the snapshot). Chart data assembled
 * here is code-grounded — the LLM never types OHLCV values.
 */

import { log } from "./logger.js";

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistory {
  symbol: string;
  range: string;
  interval: string;
  candles: Candle[];
  sma20: { date: string; value: number | null }[];
  sma50: { date: string; value: number | null }[];
  sma200: { date: string; value: number | null }[];
  rsi14: { date: string; value: number | null }[];
  macd: { date: string; macd: number | null; signal: number | null; histogram: number | null }[];
  atr14: { date: string; value: number | null }[];
  bollinger: { date: string; upper: number | null; mid: number | null; lower: number | null }[];
  vwap: number;
  fifty_two_week: { high: number; low: number };
  fetched_at: string;
  source: "yahoo";
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CANDLES = 400; // ~1.5 years of trading days

const cache = new Map<string, { at: number; data: PriceHistory | null }>();

function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    out.push(i >= period - 1 ? Math.round((sum / period) * 10000) / 10000 : null);
  }
  return out;
}

/** Wilder's RSI (standard 14-period smoothing). */
function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function macdSeries(closes: number[], fast = 12, slow = 26, signalP = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const firstIdx = macdLine.findIndex((v) => v != null);
  if (firstIdx >= 0) {
    const valid = macdLine.slice(firstIdx).map((v) => v as number);
    const sig = ema(valid, signalP);
    for (let i = 0; i < sig.length; i++) signalLine[firstIdx + i] = sig[i];
  }
  const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null ? v - (signalLine[i] as number) : null));
  return { macdLine, signalLine, histogram };
}

/** Wilder's ATR (14-period). */
function atrSeries(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let a = 0;
  for (let i = 1; i <= period; i++) a += trs[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

function bollingerSeries(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] as number;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - m) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** Session VWAP over the available window (typical price × volume). */
function vwapOf(candles: Candle[]): number {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : 0;
}

/** Count weekdays between a YYYY-MM-DD date and today (exclusive of both endpoints' partial days). */
function tradingDaysOld(dateStr: string): number {
  const latest = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let count = 0;
  const d = new Date(latest);
  d.setDate(d.getDate() + 1);
  while (d.getTime() < today.getTime()) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number; currency?: string };
      timestamp?: number[];
      indicators?: {
        quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[];
      };
    }[];
    error?: unknown;
  };
}

/**
 * Fetch daily OHLCV + indicators for a symbol. Returns null on any failure —
 * callers must degrade (never fabricate).
 */
export async function getPriceHistory(symbol: string, range = "2y", source?: string): Promise<PriceHistory | null> {
  const key = `${symbol}:${range}:${source || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = await fetchYahoo(symbol, range, source);
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchYahoo(symbol: string, range: string, source?: string): Promise<PriceHistory | null> {
  // Yahoo distinguishes listings by exchange suffix — an NSE ticker
  // queried bare ("GLAND") 404s with "No data found, symbol may be
  // delisted", which grounded every price chart on nothing.
  const ex = (source || "").toLowerCase();
  const q = ex === "nse" ? `${symbol}.NS` : ex === "bse" ? `${symbol}.BO` : symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q)}?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; RelativityPortfolio/1.0)" },
    });
    if (!res.ok) {
      log.warn("marketdata", `yahoo ${symbol} status ${res.status}`);
      return null;
    }
    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!ts?.length || !q?.close) return null;

    const candles: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (c == null) continue; // skip null trading days
      candles.push({
        date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: o ?? c,
        high: h ?? c,
        low: l ?? c,
        close: c,
        volume: q.volume?.[i] ?? 0,
      });
    }
    if (candles.length < 30) return null;

    // Freshness SLA (WS-4): reject when the latest candle is >1 trading day
    // old (weekend-aware). Stale candles must never be labelled "recent".
    // ponytail: weekday-only check — a holiday calendar would need a market
    // holiday feed; add one if a long-weekend stale candle ever ships.
    const latestDate = candles[candles.length - 1].date;
    if (tradingDaysOld(latestDate) > 1) {
      log.warn("marketdata", `stale price data for ${symbol}: latest candle ${latestDate} is ${tradingDaysOld(latestDate)} trading days old`);
      return null;
    }

    const trimmed = candles.slice(-MAX_CANDLES);
    const closes = trimmed.map((c) => c.close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r14 = rsi(closes, 14);
    const macd = macdSeries(closes);
    const atr14 = atrSeries(trimmed);
    const boll = bollingerSeries(closes);

    const highs = trimmed.map((c) => c.high);
    const lows = trimmed.map((c) => c.low);

    return {
      symbol: symbol.toUpperCase(),
      range,
      interval: "1d",
      candles: trimmed,
      sma20: trimmed.map((c, i) => ({ date: c.date, value: s20[i] })),
      sma50: trimmed.map((c, i) => ({ date: c.date, value: s50[i] })),
      sma200: trimmed.map((c, i) => ({ date: c.date, value: s200[i] })),
      rsi14: trimmed.map((c, i) => ({ date: c.date, value: r14[i] })),
      macd: trimmed.map((c, i) => ({ date: c.date, macd: macd.macdLine[i], signal: macd.signalLine[i], histogram: macd.histogram[i] })),
      atr14: trimmed.map((c, i) => ({ date: c.date, value: atr14[i] })),
      bollinger: trimmed.map((c, i) => ({ date: c.date, upper: boll.upper[i], mid: boll.mid[i], lower: boll.lower[i] })),
      vwap: vwapOf(trimmed),
      fifty_two_week: {
        high: Math.max(...highs.slice(-252)),
        low: Math.min(...lows.slice(-252)),
      },
      fetched_at: new Date().toISOString(),
      source: "yahoo",
    };
  } catch (e: any) {
    log.warn("marketdata", `yahoo ${symbol} failed: ${e?.message}`);
    return null;
  }
}

// Broad-market indices per tracked market (Yahoo tickers). The old Voyager
// /macro endpoint no longer exists; the snapshot is assembled in code from the
// same live chart API the price-history client already uses.
const MARKET_INDICES: Record<string, { symbol: string; label: string }[]> = {
  in: [
    { symbol: "%5ENSEI", label: "Nifty 50" },
    { symbol: "%5EBSESN", label: "Sensex" },
  ],
  us: [
    { symbol: "%5EGSPC", label: "S&P 500" },
    { symbol: "%5EIXIC", label: "Nasdaq Composite" },
  ],
};

export interface IndexSnapshot {
  label: string;
  symbol: string;
  last_close: number | null;
  as_of: string | null;
  return_1m: number | null;
  return_6m: number | null;
}

export interface MacroSnapshot {
  market: string;
  indices: IndexSnapshot[];
  market_direction: string;
  fetched_at: string;
  source: "yahoo";
}

/**
 * Assemble the macro snapshot in code: index levels and trailing returns for
 * the tracked market, plus a plain-language direction call per index. Every
 * figure comes from real candles; a failed index is omitted, never estimated.
 */
export async function getMacroSnapshot(country = "in"): Promise<MacroSnapshot | { unavailable: true; reason: string }> {
  const indices = MARKET_INDICES[country] || MARKET_INDICES.in;
  const snaps: IndexSnapshot[] = [];
  for (const idx of indices) {
    const h = await getPriceHistory(idx.symbol, "1y");
    if (!h || h.candles.length < 30) continue; // degrade per-index, never fake
    const candles = h.candles;
    const last = candles[candles.length - 1];
    const back = (n: number): number | null =>
      candles.length > n && candles[candles.length - 1 - n].close > 0
        ? Math.round((last.close / candles[candles.length - 1 - n].close - 1) * 1000) / 10
        : null;
    snaps.push({
      label: idx.label,
      symbol: idx.symbol.replace(/%5E/, "^"),
      last_close: last.close,
      as_of: last.date,
      return_1m: back(21),
      return_6m: back(126),
    });
  }
  if (snaps.length === 0) {
    return { unavailable: true, reason: "index price history unavailable" };
  }
  // Direction call per index from the trailing 1m/6m returns — a plain-language
  // read the analyst can quote, not a recommendation.
  const direction = (s: IndexSnapshot): string => {
    const r1 = s.return_1m ?? 0;
    const r6 = s.return_6m ?? 0;
    if (r1 >= 3 && r6 >= 5) return "uptrend";
    if (r1 <= -3 && r6 <= -5) return "downtrend";
    if (Math.abs(r1) < 2) return "range-bound";
    return r1 > 0 ? "drifting up" : "drifting down";
  };
  return {
    market: country,
    indices: snaps.map((s) => ({ ...s, direction: direction(s) })) as IndexSnapshot[],
    market_direction: snaps.map((s) => `${s.label}: ${direction(s)}`).join("; "),
    fetched_at: new Date().toISOString(),
    source: "yahoo",
  };
}

/** Compact digest for analyst prompts — bounded, never the full candle list. */
/**
 * Minimal live-quote read for analysts: the last close, as-of date, 52-week
 * range and trailing returns. Sourced from the same cached Yahoo client as
 * the full price history (one fetch, 15-min cache), so a valuation skill
 * blocked on a missing snapshot price can still ground its ratios in a real
 * market price.
 */
export function quoteDigest(h: PriceHistory): Record<string, unknown> {
  const n = h.candles.length;
  const last = h.candles[n - 1];
  const pct = (v: number) => Math.round(v * 1000) / 10; // 0.1234 -> 12.3 (percent)
  return {
    symbol: h.symbol,
    price: last.close,
    as_of: last.date,
    currency_note: "price is in the instrument's listed currency",
    fifty_two_week: h.fifty_two_week,
    return_1m_pct: pct(ret(h.candles, 21)),
    return_3m_pct: pct(ret(h.candles, 63)),
    return_6m_pct: pct(ret(h.candles, 126)),
    source: h.source,
    fetched_at: h.fetched_at,
  };
}

export function priceHistoryDigest(h: PriceHistory): string {
  const n = h.candles.length;
  const last = h.candles[n - 1];
  const last50 = h.candles.slice(-50);
  const avgVol = last50.reduce((s, c) => s + c.volume, 0) / Math.max(1, last50.length);
  const rsiNow = [...h.rsi14].reverse().find((r) => r.value != null)?.value ?? null;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const pos52 = last.close > 0 ? (last.close - h.fifty_two_week.low) / Math.max(1e-9, h.fifty_two_week.high - h.fifty_two_week.low) : 0;
  return [
    `symbol=${h.symbol} points=${n} range=${h.range} source=${h.source}`,
    `last_close=${last.close} (${last.date})`,
    `sma20=${[...h.sma20].reverse().find((s) => s.value != null)?.value ?? "n/a"} sma50=${[...h.sma50].reverse().find((s) => s.value != null)?.value ?? "n/a"} sma200=${[...h.sma200].reverse().find((s) => s.value != null)?.value ?? "n/a"}`,
    `rsi14=${rsiNow ?? "n/a"}`,
    `avg_volume_50d=${Math.round(avgVol)}`,
    `52w_high=${h.fifty_two_week.high} 52w_low=${h.fifty_two_week.low} range_position=${pct(pos52)} of 52w range`,
    `returns: 1m=${pct(ret(h.candles, 21))} 3m=${pct(ret(h.candles, 63))} 6m=${pct(ret(h.candles, 126))}`,
  ].join("\n");
}

export function ret(candles: Candle[], back: number): number {
  if (candles.length <= back) return 0;
  const past = candles[candles.length - 1 - back].close;
  const now = candles[candles.length - 1].close;
  return past > 0 ? now / past - 1 : 0;
}

// ── Levels digest (WS-1) ──────────────────────────────────────────────────
// The Voyager /technicals report carries the level map as structured sections.
// This extracts support/resistance (with touch counts), entry zones, stop,
// TP1–TP3, R:R and invalidation IN CODE so the report never depends on the
// LLM reading raw tool JSON. Tolerant of the section shapes the feed emits —
// a missing section is null, never a guess.

export interface LevelsDigest {
  as_of: string | null;
  support: { level: number; touches: number }[];
  resistance: { level: number; touches: number }[];
  entry_zones: { low: number; high: number }[] | null;
  stop_loss: number | null;
  take_profit: { tp1: number | null; tp2: number | null; tp3: number | null };
  risk_reward: number | null;
  invalidation: number | null;
  available: boolean;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pull a level list out of a section payload — arrays of numbers or of {level|price, touches}. */
function levelList(data: any): { level: number; touches: number }[] {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.levels) ? data.levels : Array.isArray(data?.supports) ? data.supports : Array.isArray(data?.resistances) ? data.resistances : [];
  const out: { level: number; touches: number }[] = [];
  for (const item of arr) {
    if (typeof item === "number") {
      out.push({ level: item, touches: 0 });
    } else if (item && typeof item === "object") {
      const level = num(item.level ?? item.price ?? item.value);
      if (level != null) out.push({ level, touches: num(item.touches ?? item.touch_count) ?? 0 });
    }
  }
  return out;
}

function sectionData(report: any, name: string): any {
  const s = report?.sections?.[name];
  if (!s || s.status === "unavailable" || s.status === "error") return null;
  return s.data ?? null;
}

export function levelsDigest(technicalsReport: any): LevelsDigest {
  const empty: LevelsDigest = {
    as_of: null,
    support: [],
    resistance: [],
    entry_zones: null,
    stop_loss: null,
    take_profit: { tp1: null, tp2: null, tp3: null },
    risk_reward: null,
    invalidation: null,
    available: false,
  };
  if (!technicalsReport || typeof technicalsReport !== "object") return empty;

  const asOf = technicalsReport.as_of || technicalsReport.asOf || null;

  const sr = sectionData(technicalsReport, "support_resistance");
  const support = sr ? levelList(sr.supports ?? sr) : [];
  const resistance = sr ? levelList(sr.resistances ?? sr) : [];

  const ez = sectionData(technicalsReport, "entry_zones") ?? sectionData(technicalsReport, "entry_zone");
  let entryZones: { low: number; high: number }[] | null = null;
  if (ez) {
    const arr = Array.isArray(ez) ? ez : Array.isArray(ez.zones) ? ez.zones : [ez];
    entryZones = arr
      .map((z: any) => {
        const low = num(z?.low ?? z?.start ?? z?.lower);
        const high = num(z?.high ?? z?.end ?? z?.upper);
        return low != null && high != null ? { low, high } : null;
      })
      .filter(Boolean) as { low: number; high: number }[];
    if (!entryZones.length) entryZones = null;
  }

  const sl = sectionData(technicalsReport, "stop_loss");
  const stopLoss = sl ? num(sl.stop ?? sl.level ?? sl.value ?? sl) : null;

  const tp = sectionData(technicalsReport, "take_profit_targets") ?? sectionData(technicalsReport, "take_profit");
  let tp1: number | null = null;
  let tp2: number | null = null;
  let tp3: number | null = null;
  if (tp) {
    tp1 = num(tp.tp1 ?? tp.target1 ?? tp.first_target);
    tp2 = num(tp.tp2 ?? tp.target2 ?? tp.second_target);
    tp3 = num(tp.tp3 ?? tp.target3 ?? tp.third_target);
    if (tp1 == null && Array.isArray(tp)) {
      const vals = tp.map((t: any) => num(t?.level ?? t?.price ?? t?.value ?? t)).filter((v): v is number => v != null);
      [tp1, tp2, tp3] = [vals[0] ?? null, vals[1] ?? null, vals[2] ?? null];
    }
  }

  const rr = sectionData(technicalsReport, "risk_reward");
  const riskReward = rr ? num(rr.rr ?? rr.ratio ?? rr.value ?? rr) : null;

  const inv = sectionData(technicalsReport, "invalidation_levels") ?? sectionData(technicalsReport, "invalidation");
  const invalidation = inv ? num(inv.level ?? inv.value ?? inv) : null;

  const available = !!(support.length || resistance.length || tp1 != null || stopLoss != null);
  return {
    as_of: asOf,
    support,
    resistance,
    entry_zones: entryZones,
    stop_loss: stopLoss,
    take_profit: { tp1, tp2, tp3 },
    risk_reward: riskReward,
    invalidation,
    available,
  };
}

/** One-line digest of the levels map for prompts — every figure code-extracted. */
export function levelsDigestLine(d: LevelsDigest): string {
  if (!d.available) return "level map: INSUFFICIENT (no structured levels in the technicals report)";
  const parts: string[] = [];
  if (d.support.length) {
    const s = d.support[0];
    parts.push(`nearest support ${s.level}${s.touches ? ` (${s.touches} touches)` : ""}`);
  }
  if (d.resistance.length) {
    const r = d.resistance[0];
    parts.push(`nearest resistance ${r.level}${r.touches ? ` (${r.touches} touches)` : ""}`);
  }
  if (d.stop_loss != null) parts.push(`stop ${d.stop_loss}`);
  if (d.take_profit.tp1 != null) parts.push(`TP1 ${d.take_profit.tp1}`);
  if (d.risk_reward != null) parts.push(`R:R ${d.risk_reward}`);
  if (d.invalidation != null) parts.push(`invalidation ${d.invalidation}`);
  return `level map: ${parts.join("; ")}`;
}

// ── Facts pack (WS-1) ──────────────────────────────────────────────────────
// One deterministic digest of every figure the report may quote: price,
// SMA/RSI/MATR/Bollinger/VWAP from the price-history client, and the level
// map from the technicals report. Built in CODE and handed to the analyst and
// synthesis prompts as a fenced "quote these exactly" block — the LLM writes
// prose around these numbers only, never extracting them from raw tool JSON.

import type { VoyagerClient } from "./voyager.js";

export interface FactsPack {
  facts: string;
  stance: StanceResult;
  /** Deterministic interpretation tags (P0-2). Null when history is missing. */
  reading: Interpretation | null;
}

export async function buildFactsPack(
  voyager: VoyagerClient | null,
  symbol: string,
  source: string,
): Promise<FactsPack> {
  const lines: string[] = [];
  let mtf: { timeframe: string; bull: number; bear: number }[] = [];
  const history = await getPriceHistory(symbol, "2y", source);
  if (history) {
    const n = history.candles.length;
    const last = history.candles[n - 1];
    const lastVal = (arr: { date: string; value: number | null }[]) =>
      [...arr].reverse().find((s) => s.value != null)?.value ?? null;
    const rsiNow = lastVal(history.rsi14);
    const macdNow = [...history.macd].reverse().find((m) => m.macd != null);
    const atrNow = lastVal(history.atr14);
    const bollNow = [...history.bollinger].reverse().find((b) => b.upper != null);
    lines.push(`price=${last.close} as_of=${last.date}`);
    lines.push(`sma20=${lastVal(history.sma20) ?? "n/a"} sma50=${lastVal(history.sma50) ?? "n/a"} sma200=${lastVal(history.sma200) ?? "n/a"}`);
    lines.push(`rsi14=${rsiNow ?? "n/a"}`);
    if (macdNow) lines.push(`macd=${macdNow.macd?.toFixed(2) ?? "n/a"} signal=${macdNow.signal?.toFixed(2) ?? "n/a"} histogram=${macdNow.histogram?.toFixed(2) ?? "n/a"}`);
    if (atrNow != null) lines.push(`atr14=${atrNow.toFixed(2)}`);
    if (bollNow) lines.push(`bollinger upper=${bollNow.upper?.toFixed(2) ?? "n/a"} mid=${bollNow.mid?.toFixed(2) ?? "n/a"} lower=${bollNow.lower?.toFixed(2) ?? "n/a"}`);
    lines.push(`vwap=${history.vwap.toFixed(2)}`);
    lines.push(`52w_high=${history.fifty_two_week.high} 52w_low=${history.fifty_two_week.low}`);
  } else {
    lines.push("price history: INSUFFICIENT (unavailable)");
  }
  if (voyager) {
    try {
      const tech = await voyager.getTechnicals(symbol, { source });
      const digest = levelsDigest(tech);
      lines.push(levelsDigestLine(digest));
      if (digest.as_of) lines.push(`technicals_as_of=${digest.as_of}`);
      // MTF signal matrix — bull/bear counts per timeframe, for the
      // consistency gate's "MTF conflict must be stated" check.
      const mtfRaw = tech?.sections?.mtf_signal_matrix?.data;
      if (Array.isArray(mtfRaw) && mtfRaw.length >= 2) {
        mtf = mtfRaw
          .filter((r: any) => typeof r?.timeframe === "string" && r.state !== "unavailable")
          .map((r: any) => ({
            timeframe: String(r.timeframe),
            bull: typeof r.bull === "number" ? r.bull : 0,
            bear: typeof r.bear === "number" ? r.bear : 0,
          }));
        const rows = mtf.map((r) => `${r.timeframe}: ${r.bull} bull / ${r.bear} bear`);
        if (rows.length >= 2) lines.push(`mtf_matrix: ${rows.join("; ")}`);
      }
    } catch {
      lines.push("technicals report: INSUFFICIENT (unavailable)");
    }
  }
  // Volume signature: avg 50d and whether any recent day exceeded 1.5× —
  // the gate uses this to verify "above-average volume" claims.
  if (history && history.candles.length >= 50) {
    const last50 = history.candles.slice(-50);
    const avgVol = last50.reduce((s, c) => s + c.volume, 0) / last50.length;
    const maxVol = Math.max(...last50.map((c) => c.volume));
    lines.push(`avg_volume_50d=${Math.round(avgVol)} max_volume_50d=${Math.round(maxVol)} volume_ratio_max=${(maxVol / Math.max(1, avgVol)).toFixed(2)}`);
  }
  const stance = deriveStance(history, mtf);
  const reading = interpret(history);
  // The READING block is the load-bearing part: the model quotes these tags
  // instead of deciding what the numbers mean (P0-2).
  lines.push(...interpretationLines(reading));
  return { facts: lines.join("\n"), stance, reading };
}

// ── Stance derivation (WS-3) ──────────────────────────────────────────────
// Stance is computed in code from SMA alignment + MTF matrix + RSI — never
// left to the LLM's prose. Per-timeframe calls feed an overall stance with a
// confidence derived from cross-timeframe agreement.

export type Stance = "Bullish" | "Neutral" | "Bearish";

export interface StanceResult {
  short: Stance;
  medium: Stance;
  long: Stance;
  overall: Stance;
  /** 0-100, from cross-timeframe agreement and data availability. */
  confidence: number;
}

function stanceVote(...calls: (Stance | null)[]): Stance {
  let bull = 0;
  let bear = 0;
  for (const c of calls) {
    if (c === "Bullish") bull++;
    else if (c === "Bearish") bear++;
  }
  if (bull > bear) return "Bullish";
  if (bear > bull) return "Bearish";
  return "Neutral";
}

export function deriveStance(
  history: PriceHistory | null,
  mtf: { timeframe: string; bull: number; bear: number }[] = [],
): StanceResult {
  const neutral: StanceResult = { short: "Neutral", medium: "Neutral", long: "Neutral", overall: "Neutral", confidence: 0 };
  if (!history || history.candles.length < 50) return neutral;

  const n = history.candles.length;
  const last = history.candles[n - 1];
  const lastVal = (arr: { date: string; value: number | null }[]) =>
    [...arr].reverse().find((s) => s.value != null)?.value ?? null;
  const rsi = lastVal(history.rsi14);
  const sma20 = lastVal(history.sma20);
  const sma50 = lastVal(history.sma50);
  const sma200 = lastVal(history.sma200);

  const mtfFor = (re: RegExp) => mtf.find((m) => re.test(m.timeframe));
  const daily = mtfFor(/daily|1d/i);
  const weekly = mtfFor(/weekly|1w/i);
  const monthly = mtfFor(/monthly|1m/i);

  const short = stanceVote(
    rsi != null ? (rsi >= 55 ? "Bullish" : rsi <= 45 ? "Bearish" : "Neutral") : null,
    sma20 != null ? (last.close > sma20 ? "Bullish" : last.close < sma20 ? "Bearish" : "Neutral") : null,
    daily ? (daily.bull > daily.bear ? "Bullish" : daily.bear > daily.bull ? "Bearish" : "Neutral") : null,
  );
  const medium = stanceVote(
    sma50 != null ? (last.close > sma50 ? "Bullish" : last.close < sma50 ? "Bearish" : "Neutral") : null,
    weekly ? (weekly.bull > weekly.bear ? "Bullish" : weekly.bear > weekly.bull ? "Bearish" : "Neutral") : null,
  );
  const long = stanceVote(
    sma200 != null ? (last.close > sma200 ? "Bullish" : last.close < sma200 ? "Bearish" : "Neutral") : null,
    monthly ? (monthly.bull > monthly.bear ? "Bullish" : monthly.bear > monthly.bull ? "Bearish" : "Neutral") : null,
  );

  const stances = [short, medium, long];
  const bulls = stances.filter((s) => s === "Bullish").length;
  const bears = stances.filter((s) => s === "Bearish").length;
  const overall: Stance = bulls > bears ? "Bullish" : bears > bulls ? "Bearish" : "Neutral";
  const agree = overall === "Neutral" ? stances.filter((s) => s === "Neutral").length : stances.filter((s) => s === overall).length;
  const confidence = Math.round((agree / 3) * 100);

  return { short, medium, long, overall, confidence };
}

// ── Interpretation (P0-2) ──────────────────────────────────────────────────
// The v2 eval's contradictions were all the same bug: the model interpreted
// numbers the code already had. RSI 36/52/41 was called "a mix of oversold and
// overbought" (none is <30 or >70); MACD was called "bearish momentum" while
// its histogram was positive; price 2.5% BELOW VWAP was called supportive.
//
// So the READING is computed here and the model only writes prose around it.
// Every tag is a pure function of the fetched series — no thresholds to tune,
// nothing to hallucinate.

export type RsiZone = "oversold" | "neutral" | "overbought";
export type MaStack = "golden" | "death" | "mixed";
export type Regime = "aligned_downtrend" | "aligned_uptrend" | "pullback" | "transition";

export interface Interpretation {
  /** One zone per timeframe, in the order the series were supplied. */
  rsi: { timeframe: string; value: number | null; zone: RsiZone }[];
  /** MACD level (line vs signal) and momentum (histogram sign) kept SEPARATE. */
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
    /** Which side of ZERO the line sits on — the trend regime. */
    level: "bullish" | "bearish" | "flat";
    /** Line vs signal — the crossover state. */
    crossover: "above_signal" | "below_signal" | "at_signal";
    /** Histogram sign. Can disagree with level; that disagreement is the finding. */
    momentum: "improving" | "weakening" | "flat";
  } | null;
  maStack: MaStack | null;
  /** Signed % distance from price to each reference line. */
  distance: { label: string; pct: number }[];
  vwap: { value: number | null; state: "above" | "below" | "at" | null; pct: number | null };
  regime: Regime | null;
  volume: { ratio: number | null; state: "supportive" | "weak" | "normal" } | null;
}

const RSI_TIMEFRAMES: ("weekly" | "monthly")[] = ["weekly", "monthly"];

function rsiZone(v: number | null): RsiZone {
  if (v == null) return "neutral";
  if (v < 30) return "oversold";
  if (v > 70) return "overbought";
  return "neutral";
}

function pct(price: number, ref: number): number {
  return Math.round(((price - ref) / ref) * 10000) / 100;
}

export function interpret(history: PriceHistory | null): Interpretation | null {
  if (!history || history.candles.length < 30) return null;
  const last = history.candles[history.candles.length - 1];
  const lastVal = (arr: { date: string; value: number | null }[]) =>
    [...arr].reverse().find((s) => s.value != null)?.value ?? null;

  // RSI per timeframe: the daily series is resampled to weekly/monthly closes
  // so "RSI 36 / 52 / 41" gets real timeframe labels instead of a bare list.
  const rsiRows: Interpretation["rsi"] = [];
  const dailyRsi = lastVal(history.rsi14);
  rsiRows.push({ timeframe: "daily", value: dailyRsi, zone: rsiZone(dailyRsi) });
  for (const timeframe of RSI_TIMEFRAMES) {
    const closes = resampleCloses(history.candles, timeframe);
    const series = rsi(closes, 14);
    const v = [...series].reverse().find((s) => s != null) ?? null;
    rsiRows.push({ timeframe, value: v == null ? null : Math.round(v * 100) / 100, zone: rsiZone(v) });
  }

  const m = [...history.macd].reverse().find((x) => x.macd != null) ?? null;
  const macd = m
    ? {
        line: m.macd ?? null,
        signal: m.signal ?? null,
        histogram: m.histogram ?? null,
        // Level = which side of ZERO the line is on (the trend regime). v2
        // called MACD "bearish momentum" from a -180 line with a POSITIVE
        // histogram: it read the level and dropped the momentum.
        level:
          m.macd == null ? ("flat" as const) : m.macd < 0 ? ("bearish" as const) : m.macd > 0 ? ("bullish" as const) : ("flat" as const),
        crossover:
          m.macd == null || m.signal == null
            ? ("at_signal" as const)
            : m.macd > m.signal
              ? ("above_signal" as const)
              : m.macd < m.signal
                ? ("below_signal" as const)
                : ("at_signal" as const),
        momentum: m.histogram == null ? ("flat" as const) : m.histogram > 0 ? ("improving" as const) : m.histogram < 0 ? ("weakening" as const) : ("flat" as const),
      }
    : null;

  const sma20 = lastVal(history.sma20);
  const sma50 = lastVal(history.sma50);
  const sma200 = lastVal(history.sma200);
  const maStack: MaStack | null =
    sma50 == null || sma200 == null ? null : sma50 > sma200 ? "golden" : "death";

  const distance: Interpretation["distance"] = [];
  for (const [label, ref] of [["SMA20", sma20], ["SMA50", sma50], ["SMA200", sma200]] as const) {
    if (ref != null) distance.push({ label, pct: pct(last.close, ref) });
  }

  const vwapPct = pct(last.close, history.vwap);
  const vwap = {
    value: history.vwap,
    state: (Math.abs(vwapPct) < 0.5 ? "at" : last.close > history.vwap ? "above" : "below") as "above" | "below" | "at",
    pct: vwapPct,
  };

  // An "aligned downtrend" needs price below SMA50 AND SMA50 below SMA200.
  // v2 called KEI a trending-down regime while SMA50 (5100) sat ABOVE SMA200
  // (4842) — that is a pullback inside a prior uptrend, not an aligned one.
  let regime: Regime | null = null;
  if (sma50 != null && sma200 != null) {
    const p = last.close;
    if (p < sma50 && sma50 < sma200) regime = "aligned_downtrend";
    else if (p > sma50 && sma50 > sma200) regime = "aligned_uptrend";
    else if (p < sma200 && maStack === "golden") regime = "pullback";
    else regime = "transition";
  }

  let volume: Interpretation["volume"] = null;
  if (history.candles.length >= 20) {
    const last20 = history.candles.slice(-20);
    // ponytail: MEDIAN, not mean. The mean version read one quiet day after a
    // 10x spike as "weak volume" (GLAND: 327k vs an avg inflated by 8.7M and
    // 2.9M days) and the gate then blocked a 100-score report over it. Median
    // ignores the outliers. Ceiling: ignores real volume TRENDS across the
    // window. Upgrade path: compare 5d median vs 20d median if that matters.
    const sorted = last20.map((c) => c.volume).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 1;
    const ratio = Math.round((last.volume / med) * 100) / 100;
    volume = { ratio, state: ratio >= 1.5 ? "supportive" : ratio <= 0.7 ? "weak" : "normal" };
  }

  return { rsi: rsiRows, macd, maStack, distance, vwap, regime, volume };
}

/** Downsample daily candles to the last close of each week or month. */
function resampleCloses(candles: Candle[], timeframe: "weekly" | "monthly"): number[] {
  const closes: number[] = [];
  let key = "";
  for (const c of candles) {
    const d = new Date(c.date + "T00:00:00Z");
    const k =
      timeframe === "monthly"
        ? `${d.getUTCFullYear()}-${d.getUTCMonth()}`
        : // ISO week bucket
          `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 604800000)}`;
    if (k !== key) {
      closes.push(c.close);
      key = k;
    } else {
      closes[closes.length - 1] = c.close;
    }
  }
  return closes;
}

/** One line per interpretation group — the model quotes these, never re-derives them. */
export function interpretationLines(i: Interpretation | null): string[] {
  if (!i) return [];
  const out: string[] = [];
  const over = i.rsi.filter((r) => r.zone === "oversold").map((r) => r.timeframe);
  const under = i.rsi.filter((r) => r.zone === "overbought").map((r) => r.timeframe);
  out.push(
    `READING rsi: ${i.rsi.map((r) => `${r.timeframe}=${r.value ?? "n/a"} (${r.zone})`).join("; ")}` +
      ` | verdict=${over.length || under.length ? [...over.map((t) => `${t} oversold`), ...under.map((t) => `${t} overbought`)].join(", ") : "no timeframe is oversold or overbought"}`,
  );
  if (i.macd) {
    // Level and momentum can disagree — the report must say BOTH. v2's single
    // "bearish momentum" line, printed while the histogram was +9.86, was the
    // eval's headline contradiction.
    const disagree =
      i.macd.level !== "flat" &&
      i.macd.momentum !== "flat" &&
      (i.macd.momentum === "improving") !== (i.macd.level === "bullish");
    out.push(
      `READING macd: level=${i.macd.level} (line ${i.macd.line ?? "n/a"} is ${i.macd.level === "bearish" ? "below" : "above"} zero); ` +
        `crossover=${i.macd.crossover} (vs signal ${i.macd.signal ?? "n/a"}); momentum=${i.macd.momentum} (histogram ${i.macd.histogram ?? "n/a"})` +
        ` | verdict=${
          disagree
            ? `the ${i.macd.level} level and ${i.macd.momentum} momentum DISAGREE — state both ("${i.macd.level === "bearish" ? "selling pressure, but easing" : "uptrend, but momentum fading"}"), never one alone`
            : `${i.macd.level} level with ${i.macd.momentum} momentum — they agree`
        }`,
    );
  }
  if (i.maStack) out.push(`READING ma_stack: ${i.maStack} (${i.maStack === "golden" ? "SMA50 above SMA200 — no death cross" : "SMA50 below SMA200"})`);
  if (i.distance.length) out.push(`READING distance: ${i.distance.map((d) => `${d.label} ${d.pct > 0 ? "+" : ""}${d.pct}%`).join("; ")}`);
  if (i.vwap.state) out.push(`READING vwap: price is ${i.vwap.pct! > 0 ? "ABOVE" : "BELOW"} VWAP by ${Math.abs(i.vwap.pct!)}% (${i.vwap.state === "above" ? "intraday strength" : i.vwap.state === "below" ? "weakness vs the session's average price" : "at VWAP"})`);
  if (i.regime) out.push(`READING regime: ${i.regime} — ${REGIME_PLAIN[i.regime]}`);
  if (i.volume) out.push(`READING volume: last day is ${i.volume.ratio}x the 20d average (${i.volume.state})`);
  return out;
}

const REGIME_PLAIN: Record<Regime, string> = {
  aligned_downtrend: "price below SMA50 below SMA200 — a genuine aligned downtrend",
  aligned_uptrend: "price above SMA50 above SMA200 — a genuine aligned uptrend",
  pullback: "price below the averages but SMA50 is still above SMA200 — a pullback inside a prior uptrend, NOT an aligned downtrend",
  transition: "moving averages are not stacked — the trend state is unresolved",
};

// ─── Market snapshot frozen at run time ──────────────────────────────────

export interface MarketSnapshot {
  /** Last close on (or immediately before) the run date. */
  price: number;
  /** Trading date the price is from (YYYY-MM-DD). */
  as_of: string;
  /** Market cap when the metrics snapshot carries one, else null. */
  market_cap: number | null;
  market_cap_source: "metrics" | null;
  currency: string | null;
  /** Last 6 months of daily closes ending at as_of (downsampled for storage). */
  candles: { date: string; close: number }[];
  fetched_at: string;
}

/**
 * Build the market context an analysis result should always show: the
 * price + market cap on the run date and the trailing 6-month price series
 * ending there. Persisted on the run row so a result viewed months later
 * reflects the market as it was when the verdict was formed. Never throws —
 * a data failure yields null and the UI degrades to "snapshot unavailable".
 */
export async function buildMarketSnapshot(
  symbol: string,
  metrics: Record<string, any> | null,
): Promise<MarketSnapshot | null> {
  try {
    const history = await getPriceHistory(symbol);
    if (!history || history.candles.length === 0) return null;
    const last = history.candles[history.candles.length - 1];
    const sixMonths = history.candles.slice(-130);
    const step = Math.max(1, Math.ceil(sixMonths.length / 130));

    const rawCap = metrics ? toNumberOrNull(metrics.market_capitalization ?? metrics.market_cap) : null;
    return {
      price: last.close,
      as_of: last.date,
      market_cap: rawCap,
      market_cap_source: rawCap != null ? "metrics" : null,
      currency: null,
      candles: sixMonths
        .filter((_, i) => i % step === 0 || i === sixMonths.length - 1)
        .map((c) => ({ date: c.date, close: c.close })),
      fetched_at: new Date().toISOString(),
    };
  } catch (e: any) {
    log.warn("marketdata", `market snapshot for ${symbol} failed: ${e?.message}`);
    return null;
  }
}

function toNumberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
