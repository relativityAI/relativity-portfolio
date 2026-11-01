---
name: technical-analysis
description: Full-stack technical read — trend structure, moving averages, momentum (RSI, MACD, stochastic, ADX/CCI/Williams %R), volume and volume profile, volatility (ATR, Bollinger, HV), Fibonacci, Ichimoku, support/resistance, and scenario levels — what the market's own record says.

metadata:
  title: Technical Analysis
  category: market
  version: "3"
---

# Technical Analysis Report

Create a full technical read for a client who already has the fundamental picture and needs the market's own answer: where price sits relative to its trend, whether momentum and volume agree, and which levels are actually tradable. Everything in the report comes from the record gathered for this symbol — it never offers an opinion the record doesn't support.

## When to Use

- "Do a technical read on [Company]"
- "Is [Company] in an uptrend — where are the levels?"
- "Where would you put the stop on [Company]?"
- Timing, support/resistance, momentum, or chart-structure questions on a symbol.

Not for valuations, earnings recaps, or fundamental theses — those are different reports.

## What the Report Must Cover

### 1. Trend call — the first sentence
Uptrend, downtrend, or range-bound, with the regime and its strength (ADX, slope of the 20-day average, structure classification) and how the averages line up (SMA 20/50/200 alignment, golden/death-cross state). Every level later in the report depends on this answer, so it leads.

### 2. Structure
Higher highs/lows or the reverse; any named chart patterns with their breakout state; the dominant recent candle types. If structure disagrees with the trend call, say so.

### 3. Momentum — never without a timeframe
RSI-14, MACD (signal and histogram), stochastic, CCI, Williams %R — each reading tagged with its timeframe (daily, weekly, monthly as applicable), plus the multi-timeframe agreement picture and any divergences. Where the timeframes disagree, that disagreement is part of the answer.

### 4. The averages and the cloud
Where price sits versus SMA 20/50/200 and EMA 12/26, cross state, and price vs the Ichimoku cloud (tenkan/kijun). Do the slow system and the fast system agree?

### 5. Volume confirms or refuses the move
OBV / accumulation-distribution trend, anchored VWAP, and volume profile — POC and value area, where volume actually traded. A breakout on below-average volume is a warning, not a signal; treat it as one.

### 6. Volatility
ATR-14 and realized volatility, Bollinger band width, and where price sits inside the bands. Never quote a stop tighter than about one ATR without saying so.

### 7. The level map — the most useful section
Nearest supports and resistances with touch counts, Fibonacci retracements of the current swing, entry zones, a stop grounded in ATR or structure, TP1–TP3, and risk-reward to TP1. Always state the 52-week range position as a percentage. A level with no basis — a touch count, an ATR, a swing — doesn't belong in the map.

### 8. Scenarios, not predictions
Bull, bear, and neutral scenarios with explicit triggers and first targets; breakout/breakdown scenarios that require volume confirmation; upcoming catalysts that could move the levels; and the invalidation level — what price action would prove the call wrong. No single-sided stories.

### 9. Synthesis
Close with the one call — trend, momentum, volume, structure, risk-reward — and the specific evidence behind it, including any signal that dissents.

## Charts

- type: line | title: Price | data: price
- type: line | title: Price + 200 DMA | data: price, sma200

- The price chart is mandatory. A technical report without one isn't done.
- An overlay chart must actually plot both lines against each other — a price-only line under a "Price + 200 DMA" title is a failed chart.
- Charts show the real data gathered for this report — never points drawn to look plausible.
- Two charts is the norm; a third only if it earns its place. Scalar readings (an RSI value, an ADX reading) belong in a table, not a series.

## Tables

One to three summary tables, not data dumps:
- The level map: support / resistance / touch counts / stop / TP1–TP3 / risk-reward
- Momentum readings by timeframe
- Scenario triggers — only when the scenarios are rich enough to warrant it

## Accuracy & Citations (mandatory)

- Every number in prose carries a citation to where it came from — the source document or record entry, and the exact URL when the data came from the public web or a filing. A number without a source reads as invented.
- Nothing is filled in from memory: prices, indicator values, levels, returns, and dates come only from data gathered for this report. If a reading isn't available, mark it INSUFFICIENT — don't reconstruct it from a mental picture of the chart.
- Every finding and every verdict evidence line carries a citation too.
- Name the as-of date of the technicals record in the report.

## Output Shape

Open with the trend call (regime and average alignment), then momentum with timeframes, volume confirmation, volatility/ATR context, the level map with the 52-week position, scenarios, and the invalidation level; close with the triggers and what would prove the call wrong. If the technicals record was unavailable, say plainly that the analysis rests on price history alone and mark the level map and confluence judgments INSUFFICIENT. Any catalyst or event mentioned carries its source link.

## Checklist

- [ ] Trend call leads, with regime and SMA alignment behind it
- [ ] Every momentum reading carries its timeframe
- [ ] Volume confirms — or explicitly refuses — the move
- [ ] Stop is no tighter than about one ATR, or says why
- [ ] 52-week range position stated as a percentage
- [ ] Price chart present; overlay charts plot both lines
- [ ] Scenario triggers and an invalidation level present
- [ ] Every figure cited; nothing estimated from memory
