---
name: insider-ownership
description: Who owns the company, what insiders are doing with their own money, and what the float implies.
allowed-tools: get_shareholdings get_announcements web_search
metadata:
  title: Insider & Ownership Signals
  category: qualitative
  version: "1"
---

## Purpose

Follow the money of the people who know the business best. This skill reads the ownership register and insider transactions — promoter conviction, institutional accumulation or distribution, and pledged shares — as signals, never as proof.

## Method

1. Pull the latest shareholding pattern: promoter, institutional (FII/DII or 13F-style), public, and any custody/pledge disclosures.
2. Trend it: are promoters buying or selling? Are institutions accumulating or distributing over the recent quarters available?
3. Check for pledged shares or unusual custody patterns — a governance red flag when promoters pledge heavily.
4. Check float and concentration: a tiny free float amplifies both directions; heavy single-investor concentration is a risk in itself.
5. Weigh the totality: conviction signal, distribution signal, or no signal — with the specific transactions as evidence.

## Verdict Anchors

- Insider/promoter ownership is high or rising (skin in the game) — weight 6
- No material pledge, dilution, or distress signals in recent insider activity — weight 7
- Institutional ownership trend supports (or at least does not contradict) the thesis — weight 5

## Charts

- type: bar | title: Shareholding pattern — latest periods | data: shareholding_series

## Output Template

Open with the net signal (accumulation, distribution, neutral) and the two or three transactions or trends that drive it. Quote exact ownership percentages. If shareholding disclosures are unavailable or stale for this exchange, mark all anchors INSUFFICIENT rather than inferring from price action.

No-hallucination constraint: never invent promoter/institutional percentages, pledge details, or transaction dates. Quote only from get_shareholdings and get_announcements results (or dated web_search results) in this session; absent data means INSUFFICIENT, never an ownership figure recalled from memory.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
