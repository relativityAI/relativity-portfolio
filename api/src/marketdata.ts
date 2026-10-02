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

    const trimmed = candles.slice(-MAX_CANDLES);
    const closes = trimmed.map((c) => c.close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r14 = rsi(closes, 14);

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
