/**
 * Built-in Yahoo Finance tools (yahoo-finance2 — keyless, same data source
 * yfinance uses). Complements marketdata.ts (chart/indicators) with quote,
 * fundamentals, search, and analyst insights. Digests are code-side: the
 * model never sees raw quoteSummary dumps. Failures return {error}, never null.
 */

import { z } from "zod";
import YahooFinance from "yahoo-finance2";
import { getPriceHistory, priceHistoryDigest, toYahooSymbol } from "../../../marketdata.js";
import type { ToolContext, ToolDefinition } from "../registry.js";

// logErrors off: a schema mismatch still throws (guard returns {error}) — the
// 200-line upstream dump per failure would drown the server log.
// Exported: the /stocks/:symbol/overview route shares this one client.
export const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false }, versionCheck: false });

const symbolParam = z.object({ symbol: z.string().min(1).nullish() });

function resolveSymbol(args: { symbol?: string | null }, ctx: ToolContext): string {
  const raw = (args.symbol || ctx.symbol).trim().toUpperCase();
  return toYahooSymbol(raw, ctx.source);
}

/** Keep an object only where the value is a finite number/string. */
function pick<T extends Record<string, any>>(src: T | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = src?.[k];
    if (typeof v === "number" ? Number.isFinite(v) : typeof v === "string" ? !!v : false) out[k] = v;
  }
  return out;
}

async function guard(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e: any) {
    return { error: String(e?.message || e), source: "yahoo" };
  }
}

export function yahooTools(): ToolDefinition[] {
  return [
    {
      name: "get_quote",
      description:
        "Yahoo Finance quote for a ticker (price, change, 52-week range, volume, market cap — keyless, may be delayed). " +
        "Defaults to the symbol under analysis. Returns {error} when Yahoo has no data for the ticker.",
      parameters: symbolParam,
      execute: (args, ctx) =>
        guard(async () => {
          const q = await yf.quote(resolveSymbol(args, ctx));
          return {
            symbol: q.symbol,
            name: q.longName || q.shortName || "",
            price: q.regularMarketPrice,
            change_pct: q.regularMarketChangePercent,
            currency: q.currency,
            volume: q.regularMarketVolume,
            market_cap: q.marketCap,
            fifty_two_week_high: q.fiftyTwoWeekHigh,
            fifty_two_week_low: q.fiftyTwoWeekLow,
            trailing_pe: q.trailingPE,
            dividend_yield: q.dividendYield,
            exchange: q.fullExchangeName,
            source: "yahoo",
          };
        }),
    },
    {
      name: "get_fundamentals",
      description:
        "Yahoo Finance fundamentals: profile (sector/industry), valuation, profitability, and growth for a ticker. " +
        "Defaults to the symbol under analysis. Numbers are raw (not formatted). Returns {error} when unavailable.",
      parameters: symbolParam,
      execute: (args, ctx) =>
        guard(async () => {
          const s = resolveSymbol(args, ctx);
          const qs = await yf.quoteSummary(s, {
            modules: ["assetProfile", "financialData", "defaultKeyStatistics", "summaryDetail"],
          });
          return {
            symbol: s,
            profile: pick(qs.assetProfile, ["sector", "industry", "country", "website", "longBusinessSummary"]),
            valuation: pick(qs.summaryDetail, [
              "marketCap",
              "trailingPE",
              "forwardPE",
              "priceToBook",
              "dividendYield",
              "enterpriseValue",
              "ebitda",
            ]),
            profitability: pick(qs.financialData, [
              "profitMargins",
              "returnOnEquity",
              "returnOnAssets",
              "grossMargins",
              "operatingMargins",
              "revenueGrowth",
              "earningsGrowth",
              "totalRevenue",
              "totalDebt",
              "freeCashflow",
              "operatingCashflow",
            ]),
            metrics: pick(qs.defaultKeyStatistics, [
              "beta",
              "bookValue",
              "enterpriseToEbitda",
              "enterpriseToRevenue",
              "sharesOutstanding",
              "impliedSharesOutstanding",
            ]),
            analyst: pick(qs.financialData, [
              "targetMeanPrice",
              "targetHighPrice",
              "targetLowPrice",
              "recommendationKey",
              "numberOfAnalystOpinions",
            ]),
            source: "yahoo",
          };
        }),
    },
    {
      name: "search_symbol",
      description:
        "Search Yahoo Finance for a company or ticker by name (use before get_quote when the exact symbol is unknown). " +
        "Returns matching symbols with names and exchanges; {error} on failure.",
      parameters: z.object({ query: z.string().min(1).max(100) }),
      execute: ({ query }) =>
        guard(async () => {
          const res = await yf.search(query);
          const quotes = (res.quotes ?? [])
            .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "INDEX"))
            .slice(0, 8)
            .map((q) => ({
              symbol: q.symbol,
              name: q.shortname || q.longname || "",
              exchange: (q as any).exchange || "",
              type: q.quoteType || "",
            }));
          return { query, count: quotes.length, results: quotes, source: "yahoo" };
        }),
    },
    {
      name: "get_insights",
      description:
        "Yahoo Finance technical outlook for a ticker: support/resistance/stop, short-term direction, valuation view, " +
        "and a third-party rating with target price. Defaults to the symbol under analysis. Returns {error} when unavailable.",
      parameters: symbolParam,
      execute: (args, ctx) =>
        guard(async () => {
          const s = resolveSymbol(args, ctx);
          const i = await yf.insights(s);
          const info = i?.instrumentInfo;
          // Yahoo carries no technical/rating data for many non-US listings.
          if (!info && !i?.recommendation) return { error: `no insights available for ${s}`, symbol: s, source: "yahoo" };
          const out = info?.technicalEvents?.shortTermOutlook;
          return {
            symbol: s,
            recommendation: i?.recommendation ? pick(i.recommendation as any, ["rating", "targetPrice", "provider"]) : {},
            short_term: out ? pick(out as any, ["direction", "score", "scoreDescription", "stateDescription"]) : {},
            support: info?.keyTechnicals?.support,
            resistance: info?.keyTechnicals?.resistance,
            stop_loss: info?.keyTechnicals?.stopLoss,
            valuation_view: info?.valuation?.description,
            source: "yahoo",
          };
        }),
    },
    {
      name: "get_price_history",
      description:
        "Daily OHLCV price history for a ticker (Yahoo Finance chart data — same source yfinance uses; may be delayed). " +
        "Returns a code-computed digest (last close, SMA 20/50/200, RSI 14, 52-week position, trailing returns) plus the " +
        "full series: candles_recent (date/o/h/l/c/v) and sma20/sma50/sma200/rsi14 arrays — the harness feeds these to " +
        "charts, so cite this source for any price/volume/overlay plot. Defaults to the symbol under analysis.",
      parameters: z.object({
        symbol: z.string().min(1).nullish(),
        period: z.enum(["3mo", "6mo", "1y", "2y", "5y", "max"]).nullish(),
      }),
      execute: async (args, ctx) => {
        const s = resolveSymbol(args, ctx);
        const period = args.period ?? "1y";
        const h = await getPriceHistory(s, period, ctx.source);
        if (!h) return { error: `no price history for ${s} (${period})`, symbol: s, source: "yahoo" };
        const nonNull = (arr: { date: string; value: number | null }[]) => arr.filter((x) => x.value != null).map((x) => ({ date: x.date, v: x.value }));
        return {
          symbol: h.symbol,
          range: h.range,
          digest: priceHistoryDigest(h),
          fifty_two_week: h.fifty_two_week,
          candles_recent: h.candles.map((c) => ({ date: c.date, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })),
          sma20: nonNull(h.sma20),
          sma50: nonNull(h.sma50),
          sma200: nonNull(h.sma200),
          rsi14: nonNull(h.rsi14),
          source: "yahoo",
        };
      },
    },
  ];
}
