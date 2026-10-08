/**
 * DCF artifact — a workbook the user can re-run by editing assumptions.
 *
 * `dcfModel` is the only place the arithmetic exists. It runs once at skill-run
 * time; its output becomes the cached `result` on every formula cell, so the file
 * shows numbers immediately and Excel recalculates when the user edits an input.
 * The formulas written into the workbook are written independently and must agree
 * with it — test/artifacts.test.ts asserts that they do.
 *
 * Observed cells (tool data) are plain; assumption cells are amber-filled with a
 * reason, because the data provider supplies no WACC. That is the point of the file.
 */
import { findSeries, parseObservation, pickNumber, pickSeries, type Series } from "./series.js";
import type { ArtifactDraft, ArtifactInput, RecipeCell, RecipeSheet, WorkbookRecipe } from "./types.js";

const RE_OCF = /operating[_\s-]?cash[_\s-]?flow|net[_\s-]?cash.*operat|cash.*(from|provided).*operat|total[_\s-]?cash.*operat/i;
const RE_CAPEX = /capital[_\s-]?expend|capex|purchase.*(property|equipment|fixed)|additions.*(asset|fixed)|acquisition.*(property|equipment)/i;
const RE_PRICE = /^(current_price|last_price|price|share_price|market_price)$/i;
const RE_MCAP = /^(market_cap|market_capitalization|market_capitalisation)$/i;
const RE_DEBT = /^(total_debt|total_borrowings|long[_\s-]?term[_\s-]?debt)$/i;
const RE_CASH = /^(cash_and_equivalents|cash_and_cash_equivalents|cash_equivalents)$/i;

const MONEY = "#,##0";
const PCT = "0.0%";
const PRICE = "#,##0.00";
const MULT = "0.0x";
const FACTOR = "0.0000";

const YEARS = 5;
const DISCOUNT_RATE = 0.1;
const TERMINAL_GROWTH = 0.025;

// ── the model ──────────────────────────────────────────────────────────────

export interface DcfInputs {
  /** Historical free cash flow, oldest → newest. Only the last value is used. */
  fcf: number[];
  discountRate: number;
  stageGrowth: number;
  terminalGrowth: number;
  years: number;
  netDebt: number;
  shares: number;
}

export interface DcfResult {
  baseFcf: number;
  projections: number[];
  discountFactors: number[];
  pvs: number[];
  pvExplicit: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  valuePerShare: number | null;
  /** False when discountRate <= terminalGrowth (Gordon growth undefined). */
  tvDefined: boolean;
}

export function dcfModel(i: DcfInputs): DcfResult {
  const base = i.fcf[i.fcf.length - 1] ?? 0;
  const projections: number[] = [];
  const discountFactors: number[] = [];
  const pvs: number[] = [];
  let pvExplicit = 0;
  for (let t = 1; t <= i.years; t++) {
    const projection = base * Math.pow(1 + i.stageGrowth, t);
    const df = 1 / Math.pow(1 + i.discountRate, t);
    projections.push(projection);
    discountFactors.push(df);
    pvs.push(projection * df);
    pvExplicit += projection * df;
  }

  const tvDefined = i.discountRate - i.terminalGrowth > 1e-9 && base > 0;
  const terminalValue = tvDefined
    ? (projections[projections.length - 1] * (1 + i.terminalGrowth)) / (i.discountRate - i.terminalGrowth)
    : 0;
  const pvTerminal = tvDefined ? terminalValue * discountFactors[discountFactors.length - 1] : 0;
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue - i.netDebt;

  return {
    baseFcf: base,
    projections,
    discountFactors,
    pvs,
    pvExplicit,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    valuePerShare: i.shares > 0 ? equityValue / i.shares : null,
    tvDefined,
  };
}

/** Compound annual growth rate of a positive series, or null if undefined. */
export function cagr(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!(first > 0) || !(last > 0)) return null;
  return Math.pow(last / first, 1 / (values.length - 1)) - 1;
}

// ── cell shorthands ────────────────────────────────────────────────────────

const head = (ref: string, value: string): RecipeCell => ({ ref, value, provenance: "observed" });
const label = (ref: string, value: string): RecipeCell => ({ ref, value, provenance: "observed" });
const obs = (ref: string, value: string | number | null, numFmt?: string, note?: string): RecipeCell =>
  ({ ref, value, numFmt, provenance: "observed", note });
const asm = (ref: string, value: number | string, numFmt: string, note: string): RecipeCell =>
  ({ ref, value, numFmt, provenance: "assumption", note });
/** "" is Excel's own blank-result convention; ExcelJS wants undefined there. */
const cached = (v: number | string | null): string | number | undefined => (v === null ? undefined : v);
const calc = (ref: string, formula: string, result: number | string | null, numFmt?: string, note?: string): RecipeCell =>
  ({ ref, formula, result: cached(result), numFmt, provenance: "observed", note });

const colLetter = (n: number): string => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const round = (n: number) => Number(n.toFixed(6));

// ── the builder ────────────────────────────────────────────────────────────

export function buildDcfRecipe(ctx: ArtifactInput): ArtifactDraft[] {
  const observations = ctx.observations.map((o) => ({ tool: o.tool, json: parseObservation(o.result) }));
  const seriesPerObservation = observations.map((o) => (o.json ? findSeries(o.json) : ([] as Series[])));

  const take = (re: RegExp): { series: Series; ref: number } | null => {
    for (let i = 0; i < seriesPerObservation.length; i++) {
      const hit = pickSeries(seriesPerObservation[i], re);
      if (hit && hit.points.length >= 2) return { series: hit, ref: i };
    }
    return null;
  };

  const ocfHit = take(RE_OCF);
  if (!ocfHit) {
    return [unavailable("No operating cash flow series with two or more periods was found in the tool results, so no DCF could be built.")];
  }
  const capexHit = take(RE_CAPEX);
  const hasCapex = !!capexHit;

  // Join capex onto the OCF periods by period label; unmatched periods get null.
  const capexByPeriod = new Map((capexHit?.series.points ?? []).map((p) => [p.period, p.value]));
  const periods = ocfHit.series.points.map((p) => ({
    period: p.period,
    ocf: p.value,
    capex: capexByPeriod.get(p.period) ?? null,
  }));

  // Providers differ on capex sign. If every value is non-positive it is already
  // an outflow (add it); otherwise treat magnitudes as outflows (subtract).
  const capexValues = periods.map((p) => p.capex).filter((v): v is number => v != null);
  const capexIsNegative = capexValues.length > 0 && capexValues.every((v) => v <= 0);
  const fcf = periods.map((p) =>
    p.capex == null ? p.ocf : capexIsNegative ? p.ocf + p.capex : p.ocf - p.capex,
  );

  const metricsJson = observations.find((o) => /metric/i.test(o.tool))?.json ?? null;
  const price = metricsJson ? pickNumber(metricsJson, RE_PRICE) : null;
  const marketCap = metricsJson ? pickNumber(metricsJson, RE_MCAP) : null;
  const totalDebt = metricsJson ? pickNumber(metricsJson, RE_DEBT) : null;
  const cashOnHand = metricsJson ? pickNumber(metricsJson, RE_CASH) : null;
  const shares = marketCap != null && price != null && price > 0 ? marketCap / price : null;

  const historicalCagr = cagr(fcf);
  const stageGrowth = historicalCagr == null ? 0.05 : clamp(historicalCagr, -0.05, 0.25);
  const netDebt = totalDebt != null ? totalDebt - (cashOnHand ?? 0) : 0;

  const model = dcfModel({
    fcf,
    discountRate: DISCOUNT_RATE,
    stageGrowth,
    terminalGrowth: TERMINAL_GROWTH,
    years: YEARS,
    netDebt,
    shares: shares ?? 0,
  });

  const hist = histSheet(periods, fcf, capexIsNegative, hasCapex);
  const assumptions = [
    { label: "Discount rate", value: pct(DISCOUNT_RATE), reason: "Default 10% required return — the provider supplies no WACC. Overwrite it." },
    { label: "Stage-1 FCF growth", value: pct(stageGrowth), reason: historicalCagr == null ? "No usable FCF history for a CAGR, so defaulted to 5%." : `${pct(historicalCagr)} historical FCF CAGR, clamped to [-5%, 25%].` },
    { label: "Terminal growth", value: pct(TERMINAL_GROWTH), reason: "2.5% approximates long-run nominal GDP. Must stay below the discount rate." },
    { label: "Projection years", value: String(YEARS), reason: "Standard explicit forecast horizon before the terminal value." },
  ];

  const sheets: RecipeSheet[] = [
    inputSheet(ctx, {
      discountRate: DISCOUNT_RATE, stageGrowth, terminalGrowth: TERMINAL_GROWTH, years: YEARS,
      netDebt, shares, price, marketCap, totalDebt, cashOnHand,
    }),
    hist,
    dcfSheet(model, hist.lastFcfCell, { stageGrowth, netDebt, shares, price }),
    sensitivitySheet(model, hist.lastFcfCell, stageGrowth, netDebt, shares),
  ];

  const formulaCount = sheets.reduce((n, s) => n + s.cells.filter((c) => c.formula).length, 0);
  const recipe: WorkbookRecipe = {
    kind: "xlsx",
    filename: `${ctx.symbol.replace(/[^\w.-]/g, "_")}_DCF_Model.xlsx`,
    description:
      `Discounted cash flow from ${periods.length} years of reported cash flow: ${YEARS}-year explicit forecast, ` +
      `Gordon-growth terminal value, and a 5x5 sensitivity grid. Every figure is a live formula — change an amber ` +
      `input and the whole model recalculates.`,
    sheets,
  };

  return [{
    status: hasCapex ? "ready" : "partial",
    recipe,
    summary: `${periods.length}y cash-flow history · ${YEARS}y forecast · ${formulaCount} live formulas · ${assumptions.length} editable assumptions`,
    assumptions,
    observation_refs: [ocfHit.ref, ...(capexHit ? [capexHit.ref] : [])],
    note: hasCapex
      ? undefined
      : "Capital expenditure was not in the cash-flow payload, so free cash flow equals operating cash flow. Add a capex row to Historical FCF and the model picks it up.",
  }];
}

function unavailable(message: string): ArtifactDraft {
  return { status: "unavailable", recipe: null, summary: "Workbook unavailable.", assumptions: [], observation_refs: [], note: message };
}

// ── sheets ─────────────────────────────────────────────────────────────────

/** Row refs are load-bearing: the DCF and Sensitivity sheets hardcode them. */
interface Observed {
  discountRate: number; stageGrowth: number; terminalGrowth: number; years: number;
  netDebt: number; shares: number | null; price: number | null; marketCap: number | null;
  totalDebt: number | null; cashOnHand: number | null;
}

function inputSheet(ctx: ArtifactInput, v: Observed): RecipeSheet {
  const cells: RecipeCell[] = [
    head("A1", `DCF inputs — ${ctx.shareName} (${ctx.symbol}, ${ctx.source})`),
    label("A3", "ASSUMPTIONS — amber cells, edit these"),
    asm("B4", v.discountRate, PCT, "Required return on the business. Default 10%; the provider supplies no WACC."),
    label("C4", "Default 10% required return. Overwrite with your own WACC."),
    asm("B5", v.stageGrowth, PCT, "Annual FCF growth across the explicit forecast, derived from the FCF history."),
    label("C5", "Historical FCF CAGR clamped to [-5%, 25%]."),
    asm("B6", v.terminalGrowth, PCT, "Perpetual growth after the forecast. Must stay below the discount rate."),
    label("C6", "2.5% approximates long-run nominal GDP."),
    asm("B7", v.years, "0", "Explicit forecast length before the terminal value."),
    label("C7", "Standard 5-year horizon."),
    label("A9", "OBSERVED — from the data provider"),
    label("A10", "Current price"),
    v.price != null ? obs("B10", v.price, PRICE, "get_financial_metrics") : obs("B10", null, PRICE, "price not returned by the provider"),
    label("C10", "get_financial_metrics"),
    label("A11", "Total debt"),
    v.totalDebt != null ? obs("B11", v.totalDebt, MONEY, "get_financial_metrics") : obs("B11", null, MONEY, "total debt not returned by the provider"),
    label("C11", "get_financial_metrics"),
    label("A12", "Cash & equivalents"),
    v.cashOnHand != null ? obs("B12", v.cashOnHand, MONEY, "get_financial_metrics") : obs("B12", null, MONEY, "cash not returned by the provider"),
    label("C12", "get_financial_metrics"),
    label("A13", "Net debt"),
    v.totalDebt != null
      ? calc("B13", "B11-IF(ISNUMBER(B12),B12,0)", v.netDebt, MONEY, "total debt less cash")
      : asm("B13", 0, MONEY, "Not derivable — total debt was unavailable. Enter debt minus cash here."),
    label("C13", "Debt less cash."),
    label("A14", "Shares outstanding"),
    v.shares != null
      ? calc("B14", "IF(AND(ISNUMBER(B10),B10>0,ISNUMBER(B15)),B15/B10,\"\")", v.shares, MONEY, "derived: market capitalisation ÷ current price")
      : asm("B14", 0, MONEY, "Not derivable — market capitalisation or price was unavailable. Enter the share count to get a per-share value."),
    label("C14", "Derived from market capitalisation ÷ price; enter manually if unavailable."),
    label("A15", "Market capitalisation"),
    v.marketCap != null ? obs("B15", v.marketCap, MONEY, "get_financial_metrics") : obs("B15", null, MONEY, "market capitalisation not returned by the provider"),
    label("C15", "get_financial_metrics"),
    head("A17", "Every amber cell is an assumption — change it and the whole model recalculates."),
  ];
  return { name: "Inputs", cells, colWidths: { A: 26, B: 16, C: 58 } };
}

function histSheet(
  periods: { period: string; ocf: number; capex: number | null }[],
  fcf: number[],
  capexIsNegative: boolean,
  hasCapex: boolean,
): RecipeSheet & { lastFcfCell: string } {
  const cells: RecipeCell[] = [
    head("A1", "Historical free cash flow (as reported)"),
    head("A3", "Period"), head("B3", "Operating cash flow"), head("C3", "Capital expenditure"),
    head("D3", "Free cash flow"), head("E3", "FCF growth"),
  ];
  const fcfExpr = (row: number) =>
    !hasCapex ? `B${row}` : capexIsNegative ? `B${row}+C${row}` : `B${row}-C${row}`;

  periods.forEach((p, i) => {
    const row = 4 + i;
    cells.push(obs(`A${row}`, p.period, undefined, "reporting period"));
    cells.push(obs(`B${row}`, p.ocf, MONEY, "get_cash_flows"));
    cells.push(p.capex == null
      ? obs(`C${row}`, null, MONEY, "not returned by the provider")
      : obs(`C${row}`, p.capex, MONEY, "get_cash_flows"));
    cells.push(calc(`D${row}`, fcfExpr(row), fcf[i], MONEY, !hasCapex
      ? "operating cash flow only — capex unavailable"
      : capexIsNegative
        ? "operating cash flow plus capex (capex reported as a negative outflow)"
        : "operating cash flow less capex (capex reported as a positive magnitude)"));
    if (i > 0) {
      cells.push(calc(`E${row}`, `IF(D${row - 1}>0,D${row}/D${row - 1}-1,"")`,
        fcf[i - 1] > 0 ? fcf[i] / fcf[i - 1] - 1 : "", PCT));
    }
  });

  const lastRow = 3 + periods.length;
  cells.push(head(`A${lastRow + 2}`, "FCF growth is blank when the prior year was not positive — there is no meaningful base to grow from."));
  return {
    name: "Historical FCF",
    cells,
    colWidths: { A: 14, B: 22, C: 22, D: 22, E: 12 },
    lastFcfCell: `'Historical FCF'!D${lastRow}`,
  };
}

function dcfSheet(m: DcfResult, histFcfCell: string, v: { stageGrowth: number; netDebt: number; shares: number | null; price: number | null }): RecipeSheet {
  const cells: RecipeCell[] = [
    head("A1", "Discounted cash flow"),
    head("A3", "Period"), head("B3", "Projected FCF"), head("C3", "Discount factor"), head("D3", "Present value"),
    label("A4", "Last actual"),
    calc("B4", histFcfCell, m.baseFcf, MONEY, "last reported free cash flow"),
    calc("C4", "1", 1, FACTOR),
    calc("D4", "B4*C4", m.baseFcf, MONEY),
  ];

  const years = m.projections.length;
  for (let t = 1; t <= years; t++) {
    const row = 4 + t;
    const prev = t === 1 ? "B4" : `B${row - 1}`;
    cells.push(label(`A${row}`, `Year ${t}`));
    cells.push(calc(`B${row}`, `${prev}*(1+Inputs!$B$5)`, m.projections[t - 1], MONEY, "prior year grown at the stage-1 assumption"));
    cells.push(calc(`C${row}`, `1/(1+Inputs!$B$4)^${t}`, m.discountFactors[t - 1], FACTOR));
    cells.push(calc(`D${row}`, `B${row}*C${row}`, m.pvs[t - 1], MONEY));
  }

  // Summary block. Every row is label + one B-column formula.
  const firstYearRow = 5;
  const lastYearRow = 4 + years;
  let r = lastYearRow + 2;
  const summary: RecipeCell[] = [];
  const add = (labelText: string, formula: string, result: number | string | null, numFmt: string, note?: string) => {
    summary.push(label(`A${r}`, labelText), calc(`B${r}`, formula, result, numFmt, note));
    r++;
  };

  add("Sum of PV, explicit forecast", `SUM(D${firstYearRow}:D${lastYearRow})`, m.pvExplicit, MONEY);
  const pvExplicitRow = r - 1;
  add("Terminal value (Gordon growth)",
    `IF(Inputs!$B$4-Inputs!$B$6<=0,"",B${lastYearRow}*(1+Inputs!$B$6)/(Inputs!$B$4-Inputs!$B$6))`,
    m.tvDefined ? m.terminalValue : "", MONEY,
    "final-year FCF grown once, capitalised at (discount rate − terminal growth)");
  const tvRow = r - 1;
  add("PV of terminal value", `IF(ISNUMBER(B${tvRow}),B${tvRow}*C${lastYearRow},"")`, m.pvTerminal, MONEY);
  const pvTvRow = r - 1;
  add("Enterprise value", `B${pvExplicitRow}+B${pvTvRow}`, m.enterpriseValue, MONEY);
  const evRow = r - 1;
  add("Less: net debt", "Inputs!$B$13", v.netDebt, MONEY);
  const netDebtRow = r - 1;
  add("Equity value", `B${evRow}-B${netDebtRow}`, m.equityValue, MONEY);
  const equityRow = r - 1;
  add("Shares outstanding", "IF(ISNUMBER(Inputs!$B$14),Inputs!$B$14,\"\")", v.shares ?? "", MONEY);
  const sharesRow = r - 1;
  add("Intrinsic value per share", `IF(N(B${sharesRow})>0,B${equityRow}/B${sharesRow},"")`, m.valuePerShare ?? "", PRICE);
  const vpsRow = r - 1;

  if (v.price != null) {
    add("Current price", "Inputs!$B$10", v.price, PRICE);
    const priceRow = r - 1;
    add("Margin of safety", `IF(ISNUMBER(B${vpsRow}),(B${vpsRow}-B${priceRow})/B${vpsRow},"")`,
      m.valuePerShare != null ? (m.valuePerShare - v.price) / m.valuePerShare : "", PCT);
    add("Price / intrinsic", `IF(ISNUMBER(B${vpsRow}),B${priceRow}/B${vpsRow},"")`,
      m.valuePerShare != null && m.valuePerShare > 0 ? v.price / m.valuePerShare : "", MULT);
  }

  cells.push(...summary);
  cells.push(head(`A${r + 1}`, m.tvDefined
    ? "Terminal value is the largest single component — the result is sensitive to the discount rate and terminal growth. Check the Sensitivity sheet."
    : "Terminal value is undefined at these assumptions (the discount rate must exceed terminal growth). The value above is the explicit forecast only."));
  return { name: "DCF", cells, colWidths: { A: 34, B: 18, C: 14, D: 18 } };
}

function sensitivitySheet(
  m: DcfResult,
  histFcfCell: string,
  stageGrowth: number,
  netDebt: number,
  shares: number | null,
): RecipeSheet {
  const cells: RecipeCell[] = [
    head("A1", "Sensitivity — intrinsic value per share"),
    label("A2", "Rows: discount rate. Columns: terminal growth. The centre cell is the base case."),
    label("A4", "Rate \\ growth"),
  ];
  const rateOffsets = [-0.02, -0.01, 0, 0.01, 0.02];
  const growthOffsets = [-0.01, -0.005, 0, 0.005, 0.01];
  const years = m.projections.length;

  growthOffsets.forEach((off, j) => {
    cells.push(asm(`${colLetter(2 + j)}4`, round(TERMINAL_GROWTH + off), PCT, "terminal growth scenario"));
  });

  rateOffsets.forEach((rateOff, i) => {
    const row = 6 + i;
    const rate = round(DISCOUNT_RATE + rateOff);
    cells.push(asm(`A${row}`, rate, PCT, "discount rate scenario"));
    growthOffsets.forEach((growthOff, j) => {
      const col = colLetter(2 + j);
      const growth = round(TERMINAL_GROWTH + growthOff);
      const result = rate - growth > 1e-9 && shares != null
        ? dcfModel({ fcf: [m.baseFcf], discountRate: rate, stageGrowth, terminalGrowth: growth, years, netDebt, shares }).valuePerShare
        : "";
      const pvTerms = Array.from({ length: years }, (_, t) =>
        `(${histFcfCell}*(1+Inputs!$B$5)^${t + 1})/(1+${rate})^${t + 1}`).join("+");
      const tv = `(${histFcfCell}*(1+Inputs!$B$5)^${years})*(1+${growth})/(${rate}-${growth})`;
      cells.push({
        ref: `${col}${row}`,
        formula: `IF(Inputs!$B$14<=0,"",((${pvTerms})+(${tv})/(1+${rate})^${years}-Inputs!$B$13)/Inputs!$B$14)`,
        result: cached(result),
        numFmt: PRICE,
        provenance: "assumption",
        note: "the full model re-run at this discount rate / terminal growth pair",
      });
    });
  });

  cells.push(head(`A${6 + rateOffsets.length + 1}`, "Each cell re-runs the whole model at its own pair — no Excel data-table feature needed."));
  return { name: "Sensitivity", cells, colWidths: { A: 22, B: 14, C: 14, D: 14, E: 14, F: 14 } };
}