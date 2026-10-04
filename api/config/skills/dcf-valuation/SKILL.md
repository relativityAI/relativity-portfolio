---
name: dcf-valuation
description: Intrinsic-value sanity check — earnings power, cash generation, and the price paid vs owner-earnings math.

metadata:
  title: DCF Valuation
  category: valuation
  version: "2"
---

## Purpose

Determines what the business is worth today from the cash it actually produces. The question is never "what is the price" but "what is the value" — and whether the current price leaves a margin of safety. This skill works from the company's real filings: earnings power, free cash flow, and the multiples the market currently pays for them.

## Method

1. Pull the TTM metrics snapshot; record current price, market capitalization, P/E, EV/EBITDA, and per-share figures (EPS, book value, FCF per share). Note explicitly which price-derived fields are missing (price_data=unavailable) and mark affected anchors INSUFFICIENT rather than reconstructing prices.
2. Pull the last five years of cash flows; take operating cash flow minus capital expenditure per year to trace free cash flow, and compute the historical FCF trajectory (growing, stable, erratic).
3. Build an owner-earnings view: TTM EPS and FCF per share, the growth the filings actually support (revenue_growth, earnings_growth), and a conservative range of sustainable growth — grounded in observed history, not optimism.
4. Cross-check with the market's own pricing: current P/E vs the growth implied by filings, EV/EBITDA vs the company's sector peers via compare_financial_metrics. Where a peer's symbol is unknown, resolve it with search_symbol first — never guess a ticker.
5. Compute margin-of-safety reasoning: at what growth and discount assumptions does the current price make sense, and do the filings support them? State plainly when the observed data cannot support the price.
6. Check reasonableness: implied multiples and growth assumptions must be plausible for the sector; flag any check that fails.



- The price embeds a growth assumption consistent with the company's actual historical revenue and earnings trajectory — weight 6
- Free cash flow generation is positive and stable or growing over the analyzed periods — weight 9
- Current valuation multiples are plausible relative to sector peers with similar quality — weight 5



- type: bar | title: Free cash flow — last 5 years | data: fcf_history
- type: bar | title: Peer comparison — valuation multiples | data: peer_valuation



State current price, TTM EPS/FCF per share, and the observed growth rates with their periods. Present the owner-earnings math transparently: what growth you assumed, why the filings support it, and what multiple the price implies. Name the two assumptions the valuation is most sensitive to. If filings data is unavailable, say so and mark the affected anchors INSUFFICIENT rather than guessing.

No-hallucination constraint: never fabricate intrinsic values, per-share figures, growth or discount-rate assumptions, or FCF numbers. Quote them only from get_financial_metrics / compare_financial_metrics / get_financials / get_cash_flows results in this session; an ungrounded value estimate is worse than none.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.

## Data Needs
- need: financials
- need: metrics

## Outputs
- kind: narrative | title: cash flows
- kind: narrative | title: discount rate
- kind: narrative | title: horizon

## Checklist
- id: dcf1 | question: cash flows supported by evidence? | needs: [financials, metrics]
- id: dcf2 | question: discount rate supported by evidence? | needs: [financials, metrics]
- id: dcf3 | question: horizon supported by evidence? | needs: [financials, metrics]
