---
name: profitability-quality
description: Returns on capital, margins, and free-cash conversion — is this a genuinely good business?
allowed-tools: get_financial_metrics get_financials
metadata:
  title: Profitability & Quality
  category: fundamentals
  version: "1"
---

## Purpose

Separates businesses that earn high returns on capital for long periods from businesses that merely look busy. Quality compounds; poor economics do not fix themselves with scale.

## Method

1. Pull the metrics snapshot: ROE, ROA, ROIC (or closest available), gross/operating/net margins, FCF yield or FCF margin.
2. Pull the annual income statements and cash flows for the last five years; compute margin trend per period (improving, stable, eroding).
3. Check earnings quality: compare net income with operating cash flow — persistent gaps between the two are a red flag.
4. Check reinvestment economics: incremental returns on newly retained capital, not just the headline ROE.
5. Place the company in a quality tier for its sector (top quartile, median, bottom quartile) using the peer context in the snapshot.

## Verdict Anchors

- Returns on capital are high relative to the cost of capital and the sector — weight 9
- Margins are stable or improving over the analyzed periods — weight 7
- Reported earnings are backed by operating cash flow (high cash conversion) — weight 7

## Charts

- type: line | title: Operating margin — last 5 years | data: operating_margin_series
- type: bar | title: Net income vs operating cash flow — last 5 years | data: earnings_vs_cashflow

## Output Template

Lead with the quality tier and the return-on-capital figure, then the margin trend and the earnings-vs-cash conversion check. Quote the exact figures for ROE/ROIC and note explicitly if any had to be derived from raw statements rather than the snapshot.

No-hallucination constraint: quote ROE/ROA/ROIC, margins, and cash-flow figures only from get_financial_metrics and get_financials results in this session. Never approximate a missing ratio from sector intuition or compute a figure the tools did not provide the inputs for — mark it unavailable instead.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
