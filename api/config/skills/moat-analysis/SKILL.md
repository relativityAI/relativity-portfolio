---
name: moat-analysis
description: Durable competitive advantages — brand, network effects, switching costs, cost position, and whether the moat is widening.
allowed-tools: get_financial_metrics get_announcements read_latest_transcript read_latest_presentation web_search
metadata:
  title: Moat Analysis
  category: qualitative
  version: "1"
---

## Purpose

Identifies what protects this company's profits from competitors over decades, and whether that protection is strengthening or eroding. A moat is the difference between a good business and a good business that stays good.

## Method

1. Classify the moat type(s): brand, network effects, switching costs, cost advantage, efficient scale, intangible assets, regulatory position. Some companies have none — say so.
2. Test each claimed moat against evidence: pricing power (gross margins vs peers), customer lock-in (retention, switching language in transcripts), share stability over time.
3. Read the latest earnings transcript and investor presentation for management's own claims about competition; note gaps between claims and numbers.
4. Check moat trajectory: are margins and returns stable or improving (widening) or under attack (eroding)? Look at the last five years.
5. Identify the single most likely moat-destroyer: technology shift, new entrant, regulation, or buyer consolidation.

## Verdict Anchors

- A specific, identifiable competitive advantage exists (not just "they are big") — weight 8
- The advantage shows in the numbers: stable or rising margins, pricing power, stable share — weight 8
- The moat is stable or widening, not visibly eroding — weight 7

## Charts

- type: line | title: Gross margin trend — last 5 years | data: gross_margin_series

## Output Template

Name the moat type in the first sentence, then the evidence for and against its durability. Endings matter: state whether the moat is widening, stable, or eroding, and the most likely destroyer.

No-hallucination constraint: never invent margin figures, share numbers, competitor names, or transcript quotes. Cite only what get_financial_metrics, get_announcements, the transcript/presentation tools, or web_search actually returned; where evidence is thin, say the moat case is unproven rather than filling it with plausible-sounding detail.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
