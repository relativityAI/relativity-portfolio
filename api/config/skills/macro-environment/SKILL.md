---
name: macro-environment
description: Rates, cycle position, currency, and market direction — the weather the stock operates in.
allowed-tools: get_macro_snapshot get_market_news search_news web_search
metadata:
  title: Macro Environment
  category: macro
  version: "1"
---

## Purpose

No stock trades in a vacuum. This skill assesses the macro weather — rates, cycle, currency, and broad-market direction — and what it means for this specific business's earnings and for the investor's aggressiveness right now.

## Method

1. Pull the macro snapshot: index levels, trailing returns, and market direction for this market.
2. Market direction: are broad indices trending up or down, and how would that amplify or mute this stock?
3. Rate and cycle sensitivity: does this business benefit or suffer from the current rate direction (banks vs leveraged borrowers vs cash-rich)? Reason from the balance sheet data in get_financial_metrics when available.
4. Currency and input exposure: import/export orientation, commodity input costs visible in the margins — use news coverage to date any macro shift.
5. Cycle position: is this a defensive, cyclical, or growth business, and where are we in the cycle for it?

## Verdict Anchors

- The current macro environment is neutral or favorable for this business model — weight 6
- The macro risks to earnings (rates, currency, inputs) are identifiable and manageable — weight 6
- Broad-market direction does not contradict the investment case — weight 5

## Charts

- type: table | title: Macro snapshot | data: macro_table

## Output Template

Lead with the favorable/unfavorable call for this specific business, reasoned from its actual balance sheet and margins (not generic commentary). Name the single macro variable that matters most to this company.

No-hallucination constraint: never invent index levels, returns, policy rates, inflation figures, or currency moves. Quote them only from get_macro_snapshot, get_market_news, search_news, or web_search results in this session; if the macro snapshot is unavailable, reason qualitatively from the company's observed financials and say the macro data was missing.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
