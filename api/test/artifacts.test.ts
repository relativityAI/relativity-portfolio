/**
 * Artifact pipeline tests.
 *
 * The important one: every formula cell's cached result must equal what Excel
 * will compute from the workbook's other cells. If the DCF model and the
 * workbook formulas diverge, the user opens the file, edits an assumption, and
 * watches the number jump — so this asserts agreement, not just shape.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildDcfRecipe, cagr, dcfModel } from "../src/skills/artifacts/dcf.js";
import { renderXlsx, safeSheetName } from "../src/skills/artifacts/xlsx.js";
import { findSeries, parseObservation, pickNumber } from "../src/skills/artifacts/series.js";
import type { ArtifactInput, WorkbookRecipe } from "../src/skills/artifacts/types.js";
import { verifyRecipe } from "./helpers/xlformula.js";

// ── fixtures ───────────────────────────────────────────────────────────────

/** Voyager long shape: a period column plus numeric columns, capex negative. */
const CASH_FLOWS = JSON.stringify({
  symbol: "TCS",
  annual: [
    { fiscal_year: "FY2020", net_cash_from_operating_activities: 8200, capital_expenditure: -1200 },
    { fiscal_year: "FY2021", net_cash_from_operating_activities: 9100, capital_expenditure: -1350 },
    { fiscal_year: "FY2022", net_cash_from_operating_activities: 10400, capital_expenditure: -1500 },
    { fiscal_year: "FY2023", net_cash_from_operating_activities: 11800, capital_expenditure: -1600 },
    { fiscal_year: "FY2024", net_cash_from_operating_activities: 13200, capital_expenditure: -1750 },
  ],
});

const METRICS = JSON.stringify({
  symbol: "TCS",
  current_price: 3450,
  market_cap: 12_400_000_000,
  total_debt: 250_000_000,
  cash_and_equivalents: 900_000_000,
});

const ctx = (
  observations: { tool: string; result: string }[],
  overrides: Partial<ArtifactInput> = {},
): ArtifactInput => ({
  skillId: "dcf-valuation",
  skillCategory: "valuation",
  symbol: "TCS",
  shareName: "Tata Consultancy Services",
  source: "NSE",
  observations: observations.map((o) => ({ ...o, status: "success" })),
  ...overrides,
});

const FULL = ctx([
  { tool: "get_cash_flows", result: CASH_FLOWS },
  { tool: "get_financial_metrics", result: METRICS },
]);

// What the builder derives from the fixture above.
const BASE_FCF = 11450; // FY2024: 13200 OCF + (-1750) capex
const STAGE_GROWTH = (11450 / 7000) ** (1 / 4) - 1;
const NET_DEBT = 250_000_000 - 900_000_000; // net cash
const SHARES = 12_400_000_000 / 3450;
const BASE_CASE = dcfModel({
  fcf: [BASE_FCF], discountRate: 0.1, stageGrowth: STAGE_GROWTH,
  terminalGrowth: 0.025, years: 5, netDebt: NET_DEBT, shares: SHARES,
});

const recipeOf = (input: ArtifactInput): WorkbookRecipe => {
  const drafts = buildDcfRecipe(input);
  const ready = drafts.find((d) => d.recipe);
  if (!ready?.recipe) throw new Error(`expected a recipe, got: ${drafts[0]?.note}`);
  return ready.recipe;
};

const cellAt = (recipe: WorkbookRecipe, sheet: string, ref: string) => {
  const cell = recipe.sheets.find((s) => s.name === sheet)?.cells.find((c) => c.ref === ref);
  if (!cell) throw new Error(`no cell ${sheet}!${ref}`);
  return cell;
};

const labelAt = (recipe: WorkbookRecipe, sheet: string, ref: string): string => {
  const v = cellAt(recipe, sheet, ref).value;
  if (typeof v !== "string") throw new Error(`${sheet}!${ref} is not a label`);
  return v;
};

// ── series extraction ──────────────────────────────────────────────────────

describe("series extraction", () => {
  it("turns a period-keyed long table into named numeric series", () => {
    const ocf = findSeries(JSON.parse(CASH_FLOWS)).find((s) => /operating/i.test(s.name));
    expect(ocf?.points).toEqual([
      { period: "FY2020", value: 8200 },
      { period: "FY2021", value: 9100 },
      { period: "FY2022", value: 10400 },
      { period: "FY2023", value: 11800 },
      { period: "FY2024", value: 13200 },
    ]);
  });

  it("ignores non-JSON tool output instead of throwing", () => {
    expect(parseObservation("")).toBeNull();
    expect(parseObservation("plain text log line")).toBeNull();
    expect(parseObservation("{ truncated")).toBeNull();
    expect(parseObservation('{"a":1}')).toEqual({ a: 1 });
  });

  it("finds scalars in a nested metrics snapshot", () => {
    expect(pickNumber({ data: { valuation: { current_price: 3450 } } }, /^current_price$/i)).toBe(3450);
    expect(pickNumber({ data: { valuation: { beta: 1.2 } } }, /^current_price$/i)).toBeNull();
  });
});

// ── the model ──────────────────────────────────────────────────────────────

describe("dcfModel", () => {
  const base = { fcf: [100], discountRate: 0.1, stageGrowth: 0.05, terminalGrowth: 0.02, years: 5, netDebt: 50, shares: 10 };

  it("compounds, discounts and capitalises consistently", () => {
    const m = dcfModel(base);
    expect(m.projections[0]).toBeCloseTo(105, 6);
    expect(m.projections[4]).toBeCloseTo(127.62815625, 6);
    expect(m.discountFactors[4]).toBeCloseTo(1 / 1.1 ** 5, 10);
    expect(m.pvExplicit).toBeCloseTo(m.projections.reduce((s, p, t) => s + p / 1.1 ** (t + 1), 0), 10);
    expect(m.terminalValue).toBeCloseTo((m.projections[4] * 1.02) / 0.08, 6);
    expect(m.enterpriseValue).toBeCloseTo(m.pvExplicit + m.pvTerminal, 10);
    expect(m.equityValue).toBeCloseTo(m.enterpriseValue - 50, 10);
    expect(m.valuePerShare).toBeCloseTo(m.equityValue / 10, 10);
  });

  it("refuses a terminal value when growth meets the discount rate", () => {
    const m = dcfModel({ ...base, terminalGrowth: 0.1 });
    expect(m.tvDefined).toBe(false);
    expect(m.terminalValue).toBe(0);
    expect(m.enterpriseValue).toBeCloseTo(m.pvExplicit, 10);
    expect(m.valuePerShare).not.toBeNull();
  });

  it("has no per-share value when the share count is unknown", () => {
    expect(dcfModel({ ...base, shares: 0 }).valuePerShare).toBeNull();
  });

  it("computes CAGR only over positive series", () => {
    expect(cagr([100, 110, 121])).toBeCloseTo(0.1, 10);
    expect(cagr([-100, 50])).toBeNull();
    expect(cagr([0, 10])).toBeNull();
    expect(cagr([5])).toBeNull();
  });
});

// ── the recipe ─────────────────────────────────────────────────────────────

describe("buildDcfRecipe", () => {
  it("emits ready with a full model when cash flow and metrics are present", () => {
    const [draft] = buildDcfRecipe(FULL);
    expect(draft.status).toBe("ready");
    expect(draft.note).toBeUndefined();
    expect(draft.recipe?.filename).toBe("TCS_DCF_Model.xlsx");
    expect(draft.summary).toMatch(/5y cash-flow history/);
    expect(draft.assumptions.map((a) => a.label)).toEqual([
      "Discount rate", "Stage-1 FCF growth", "Terminal growth", "Projection years",
    ]);
    expect(draft.observation_refs).toEqual([0, 0]);
    expect(draft.recipe?.sheets.map((s) => s.name)).toEqual([
      "Inputs", "Historical FCF", "DCF", "Sensitivity",
    ]);
  });

  it("gives every assumption a reason and every number a source", () => {
    const recipe = recipeOf(FULL);
    for (const sheet of recipe.sheets) {
      for (const cell of sheet.cells) {
        // Titles and row labels are neither data nor assumptions.
        const carriesMeaning = cell.provenance === "assumption" || typeof cell.value === "number";
        if (carriesMeaning) expect(cell.note, `${sheet.name}!${cell.ref}`).toBeTruthy();
      }
    }
    expect(cellAt(recipe, "Inputs", "B4").provenance).toBe("assumption");
    expect(cellAt(recipe, "Inputs", "B4").note).toMatch(/WACC/);
    expect(cellAt(recipe, "Inputs", "B10").provenance).toBe("observed");
    expect(cellAt(recipe, "Historical FCF", "B4").provenance).toBe("observed");
  });

  it("computes historical FCF as OCF + capex when capex is negative", () => {
    const recipe = recipeOf(FULL);
    expect(cellAt(recipe, "Historical FCF", "B4").value).toBe(8200);
    expect(cellAt(recipe, "Historical FCF", "C4").value).toBe(-1200);
    expect(cellAt(recipe, "Historical FCF", "D4").formula).toBe("B4+C4");
    expect(cellAt(recipe, "Historical FCF", "D4").result).toBe(7000);
    expect(cellAt(recipe, "Historical FCF", "D8").result).toBe(BASE_FCF);
  });

  it("subtracts capex when the provider reports it as a positive magnitude", () => {
    const positiveCapex = JSON.stringify({
      annual: [
        { fiscal_year: "FY2020", operating_cash_flow: 8200, capital_expenditure: 1200 },
        { fiscal_year: "FY2021", operating_cash_flow: 9100, capital_expenditure: 1350 },
        { fiscal_year: "FY2022", operating_cash_flow: 10400, capital_expenditure: 1500 },
      ],
    });
    const recipe = recipeOf(ctx([{ tool: "get_cash_flows", result: positiveCapex }]));
    expect(cellAt(recipe, "Historical FCF", "D4").formula).toBe("B4-C4");
    expect(cellAt(recipe, "Historical FCF", "D4").result).toBe(7000);
  });

  it("derives stage growth from the historical FCF CAGR and clamps it", () => {
    const [draft] = buildDcfRecipe(FULL);
    expect(draft.assumptions[1].value).toBe("13.1%");
    expect(draft.assumptions[1].reason).toMatch(/historical FCF CAGR/);
    expect(cellAt(recipeOf(FULL), "Inputs", "B5").value).toBeCloseTo(STAGE_GROWTH, 10);
  });

  it("falls back to 5% stage growth when the FCF history has no positive base", () => {
    const lossy = JSON.stringify({
      annual: [
        { fiscal_year: "FY2020", operating_cash_flow: -300, capital_expenditure: -100 },
        { fiscal_year: "FY2021", operating_cash_flow: -250, capital_expenditure: -100 },
        { fiscal_year: "FY2022", operating_cash_flow: -200, capital_expenditure: -100 },
      ],
    });
    const [draft] = buildDcfRecipe(ctx([{ tool: "get_cash_flows", result: lossy }]));
    expect(draft.assumptions[1].value).toBe("5.0%");
    expect(draft.assumptions[1].reason).toMatch(/defaulted to 5%/);
  });

  it("derives shares from market cap over price and states it", () => {
    const shares = cellAt(recipeOf(FULL), "Inputs", "B14");
    expect(shares.formula).toContain("B15/B10");
    expect(shares.result).toBeCloseTo(SHARES, 6);
    expect(shares.note).toMatch(/market capitalisation/i);
  });

  it("chains each projection off the prior year rather than off the base", () => {
    const recipe = recipeOf(FULL);
    expect(cellAt(recipe, "DCF", "B5").formula).toBe("B4*(1+Inputs!$B$5)");
    expect(cellAt(recipe, "DCF", "B6").formula).toBe("B5*(1+Inputs!$B$5)");
    expect(cellAt(recipe, "DCF", "B5").result).toBeCloseTo(BASE_FCF * (1 + STAGE_GROWTH), 6);
    expect(cellAt(recipe, "DCF", "B6").result).toBeCloseTo(BASE_FCF * (1 + STAGE_GROWTH) ** 2, 6);
  });

  it("points the first actual row at the last historical FCF cell", () => {
    expect(cellAt(recipeOf(FULL), "DCF", "B4").formula).toBe("'Historical FCF'!D8");
    expect(cellAt(recipeOf(FULL), "DCF", "B4").result).toBe(BASE_FCF);
  });

  it("subtracts net debt to reach equity value", () => {
    const recipe = recipeOf(FULL);
    expect(cellAt(recipe, "Inputs", "B13").result).toBe(NET_DEBT);

    const rows = recipe.sheets.find((s) => s.name === "DCF")!.cells;
    const rowOf = (text: string): string => {
      const hit = rows.find((c) => c.ref.startsWith("A") && c.value === text);
      if (!hit) throw new Error(`no row labelled "${text}"`);
      return hit.ref.slice(1);
    };

    expect(cellAt(recipe, "DCF", `A${rowOf("Enterprise value")}`).value).toBe("Enterprise value");
    const netDebtRow = rowOf("Less: net debt");
    const equityRow = rowOf("Equity value");
    const evRow = rowOf("Enterprise value");
    expect(cellAt(recipe, "DCF", `B${netDebtRow}`).formula).toBe("Inputs!$B$13");
    expect(cellAt(recipe, "DCF", `B${equityRow}`).formula).toBe(`B${evRow}-B${netDebtRow}`);
    expect(cellAt(recipe, "DCF", `B${equityRow}`).result).toBeCloseTo(BASE_CASE.equityValue, 6);
    expect(BASE_CASE.equityValue).toBeGreaterThan(BASE_CASE.enterpriseValue); // net cash
  });

  it("builds a 5x5 sensitivity grid whose centre equals the base case", () => {
    const recipe = recipeOf(FULL);
    const grid = recipe.sheets.find((s) => s.name === "Sensitivity")!.cells
      .filter((c) => /^[B-F](6|7|8|9|10)$/.test(c.ref));
    expect(grid).toHaveLength(25);
    for (const cell of grid) expect(cell.formula, cell.ref).toBeTruthy();
    expect(cellAt(recipe, "Sensitivity", "D8").result).toBeCloseTo(BASE_CASE.valuePerShare!, 4);
  });

  it("marks a workbook partial when capex is missing, never fabricating it", () => {
    const ocfOnly = JSON.stringify({
      annual: [
        { fiscal_year: "FY2023", operating_cash_flow: 11800 },
        { fiscal_year: "FY2024", operating_cash_flow: 13200 },
        { fiscal_year: "FY2025", operating_cash_flow: 14100 },
      ],
    });
    const [draft] = buildDcfRecipe(ctx([{ tool: "get_cash_flows", result: ocfOnly }]));
    expect(draft.status).toBe("partial");
    expect(draft.note).toMatch(/capital expenditure was not/i);
    const recipe = draft.recipe!;
    expect(cellAt(recipe, "Historical FCF", "D4").formula).toBe("B4");
    expect(cellAt(recipe, "Historical FCF", "D4").result).toBe(11800);
    expect(cellAt(recipe, "Historical FCF", "C4").value).toBeNull();
  });

  it("returns unavailable with a reason when there are too few periods", () => {
    const [draft] = buildDcfRecipe(ctx([
      { tool: "get_cash_flows", result: JSON.stringify({ annual: [{ fiscal_year: "FY2024", operating_cash_flow: 13200 }] }) },
    ]));
    expect(draft.status).toBe("unavailable");
    expect(draft.recipe).toBeNull();
    expect(draft.note).toMatch(/two or more periods/i);
  });

  it("returns unavailable when the tool results carry no cash flow at all", () => {
    const [draft] = buildDcfRecipe(ctx([{ tool: "get_current_price", result: METRICS }]));
    expect(draft.status).toBe("unavailable");
    expect(draft.note).toMatch(/no operating cash flow/i);
  });

  it("survives a tool that errored", () => {
    const [draft] = buildDcfRecipe(ctx([{ tool: "get_cash_flows", result: "upstream 503" }]));
    expect(draft.status).toBe("unavailable");
  });

  it("sanitises the symbol out of the filename", () => {
    expect(recipeOf(ctx([{ tool: "get_cash_flows", result: CASH_FLOWS }], { symbol: "BRK/B" })).filename)
      .toBe("BRK_B_DCF_Model.xlsx");
  });
});

// ── formulas vs cached values ──────────────────────────────────────────────

describe("workbook formulas agree with their cached results", () => {
  it("recomputes every formula in the workbook from its literals alone", () => {
    const recipe = recipeOf(FULL);
    const compared: string[] = [];
    verifyRecipe(recipe.sheets, (key, computed, cached) => {
      compared.push(key);
      expect(computed, `${key} computes a different number than its cached result`).toBeCloseTo(cached, 4);
    });
    // Every formula cell with a numeric result was checked.
    const formulaCells = recipe.sheets.flatMap((s) => s.cells.filter((c) => c.formula && typeof c.result === "number"));
    expect(compared).toHaveLength(formulaCells.length);
    expect(compared.length).toBeGreaterThan(50);
  });

  it("recomputes the sensitivity grid from Inputs and Historical FCF only", () => {
    const recipe = recipeOf(FULL);
    const grid = recipe.sheets.find((s) => s.name === "Sensitivity")!;
    let checked = 0;
    verifyRecipe(recipe.sheets, (key, computed, cached) => {
      if (!grid.cells.some((c) => `${grid.name}!${c.ref}` === key)) return;
      expect(computed, key).toBeCloseTo(cached, 4);
      checked++;
    });
    expect(checked).toBe(25);
  });

  it("agrees with dcfModel on the headline valuation", () => {
    const recipe = recipeOf(FULL);
    const rows = recipe.sheets.find((s) => s.name === "DCF")!.cells;
    const rowOf = (text: string): string => rows.find((c) => c.ref.startsWith("A") && c.value === text)!.ref.slice(1);
    expect(cellAt(recipe, "DCF", `B${rowOf("Intrinsic value per share")}`).result).toBeCloseTo(BASE_CASE.valuePerShare!, 6);
    expect(cellAt(recipe, "DCF", `B${rowOf("Enterprise value")}`).result).toBeCloseTo(BASE_CASE.enterpriseValue, 6);
    expect(cellAt(recipe, "DCF", `B${rowOf("Terminal value (Gordon growth)")}`).result).toBeCloseTo(BASE_CASE.terminalValue, 6);
    expect(cellAt(recipe, "DCF", `B${rowOf("Margin of safety")}`).result).toBeCloseTo(
      (BASE_CASE.valuePerShare! - 3450) / BASE_CASE.valuePerShare!, 6,
    );
  });

  it("leaves no formula cell without a cached result unless Excel returns blank", () => {
    for (const sheet of recipeOf(FULL).sheets) {
      for (const cell of sheet.cells) {
        if (!cell.formula || cell.result !== undefined) continue;
        expect(cell.formula, `${sheet.name}!${cell.ref}`).toMatch(/""\)/);
      }
    }
  });

  it("never emits a formula with a leading '='", () => {
    for (const sheet of recipeOf(FULL).sheets) {
      for (const cell of sheet.cells) {
        if (cell.formula) expect(cell.formula.startsWith("=")).toBe(false);
      }
    }
  });
});

// ── the renderer ───────────────────────────────────────────────────────────

describe("renderXlsx", () => {
  it("produces a loadable workbook with formulas and styles intact", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await renderXlsx(recipeOf(FULL)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Inputs", "Historical FCF", "DCF", "Sensitivity"]);

    const b6 = wb.getWorksheet("DCF")!.getCell("B6");
    expect(b6.value).toMatchObject({ formula: "B5*(1+Inputs!$B$5)" });
    expect((b6.value as { result: number }).result).toBeCloseTo(BASE_FCF * (1 + STAGE_GROWTH) ** 2, 6);
    expect(b6.numFmt).toBe("#,##0");

    const b4 = wb.getWorksheet("Inputs")!.getCell("B4");
    expect(b4.fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } });
    expect(b4.note).toBeTruthy();
    // Observed data is left plain — only assumptions are highlighted.
    expect(wb.getWorksheet("Inputs")!.getCell("B10").fill).toMatchObject({ pattern: "none" });
  });

  it("is byte-stable for the same recipe", async () => {
    const recipe = recipeOf(FULL);
    expect(await renderXlsx(recipe)).toEqual(await renderXlsx(recipe));
  });

  it("writes cross-sheet formulas without dropping them", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await renderXlsx(recipeOf(FULL)));
    const dcf = wb.getWorksheet("DCF")!;
    expect((dcf.getCell("C5").value as { formula: string }).formula).toBe("1/(1+Inputs!$B$4)^1");
    expect((dcf.getCell("B4").value as { formula: string }).formula).toBe("'Historical FCF'!D8");
  });

  it("sanitises illegal sheet names without changing valid ones", () => {
    // Formula refs are written by name, so a mangled name breaks every reference.
    expect(safeSheetName("Historical FCF", 0)).toBe("Historical FCF");
    expect(safeSheetName("Cash/Flow [FY24]", 0)).toBe("Cash Flow FY24");
    expect(safeSheetName("  ", 3)).toBe("Sheet4");
    expect(safeSheetName("x".repeat(40), 0)).toHaveLength(31);
    expect(safeSheetName("x".repeat(40), 0)).toBe(safeSheetName("x".repeat(40), 0));
  });
});