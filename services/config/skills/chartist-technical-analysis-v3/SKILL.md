---
name: chartist-technical-analysis-v3
description: Compact stock technical analysis framework from "The Chartist" (Himanshu Sharma) podcast. Covers near-52-week-high scans, relative strength, Weinstein stage analysis, 30/40-week moving average, base breakouts, volume spikes, climax tops, trailing stops and loss maths. Use whenever the user wants to analyse a stock chart, build or read a scan or screener, find strong stocks or themes, judge a breakout, base, trend or stage, or decide entry, stop and exit, even if they never say "technical analysis" or "Chartist". (v3 runs on the plan-parallel harness — the frontmatter tools list is its parallel toolbox.)
citations: inline
tools:
  - get_price_history
  - get_quote
  - get_insights
  - search_symbol
  - search_news
  - web_search
metadata:
  title: Chartist Technical Analysis (v3)
  category: market
  tags: technical
---

# Chartist Technical Analysis

Stock technical analysis strategy by The_Chartist (https://x.com/_chartitude).
Find strong stocks early. Time entries on the weekly chart. Exit by rule.
Tools: price, volume, one weekly MA, relative strength. Nothing else.

**Principles:** strong stocks live near highs. 
Weekly charts only (daily = noise). 
Missed the breakout? Wait for the next base. 
Exits matter more than entries. Never average down.

## Process

Run the steps in order. Skip a step only if the request clearly doesn't need it (single-stock request: skip 2-3; scan request: stop after 3). Every step ends with a pass / fail / unclear call.

### Step 0. Route and get data

Cover: what the user wants (scan, one stock, trade plan, review of a holding) and which market.
- **Never invent prices or levels.** Use the user's chart or CSV, or search the web. If neither exists, give the framework only and say no live data was used.
- CSV given? Run it, don't eyeball:
  `python scripts/stage_check.py --stock STOCK.csv [--benchmark INDEX.csv] [--ma 40]`
  Columns: `Date`, `Close` (optional `High`, `Low`, `Volume`). Reports distance from 52-week high, MA status, heuristic stage, structure, base length, volume spikes, RS. Confirm the stage on the chart.
- Note data date. Case-study prices are from ~January 2026.

### Step 1. Scan (market level)

Cover: filters, count, new entrants.

| Filter | Default |
|---|---|
| Distance from 52-week high | within 20% (10% short list, 30% long list) |
| Market cap | above ~₹500 crore |
| Price | above ~₹20 |
| Liquidity | ~₹5 crore/day (10-12 day avg) |

- Run daily. Output (~150-200 names in India) is a reading list, not a buy list.
- Real trends stay 1-1.5 years. **New entrants are the signal**, especially several from one industry.
- Other markets: keep the logic, rescale numbers, say so.
- Optional "volume rocketing" scan: spikes = institutional buying.

### Step 2. Themes and leaders

Cover: industries ranked by count, leader per group.
- Group by industry. Top 3-5 groups = where money flows.
- The first stock to break out in a group usually leads, and leaders keep leading.

### Step 3. Relative strength

Cover: stock vs benchmark (sector, index, or other market) over 1-3 months, confirmed on 6-12 months.
- Up 15% vs index up 10% = strong. Down 3% vs index down 5% = also strong.
- 1 week is noise. Judge by eye with an overlay.
- **RS is not RSI.** Don't use RSI; big winners stay "overbought".
- Use multiline plot to compare stock vs benchmark movement.

### Step 4. Stage (weekly)

Cover: stage, MA slope, price vs MA.

| Stage | Chart | Action |
|---|---|---|
| 1 Base | Sideways after decline | Watch, wait for trigger |
| 2 Uptrend | Higher highs/lows, above rising MA | **Buy, hold, trail** |
| 3 Top | Flat, no new highs | Tighten stops, stop adding |
| 4 Downtrend | Lower highs/lows, below falling MA | Avoid, exit |

- MA: 40-week (speaker, about the 200-day) or 30-week (Weinstein). Pick one, stay consistent.
- A dip below the MA that reverses is not a breakdown. Wait for follow-through.
- Trade only stage 2 (or late stage 1 breaking out).

### Step 5. Base and breakout

Cover: base type and length, breakout quality, volume.
- **Long base** (1+ year): highest-conviction breakout. Old sellers gone, little supply above.
- **Short base** (weeks to months, inside stage 2): a pause, not weakness.
- Missed the long-base breakout? Buy the first short-base breakout after it.
- **Breakout = strong close beyond resistance + follow-through.** One close is a crack, not a break. Same for breakdowns.
- **Volume:** a spike on breakout = institutions buying. A sleeping stock that wakes up deserves attention.
- IPO high is a reference level; highs older than 3 years matter little. Use them to add, not to enter.

### Step 6. Top and risk check

Cover: climax risk, slow-top signs, fraud flags, earnings date.
- **Slow top:** growth fades, lower highs, MA breaks, bounces, fails. Time to exit.
- **Climax top:** vertical rise, huge volume, everyone owns it, then a one-bar reversal on any shock (e.g. 18 Oct 2021: IRCTC, IEX, DMart).
- **Fraud:** staircase up, elevator down; charts won't warn. Check cash flow, skip years of negative cash flow.
- Don't chase vertical moves with no base. Earnings = known gap risk; say so.

### Step 7. Focus areas

1. Stage 2, or late stage 1 breaking out?
2. Above a rising weekly MA?
3. Higher highs and higher lows?
4. Base length (longer is better)?
5. Strong close plus follow-through?
6. Volume spike on breakout?
7. Beating benchmark over 1-3 months?
8. Climax risk?

### Step 8. Trade plan

Cover: thesis, entry, stop, trail, risk, adds.
- **Thesis:** one line, theme + chart signal.
- **Entry:** follow-through close above the base. Don't chase far past it.
- **Stop:** below base low or a clear weekly level. State risk (entry minus stop); user sets size.
- **Trail:** weekly close below the 30/40-week MA, or under the last higher low.
- **Add:** on the next base breakout, never by averaging down.
- **After entry:** don't interfere. Exit only on stop or broken thesis. Accepting some giveback is the cost of staying in the trend.
- Up 5-6x after a deep correction ended? The speaker keeps a stop rather than selling all.

### Step 9. Behaviour check

Cover: only if the user holds the stock or shows a bias.
- Flag: averaging down, "I'll sell at my price" (loss aversion), holding losers and cutting winners, skipping because "it already ran", daily/15-minute charts, anchoring on an old price, ignoring bad news on a holding.
- Show loss maths when they shrug off a drawdown:

| Loss | 10% | 20% | 33% | 50% | 75% | 90% |
|---|---|---|---|---|---|---|
| Gain to recover | 11% | 25% | 50% | 100% | 300% | 900% |

  A 5x stock that falls 50% is 2.5x, not 3.5x.
- Fix: write the exit rule first, keep a journal, weekly charts only.

### Step 10. Verdict and report

Cover: verdict (buy zone / wait for base / hold and trail / avoid / exit), one-line reason, what changes my mind, data source and date.
- Format the report exactly per `references/report-structure.md`, and nothing else.
- Scan request: filters used, number of names, top industries, 5-8 names to read first, new entrants.
- Examples are hindsight winners; the same signals fail, which is why stops exist.
- One short line, once: educational framework, not personal advice.

## References (read only when needed)

- `references/report-structure.md`: report format (always, Step 10).
- `references/chart-details.md`: why stages happen, overhead supply, IPO bases, market cycles.
- `references/case-studies.md`: worked examples for teaching or "show me an example".