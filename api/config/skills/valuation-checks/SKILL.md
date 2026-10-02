---
name: valuation-checks
description: Multiples vs history and the price you pay for each unit of earnings, book, and sales.
allowed-tools: get_financial_metrics get_financials get_price_history
metadata:
  title: Valuation Checks
  category: valuation
  version: "1"
---

## Purpose

Places the current price in the context of what the market has historically paid for this business and what a rational buyer should pay. A great company bought at the wrong price is a bad investment; this skill measures the price, not the business.

## Method

1. Pull the current P/E, P/B, P/S, EV/EBITDA (or the closest available set) and note which are missing because the price feed is down.
2. Compare each multiple against the company's own 3–5 year history where obtainable from period financials (price at period end ÷ per-period earnings/book/sales).
3. Compute earnings yield (1 ÷ P/E) and compare with prevailing risk-free rates if available in the macro snapshot; a stock yielding less than bonds with no growth is expensive.
4. Sanity-check against sector norms using the peers listed in the metrics snapshot; state the sector median where available.
5. Conclude whether the stock is cheap, fair, or expensive relative to its own history and its sector — and say which comparison drives that call.

## Verdict Anchors

- Current multiples are at or below the company's own 3–5 year norms — weight 6
- Earnings yield is attractive versus risk-free alternatives given the company's growth — weight 7
- Price is not extreme relative to sector peers with similar quality — weight 6

## Charts

- type: bar | title: Current vs historical multiples | data: multiples_history
- type: line | title: Price and earnings yield history | data: earnings_yield_series

## Output Template

Lead with the verdict on price (cheap/fair/expensive), then the two or three multiples that matter most for this business type. Flag every comparison that lacked data rather than filling gaps with sector averages alone.

No-hallucination constraint: never invent P/E, P/B, EV/EBITDA, earnings-yield, or historical-multiple values. Every figure must be traced to a tool result in this session; when the price feed is down or history is unavailable, the affected anchor is INSUFFICIENT — not a remembered multiple.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
