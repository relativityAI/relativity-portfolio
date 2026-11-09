---
name: chartist-technical-analysis-v2
description: Technical analysis of one individual stock using a strength-first, weekly-chart framework (near 52-week high, relative strength, Weinstein stage analysis with the 40-week MA, base breakouts, volume, theme strength, and a catalyst check). Use whenever the user asks to analyse a stock or chart, judge a breakout/base/uptrend, decide whether a stock is strong, say where to enter, exit or put a stop, or check if a chart is supported by the business, even if they don't say "technical analysis".
metadata:
  category: analysis
  title: Stock Technical Analysis v2
---

# Stock Technical Analysis (single stock)

**Core idea:** Strong stocks stay near their highs, outperform the market, trade in an uptrend, and break out of bases on volume. A good business and a good stock are not the same thing: returns depend on the price and valuation you enter at. Use the chart to decide *when* to buy and sell. Use fundamentals to decide *what* to buy and to avoid junk.

Use simple tools only: price, volume, the 40-week moving average, and relative strength vs. an index. Do NOT use RSI, MACD, or other oscillators.

## Step 1: Collect data

Get all of this before analysing. If something is missing, say so and continue with what you have.

| Data | Detail |
|---|---|
| Price history | Weekly OHLC + volume, ≥ 3 years (5+ years to judge long bases). Daily data for the last 3–6 months. |
| Benchmark | The stock's home index (e.g. Nifty 50, S&P 500, DAX) over the same dates. |
| 52-week high / low | And the stock's current price. |
| Liquidity | Market cap, price, average daily traded value (last 10–12 days). |
| Peers | 5–10 stocks in the same industry, with their distance from 52-week high. |
| Fundamentals | Last 8 quarters: sales, EBITDA margin, EPS, operating cash flow. Plus debt, promoter pledge, order book (if relevant). |
| Latest news | Latest results, investor presentation, earnings call, announcements. |

Tools: use web search / fetch or any finance tool available. If you can run code, compute the 40-week EMA and returns yourself.

## Step 2: Check the 7 focus areas

Score each as **Pass / Fail / Unclear**. Details and exact rules are in the reference files.

1. **Near 52-week high.** Pass if price is within 20% of the 52-week high and the stock is liquid. A strong stock is never found near its 52-week low.
2. **Relative strength (RS).** Compare the stock's 1-month and 3-month return to the benchmark. Pass if it beats the index (or falls less in a down market).
3. **Stage and 40-week MA.** On the weekly chart, Pass only if the stock is in Stage 2: price above a rising 40-week MA, making higher highs and higher lows. Stage 3 or 4 = Fail.
4. **Base and breakout.** Identify the base (long or short), the breakout level, and whether there was a strong close plus follow-through. Pass if it broke out and held, or is tightly consolidating just under the level.
5. **Volume.** Pass if volume spikes on up-moves and breakouts (institutions buying) and dries up in pullbacks.
6. **Theme and peers.** Pass if several peers in the same industry are also near their highs. A leader with a strong group is best.
7. **Catalyst and fundamental sanity check.** Pass if there is a clear business reason for the move (growing EPS, margins, new demand) and no red flags.

→ Rules for 1–5: `references/chart-checks.md`
→ Rules for 6–7, valuation, and red flags: `references/theme-and-fundamentals.md`

## Step 3: Decide setup type

- **Buy zone:** Areas 1–4 Pass, plus 5 or 6 Pass. Entry = breakout from a base on volume, or the first short-base breakout after a missed long-base breakout.
- **Watchlist:** Stage 2 but no clean base or breakout yet, or one area is Unclear. Name the exact trigger to wait for.
- **Avoid:** Stage 3 or 4, far from 52-week high, weak RS, climax top, or a fundamental red flag.

Do not skip a good stock just because it has already run. Stocks that have run tend to keep running. A missed breakout is followed by short-base breakouts.

## Step 4: Set the exit plan (always include this)

- Use the **weekly chart**. Daily noise causes bad exits.
- Pick the exit *before* entry: (a) a stop just below the base or the 40-week MA, and (b) a thesis-change exit (growth slows, red flag appears).
- After entry, **trail the stop** up under higher lows or the 40-week MA. Nobody sells the exact top; accept giving back some gains.
- A first close below the 40-week MA is a warning. It is a confirmed breakdown only with follow-through.
- Watch for a **climax top** (vertical rise, huge volume, extreme valuation). Details in `references/chart-checks.md`.

## Output format

Follow this report structure : ``


## Rules of thumb

- Think in probabilities: more signals in agreement = higher odds. Never rely on one signal.
- Find strong stocks first; the theme shows up from them. Do not pick a sector first.
- Fundamentals can veto a good chart (fraud, negative cash flow, fake orders). A chart cannot excuse a bad business.
- Thresholds (20%, 1–3 months, liquidity numbers) were set for the Indian market. Adjust liquidity limits to the market you are analysing.
