---
name: management-quality
description: Capital allocation track record, governance, insider alignment, and honesty in shareholder communication.
allowed-tools: get_announcements read_latest_transcript get_shareholdings web_search
metadata:
  title: Management Quality
  category: qualitative
  version: "1"
---

## Purpose

Great businesses run by self-interested or incompetent managers are poor bets. This skill evaluates the people: how they allocate capital, how they treat shareholders, and whether their words match their numbers.

## Method

1. Trace the capital-allocation record: acquisitions, buybacks, dividends, capex over the last five years. Was each deal accretive or dilutive? Were buybacks made above or below intrinsic value?
2. Check insider ownership and recent buying/selling from the shareholding data.
3. Read the latest earnings transcript: does management guide honestly, admit mistakes, and discuss capital allocation in owner-like terms?
4. Review announcements for governance signals: related-party transactions, frequent restructurings, auditor changes,pledged promoter shares.
5. Compare promised targets from prior years with delivered results — a track record of sandbagging or over-promising is a finding either way.

## Verdict Anchors

- Capital allocation has been disciplined and shareholder-oriented over five years — weight 8
- Insider ownership and recent transactions align management with shareholders — weight 6
- Management communication is transparent and its past guidance matched delivery — weight 7

## Charts

- type: bar | title: Shares outstanding — last 5 years | data: shares_outstanding_series

## Output Template

Open with the capital-allocation verdict (owner-like, adequate, or value-destroying) with one concrete deal or buyback example. Note insider alignment and any governance flags. If shareholding data is unavailable for this exchange, mark the alignment anchor INSUFFICIENT.

No-hallucination constraint: never fabricate deal values, buyback sizes, guidance numbers, governance incidents, or management quotes. Deal examples must come from get_announcements, read_latest_transcript, or dated web_search results in this session; a claim you cannot point to is left out.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
