---
name: technical-analysis
description: Full-stack technical read — trend structure, moving averages, momentum (RSI, MACD, stochastic, ADX/CCI/Williams %R), volume and volume profile, volatility (ATR, Bollinger, HV), Fibonacci, Ichimoku, support/resistance, and scenario levels — what the market's own record says.

metadata:
  title: Technical Analysis
  category: market
  version: "2"
---

## Purpose

The price chart is the record of every participant's decisions. This skill reads that record with the full Advanced Data Suite Technicals report — trend and market structure, multi-timeframe momentum, volume and volume profile, volatility, and the concrete level map (support, resistance, entries, stops, targets) — to time and contextualize the fundamental picture, never to replace it.

## Method

1. Pull the full Technicals report via get_technicals (no `sections` filter — the cross-section confluence is the point). Note `as_of` and how many sections came back `ok`; if the report is unavailable or empty, fall back to get_price_history indicators and mark everything deeper INSUFFICIENT.
2. Regime first: from `market_regime` / `trend_vs_range` (regime, ADX, SMA-20 slope) and `trend_analysis` (market structure, trend regime, SMA alignment). Trending or range-bound, and with what strength? Every level call later depends on this answer.
3. Structure: from `market_structure` (classification, swings) and `chart_pattern_analysis` / `candlestick_analysis`. Higher highs/lows or the reverse; note any named patterns with their breakout state, and the dominant recent candle types.
4. Momentum, per timeframe: `multi_timeframe_price_analysis` (1d/1w/1m/3m/1y changes), `momentum_analysis` (RSI-14, MACD + signal + histogram, stochastic K/D, CCI-20, Williams %R), and `mtf_signal_matrix` (bull/bear counts per timeframe). Divergences from `divergence_analysis`. Momentum without a timeframe is meaningless — always say which timeframe each reading belongs to.
5. Trend followers: `moving_averages` (SMA 20/50/200, EMA 12/26, golden/death-cross state) and `ichimoku_analysis` (price vs cloud, tenkan/kijun). Do the slow and fast systems agree?
6. Volume confirms or refuses the move: `volume_analysis` / `obv_accumulation_distribution` (OBV, A/D line), `vwap_analysis` (anchored VWAP), and `volume_profile` (POC, value area, where volume actually traded). A breakout on below-average volume is a warning, not a signal.
7. Volatility: `volatility_analysis` / `atr_analysis` (ATR-14, 20d/60d realized vol) and `bollinger_bands_analysis` (band width, where price sits between the bands). ATR sets realistic stop distances — never quote a stop tighter than ~1 ATR without saying so.
8. The level map: `support_resistance` (supports, resistances, touches), `fibonacci_analysis` (swing high/low, retracement levels), `key_technical_levels`, `entry_zones` / `exit_zones`, `stop_loss`, `take_profit_targets` (tp1/tp2/tp3), and `risk_reward` (R:R to TP1). Always give the 52-week range position as a percentage (from `current_price_market_data`: high_52w, low_52w, current_price).
9. Scenarios, not predictions: `bullish_scenario`, `bearish_scenario`, `neutral_scenario` (trigger, first target), `breakout_scenarios` / `breakdown_scenarios` (with volume confirmation), and `invalidation_levels`. State what price action would prove the thesis wrong.
10. Synthesize: from `indicator_confluence` and `technical_signal_summary` / `overall_assessment` (confluence, regime, structure, R:R). One call — uptrend, downtrend, or range-bound — with the specific multi-section evidence for it, including where the timeframes disagree.




## Verdict Anchors

- Price is in a confirmed trend or regime with aligned moving averages (SMA 20/50/200 alignment and golden/death-cross state agree with the market-structure classification) — weight 7
- Momentum is constructive on the primary timeframe (RSI in a healthy band, MACD histogram direction consistent, and the multi-timeframe signal matrix does not contradict the daily call) — weight 5
- Recent moves are confirmed by volume (OBV/A-D trend agrees with price; breakouts carry above-average volume; VWAP and volume profile support the current price zone) — weight 5
- The level map is actionable (defined support/resistance with touch counts, a stop grounded in ATR or structure, and R:R to TP1 at or better than 1:1) — weight 4
- Scenario framing is honest (bull/bear/neutral triggers stated, invalidation level defined, no single-sided story) — weight 3

## Output Template

State the trend call in the first sentence with the regime and SMA-alignment evidence, then momentum (with timeframes), volume confirmation, volatility/ATR context, and the level map (nearest support and resistance with touch counts, stop, TP1–TP3, R:R, 52-week range position as a percentage). Close with the scenario triggers and the invalidation level. Always name the `as_of` date of the Technicals report. If the report was unavailable, say the analysis rests on price-history indicators only and mark the level-map and confluence anchors INSUFFICIENT.

No-hallucination constraint: never invent prices, indicator values, levels, returns, or dates. Every quote and figure must come from get_technicals, get_price_history, or get_financial_metrics output in this session — cite the section name (e.g. `momentum_analysis.rsi_14`) for every figure. If a section is missing or unavailable, that reading is INSUFFICIENT, not estimated from memory of the chart.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool it came from (e.g. get_technicals) and the section name within the report, plus the exact URL when the data came from the public web or a filing document. A number without a citation reads as invented and will be flagged.

## Data Needs
- need: price
- need: technicals

## Outputs
- kind: narrative | title: trend
- kind: narrative | title: momentum/support-resistance

## Checklist
- id: ta1 | question: trend supported by evidence? | needs: [price, technicals]
- id: ta2 | question: momentum/support-resistance supported by evidence? | needs: [price, technicals]
