---
name: competitor-analysis
description: Market share, peer benchmarking, and relative competitive position within the industry.
allowed-tools: web_search search_news get_financial_metrics compare_financial_metrics search_symbol get_financials list_categories
metadata:
  title: Competitor Analysis
  category: qualitative
  version: "1"
---

## Purpose

Every company competes for the same customer's money. This skill benchmarks the company against its real competitors — on share, margins, growth, and returns — to answer one question: is this the leader worth paying up for, or a laggard that looks cheap for a reason?

## Method

1. Identify the three to five closest competitors (web search + industry knowledge; name them explicitly).
2. Resolve each peer's ticker with search_symbol (never guess one), then benchmark the company vs each peer in ONE compare_financial_metrics call: revenue growth, margins, ROE/ROIC, valuation multiples.
3. Assess relative position: is the company gaining or losing share? Use segment data, announcements, and third-party rankings with sources.
4. Identify each peer's edge — and whether the company's edge is stronger, weaker, or different in kind.
5. Conclude on relative strength: leader, strong challenger, or laggard — and what that implies for the multiple it deserves.

## Verdict Anchors

- The company holds or is gaining share against its named competitors — weight 7
- The company's growth and profitability rank at or near the top of its peer set — weight 8
- The company's competitive edge is distinct and defensible relative to peers — weight 6

## Charts

- type: bar | title: Peer comparison — key metrics | data: peer_benchmark

## Output Template

Name the peer set in the first paragraph (with the benchmark table), then the relative-position verdict. Every peer figure needs a source or an explicit note that it is an approximation from public data.

No-hallucination constraint: name only competitors you can support from web_search or tool results in this session — never a generic industry roster from memory. A peer metric with no observed source is omitted from the benchmark, not guessed; write "figure unavailable" in that cell.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
