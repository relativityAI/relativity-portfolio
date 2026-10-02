---
name: balance-sheet-strength
description: Leverage, liquidity, and debt headroom — can the company survive its own capital structure?
allowed-tools: get_financial_metrics get_balance_sheets get_cash_flows
metadata:
  title: Balance Sheet Strength
  category: fundamentals
  version: "1"
---

## Purpose

A capital structure is a survival question before it is a returns question. This skill measures whether the company's debt load is an anchor, a tool, or a threat — across rate cycles and revenue shocks.

## Method

1. Pull the metrics snapshot: debt-to-equity, interest coverage, current ratio, and any net-debt/EBITDA figure available.
2. Pull the last five years of balance sheets: total debt, cash, and equity trend; compute net debt per period.
3. Compute debt maturity and refinancing exposure qualitatively from the statements (short-term debt share where disclosed).
4. Stress-test: would interest coverage survive a 30% earnings decline? Would the company remain liquid through a two-year revenue freeze given current cash and flow?
5. Compare leverage with sector norms and with the company's own history.

## Verdict Anchors

- Leverage is conservative relative to cash flows and sector norms — weight 8
- Interest coverage comfortably exceeds obligations even under stress — weight 8
- Liquidity (cash + flow) covers near-term obligations without refinancing risk — weight 7

## Charts

- type: line | title: Net debt and equity — last 5 years | data: net_debt_equity_series
- type: bar | title: Debt vs cash — last 5 years | data: debt_vs_cash

## Output Template

State leverage, coverage, and liquidity with exact figures, then the stress-test result. If the company is effectively debt-free or a financial whose balance sheet is the business, say so explicitly and adjust the anchors' framing rather than mechanically failing them.

No-hallucination constraint: never invent debt, cash, interest-coverage, or current-ratio figures. Quote them only from get_financial_metrics / get_balance_sheets / get_cash_flows results in this session; the stress test reasons from the observed figures — it does not assume ones it never saw.

Citation requirement (mandatory): every finding and every verdict evidence line MUST carry a citation — the tool the figure came from (e.g. get_financial_metrics) and, when the data came from the public web or a filing document, the exact URL. A number without a citation reads as invented and will be flagged.
