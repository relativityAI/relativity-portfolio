---
name: market-news-sentiment
description: Recent news, institutional activity, retail sentiment, and the narrative around the stock.

metadata:
  title: Market News & Sentiment
  category: market
  version: "1"
---

## Purpose

Prices move on information and positioning. This skill surveys what is actually being said and done around the stock right now — news flow, institutional sponsorship, retail chatter — and separates signal from noise.

## Method

1. Pull the latest company news and announcements; classify each item: earnings, product, legal/regulatory, management change, market rumor.
2. Distinguish new information from re-reporting; date-stamp every material item.
3. Check institutional sponsorship: is institutional ownership rising or falling in the latest periods available?
4. Sample retail sentiment (Reddit/social) — useful as a contrarian indicator; note extreme euphoria or despair but never treat it as evidence of fundamentals.
5. Weigh the narrative: is the current story consistent with the numbers, ahead of them, or refuted by them?



- Recent material news is net-neutral or favorable (no unresolved red flags) — weight 6
- Institutional sponsorship is stable or growing — weight 5
- The prevailing narrative is consistent with the reported numbers — weight 6



- type: table | title: Recent material announcements | data: announcements_table



Summarize the three most material news items with dates, then the sponsorship and sentiment picture. Explicitly separate fact (announcements, filings) from chatter. Mark INSUFFICIENT where news coverage for this exchange is thin.

No-hallucination constraint: never invent headlines, dates, sentiment claims, or ownership trends. Every news item must be traceable to a get_ticker_news / get_market_news / search_news / get_announcements / web_search result in this session; with no coverage, say so — do not summarize coverage you did not see.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.

## Data Needs
- need: news
- need: price

## Outputs
- kind: narrative | title: material news
- kind: narrative | title: sentiment
- kind: narrative | title: price reaction

## Checklist
- id: mns1 | question: material news supported by evidence? | needs: [news, price]
- id: mns2 | question: sentiment supported by evidence? | needs: [news, price]
- id: mns3 | question: price reaction supported by evidence? | needs: [news, price]
