---
name: growth-analysis
description: Multi-period revenue and EPS growth, acceleration or deceleration, and the durability of the growth engine.
allowed-tools: get_financials get_financial_metrics get_announcements
metadata:
  title: Growth Analysis
  category: fundamentals
  version: "1"
---

## Purpose

Measures whether the business is actually compounding — and whether that compounding is speeding up or slowing down. Growth level matters less than trajectory: a company decelerating from 40% to 20% growth is re-rating, not growing. Five quarters of revenue history should always be plotted.

## Method

1. Pull quarterly revenue and EPS for at least the last five quarters (and five years annually where available).
2. Compute year-over-year growth per period and the quarter-over-quarter trend of that growth rate (accelerating, stable, decelerating).
3. Identify the drivers: volume vs price, new products, new markets, acquisitions — use announcements and segment data where present.
4. Assess durability: is growth funded by reinvestment (good) or leverage (fragile)? Is the growth rate dependent on one customer, product, or cycle?
5. Compare growth with the capital deployed to achieve it (revenue growth vs dilution and debt growth).

## Verdict Anchors

- Revenue is growing at a healthy and consistent rate over the analyzed periods — weight 8
- Earnings growth keeps pace with revenue growth (margin not collapsing to buy growth) — weight 7
- The growth trajectory is stable or accelerating, not decelerating for consecutive periods — weight 8
- Growth is funded internally (no heavy dilution or debt accumulation to buy it) — weight 6

## Charts

- type: bar | title: Revenue — last 5 quarters | data: revenue_by_quarter
- type: line | title: Year-over-year revenue growth trend | data: revenue_growth_series
- type: bar | title: EPS — last 5 quarters | data: eps_by_quarter

## Output Template

Always report the last five quarters of revenue and EPS with the YoY growth rate per period, then the trajectory call (accelerating/stable/decelerating) with the evidence. Name the single biggest growth driver and the single biggest risk to it.

No-hallucination constraint: never estimate revenue, EPS, or growth rates for a period the tools did not return. If fewer than five quarters are available, chart and quote only what was observed and say how many periods were found — never extrapolate the missing ones.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
