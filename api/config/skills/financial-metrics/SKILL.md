---
name: financial-metrics
description: Analyze a company's financial metrics and ratios using reliable financial data. Use for profitability, growth, liquidity, leverage, efficiency, cash flow, and per-share metrics. Do not perform intrinsic valuation or estimate fair value.
---

# Financial Metrics Analysis

## Purpose

Analyze a company's financial health and operating performance through financial metrics and ratios.

The output should explain:
- What each metric says about the company
- Whether the metric is improving or deteriorating
- How the company compares with its historical performance
- How the company compares with relevant peers or industry norms when data is available
- Important red flags, strengths, and inconsistencies

This skill is **not a valuation skill**. Do not calculate DCF, intrinsic value, price targets, or valuation multiples as a valuation conclusion.

---

## 1. Data Requirements

Prefer:
1. Company filings and annual reports
2. Regulatory filings
3. Official company financial statements
4. High-quality structured financial databases

Use the most recent reliable data available.

For every metric:
- Identify the reporting period
- Keep units consistent
- Distinguish quarterly, annual, and trailing-twelve-month figures
- Do not mix GAAP/IFRS figures with adjusted/non-GAAP figures without explicitly labeling them
- If a required input is unavailable, mark the metric as unavailable rather than estimating it silently

---

## 2. Metric Categories

### A. Growth

Analyze:

- Revenue Growth
- Gross Profit Growth
- EBITDA Growth
- EBIT Growth
- Operating Income Growth
- Net Income Growth
- EPS Growth
- Free Cash Flow Growth

Formula:

`Growth % = (Current Period - Prior Period) / Prior Period × 100`

Where meaningful, calculate:
- YoY growth
- 3-year CAGR
- 5-year CAGR

Interpret growth in context:
- Accelerating
- Stable
- Decelerating
- Negative

Do not treat high growth as automatically positive. Check whether growth is accompanied by improving or deteriorating margins and cash flow.

---

### B. Profitability

Analyze:

- Gross Margin
- EBITDA Margin
- EBIT Margin
- Operating Margin
- Net Profit Margin
- ROE
- ROA
- ROIC

Common formulas:

`Gross Margin = Gross Profit / Revenue`

`EBITDA Margin = EBITDA / Revenue`

`EBIT Margin = EBIT / Revenue`

`Net Margin = Net Income / Revenue`

`ROE = Net Income / Average Shareholders' Equity`

`ROA = Net Income / Average Total Assets`

`ROIC = NOPAT / Average Invested Capital`

For ROE, distinguish genuine operational improvement from ROE inflated by high leverage or very low equity.

For ROIC, clearly state the methodology used because definitions of invested capital and NOPAT can differ.

---

### C. Liquidity

Analyze:

- Current Ratio
- Quick Ratio
- Cash Ratio
- Operating Cash Flow / Current Liabilities

Formulas:

`Current Ratio = Current Assets / Current Liabilities`

`Quick Ratio = (Cash + Short-Term Investments + Receivables) / Current Liabilities`

`Cash Ratio = Cash and Cash Equivalents / Current Liabilities`

Explain whether the company appears capable of meeting short-term obligations.

Do not automatically treat a low current ratio as a problem; consider the company's business model and working-capital cycle.

---

### D. Leverage and Solvency

Analyze:

- Debt-to-Equity
- Debt-to-Assets
- Net Debt
- Net Debt / EBITDA
- Debt / EBITDA
- Interest Coverage
- Cash Flow / Debt

Formulas:

`Net Debt = Total Debt - Cash and Cash Equivalents`

`Debt-to-Equity = Total Debt / Shareholders' Equity`

`Debt-to-Assets = Total Debt / Total Assets`

`Net Debt / EBITDA = Net Debt / EBITDA`

`Interest Coverage = EBIT / Interest Expense`

Interpret leverage relative to:
- Historical levels
- Earnings stability
- Cash generation
- Industry norms
- Debt maturity/refinancing requirements when available

Flag situations where leverage is rising while profitability or cash flow is weakening.

---

### E. Efficiency

Analyze:

- Asset Turnover
- Inventory Turnover
- Receivables Turnover
- Payables Turnover
- Days Sales Outstanding (DSO)
- Days Inventory Outstanding (DIO)
- Days Payables Outstanding (DPO)
- Cash Conversion Cycle (CCC)

Formulas:

`Asset Turnover = Revenue / Average Total Assets`

`Inventory Turnover = COGS / Average Inventory`

`Receivables Turnover = Revenue / Average Accounts Receivable`

`DSO = Average Accounts Receivable / Revenue × 365`

`DIO = Average Inventory / COGS × 365`

`DPO = Average Accounts Payable / COGS × 365`

`CCC = DSO + DIO - DPO`

Look for:
- Increasing receivables relative to sales
- Inventory accumulation
- Improving or worsening working-capital efficiency
- Material changes in the cash conversion cycle

---

### F. Cash Flow Quality

Analyze:

- Operating Cash Flow
- Free Cash Flow
- Free Cash Flow Margin
- Operating Cash Flow Margin
- Cash Conversion
- Capex Intensity

Common formulas:

`FCF = Operating Cash Flow - Capital Expenditures`

`FCF Margin = Free Cash Flow / Revenue`

`OCF Margin = Operating Cash Flow / Revenue`

`Cash Conversion = Operating Cash Flow / Net Income`

`Capex Intensity = Capital Expenditures / Revenue`

Pay particular attention to discrepancies between:
- Net income and operating cash flow
- EBITDA and free cash flow
- Revenue growth and receivables growth

Flag persistent earnings growth without corresponding cash generation.

---

### G. Per-Share Metrics

Analyze:

- EPS
- Diluted EPS
- Revenue per Share
- Book Value per Share
- Free Cash Flow per Share
- Shares Outstanding Growth/Dilution

Always prefer diluted shares when analyzing diluted EPS.

Flag:
- Stock-based compensation-driven dilution
- Buybacks reducing share count
- EPS growth materially exceeding net-income growth because of share-count changes

---

## 3. Analysis Method

For each important metric:

1. Calculate or retrieve the metric.
2. Compare it with the previous period.
3. Compare it with the company's longer-term trend when enough data exists.
4. Compare it with relevant peers when appropriate.
5. Determine the direction:
   - Improving
   - Stable
   - Deteriorating
   - Mixed
6. Explain the likely business meaning.
7. Flag unusual or potentially concerning movements.

Avoid interpreting any single ratio in isolation.

---

## 4. Cross-Metric Checks

Always look for relationships between metrics.

Examples:

### Revenue Quality
If revenue grows rapidly:
- Check receivables growth
- Check operating cash flow
- Check margins
- Check inventory
- Check organic vs acquisition-driven growth when data is available

### Profitability Quality
If net margin improves:
- Check gross margin
- Check operating margin
- Check interest expense
- Check tax rate
- Check one-time gains/losses

### ROE Quality
If ROE increases:
- Check ROA
- Check leverage
- Check equity changes
- Check buybacks

### Cash Flow Quality
If net income rises but FCF falls:
- Check working capital
- Check capex
- Check receivables
- Check inventory
- Check one-off items

### Leverage Risk
If debt increases:
- Check EBITDA
- Check interest coverage
- Check operating cash flow
- Check net debt
- Check debt maturity profile when available

---

## 5. Historical Trend Analysis

When sufficient data is available, prefer a multi-year view.

For each major metric identify:
- Current value
- Prior-year value
- 3-year trend
- 5-year trend when available
- Best/worst recent level
- Direction of change

Do not overstate conclusions from one abnormal year.

---

## 6. Peer Comparison

Peer comparisons should use genuinely comparable companies.

Consider:
- Industry
- Business model
- Geography
- Company size
- Capital intensity
- Accounting differences

Prefer median or range comparisons over arbitrary single-peer comparisons.

Example:

| Metric | Company | Peer Median | Assessment |
|---|---:|---:|---|
| Revenue Growth | 18% | 11% | Above peers |
| EBIT Margin | 14% | 10% | Strong |
| ROIC | 16% | 12% | Above peers |
| Net Debt / EBITDA | 2.8x | 1.9x | Higher leverage |

Do not call a metric "good" solely because it is numerically higher. The appropriate direction depends on the metric and business model.

---

## 7. Red Flags

Look for:

- Revenue growth with weak or negative operating cash flow
- Receivables growing faster than revenue
- Inventory growing faster than revenue
- Persistent negative free cash flow
- Declining gross or operating margins
- Rising debt with stagnant earnings
- Falling interest coverage
- High leverage combined with weak cash generation
- Large gap between adjusted and reported earnings
- Repeated one-time adjustments
- Significant share dilution
- ROE rising mainly because of increased leverage
- Sudden changes in working capital
- Material deterioration in liquidity

Red flags are signals for investigation, not automatic proof of financial problems.

---

## 8. Output Structure

Produce a concise but analytical report.

### Executive Summary
Give 3–6 key conclusions.

### Growth
Show major growth metrics and trends.

### Profitability
Show margins, ROE, ROA, and ROIC.

### Liquidity & Leverage
Show short-term liquidity and debt-related metrics.

### Efficiency
Show working-capital and asset-efficiency metrics.

### Cash Flow
Assess cash generation and earnings quality.

### Per-Share Metrics
Assess EPS, FCF/share, and dilution.

### Key Strengths
List the strongest financial characteristics.

### Key Risks / Red Flags
List the most important concerns.

### Overall Financial Health
Give a qualitative assessment such as:
- Strong
- Healthy
- Mixed
- Weak
- Distressed

Support the assessment with the most important metrics.

---

## 9. Presentation Rules

Use tables for metric-heavy information.

For each table include:
- Metric
- Current
- Previous / historical value
- Change
- Interpretation

Example:

| Metric | Current | Previous | Change | Interpretation |
|---|---:|---:|---:|---|
| Revenue Growth | 18.2% | 12.4% | +5.8 pp | Growth accelerating |
| EBIT Margin | 14.1% | 12.8% | +1.3 pp | Profitability improving |
| ROIC | 16.0% | 14.2% | +1.8 pp | Capital efficiency improving |
| Net Debt / EBITDA | 2.1x | 1.6x | +0.5x | Leverage increasing |

Use percentage points (`pp`) when comparing percentages.

Do not confuse:
- 10% → 12% = +2 percentage points
- 10% → 12% = +20% relative increase

---

## 10. Important Rules

- Never fabricate missing financial data.
- Never silently substitute EBITDA for EBIT.
- Clearly distinguish gross debt from net debt.
- Clearly distinguish reported and adjusted metrics.
- Use average assets/equity where the metric convention requires it.
- Explain unusual accounting effects when identifiable.
- Do not make investment recommendations solely from financial metrics.
- Do not calculate intrinsic value, DCF, target price, or fair value under this skill.
- Do not treat one ratio as sufficient evidence of financial strength or weakness.
