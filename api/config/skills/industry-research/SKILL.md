---
name: industry-research
description: Industry size, growth, structure, technology shifts, and regulation — the tide the company floats on.

metadata:
  title: Industry Research
  category: qualitative
  version: "1"
---

## Purpose

A great operator in a terrible industry still fights the tide. This skill assesses the industry's trajectory, structure, and forces — to know whether the company's addressable future is expanding or shrinking, and how hard the game is to win.

## Method

1. Identify the industry and its size/growth (use web search; state the source and year of every figure).
2. Assess structure: concentration, the company's position in it, and whether the industry rewards scale or fragmentation.
3. Map the demand drivers over the next five years and the technology or regulatory shifts that could reorder the industry.
4. Check industry economics: is the whole industry profitable, or do profits concentrate in a few players while the rest churn?
5. Conclude: tailwind, headwind, or crosscurrent — and what would change that call.



- The industry is growing or structurally advantaged over the next five years — weight 7
- Industry economics allow most participants (or at least the leaders) to earn good returns — weight 6
- No imminent technology or regulatory shift threatens to reorder the industry against the company — weight 7



- type: bar | title: Company revenue vs industry growth rate | data: industry_growth_series
- type: bar | title: Peer revenue scale in the industry | data: peer_industry_scale



Lead with the tailwind/headwind call and the industry growth figure with its source. Two or three forces that will shape the next five years, each one sentence. Cite sources for external claims — no unsourced market-size numbers.

No-hallucination constraint: no invented market sizes, growth rates, or regulatory dates. Every industry figure must come from a web_search result in this session and carry its source; with no search evidence, state the assessment is qualitative and mark the growth anchor INSUFFICIENT.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.

## Data Needs
- need: news
- need: macro
- need: peers

## Outputs
- kind: narrative | title: industry structure
- kind: narrative | title: trends
- kind: narrative | title: implications

## Checklist
- id: ind1 | question: industry structure supported by evidence? | needs: [news, macro, peers]
- id: ind2 | question: trends supported by evidence? | needs: [news, macro, peers]
- id: ind3 | question: implications supported by evidence? | needs: [news, macro, peers]
