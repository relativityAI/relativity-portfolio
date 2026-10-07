/**
 * skills/artifacts — turns the raw tool evidence of a skill run into a
 * workbook artifact.
 *
 * The analysis itself stays with the model; what goes into the workbook is
 * exactly what the run already collected — one row per tool call, plus a sheet
 * per structured tool result the model can then work with in a spreadsheet.
 * Counts on the summary sheet are written as live formulas that reference the
 * evidence sheet, so a reviewer can audit the numbers instead of trusting a
 * pasted total.
 */

import type {
  BuildArtifactsInput,
  CellInput,
  ColumnSpec,
  SheetRecipe,
  SkillArtifact,
  WorkbookRecipe,
} from "./types.js";

/** Excel limits a sheet tab to 31 characters and a few reserved symbols. */
const MAX_SHEET_NAME = 31;
const RESERVED_SHEET_CHARS = /[\\/?*[\]:]/g;
/** Enough structured sheets to be useful; everything always stays on Evidence. */
const MAX_DATA_SHEETS = 12;

function slug(value: string): string {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workbook"
  );
}

/** Sheet tab names: legal characters only, deduplicated case-insensitively. */
function uniqueSheetName(raw: string, taken: Set<string>): string {
  const base =
    String(raw)
      .replace(RESERVED_SHEET_CHARS, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SHEET_NAME)
      .trim() || "Data";
  let name = base;
  for (let attempt = 2; taken.has(name.toLowerCase()); attempt++) {
    const suffix = ` ${attempt}`;
    name = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trimEnd()}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nested values cannot sit in a cell as-is, so they stay readable JSON. */
function toCell(value: unknown): CellInput {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/** Pretty-print stored JSON so wrapped cells stay readable in Excel. */
function pretty(json: string | undefined): string {
  if (!json) return "";
  const parsed = safeParse(json);
  if (parsed === null && json !== "null") return json;
  return JSON.stringify(parsed, null, 2);
}

function widthForKey(key: string): number {
  if (/url|link|description|summary|text|name|title/i.test(key)) return 40;
  if (/date|time|_at$|period/i.test(key)) return 22;
  return 18;
}

/** An array of records becomes one column per key, in first-seen order. */
function tableSheet(records: Record<string, unknown>[]): { columns: ColumnSpec[]; rows: CellInput[][] } {
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) if (!keys.includes(key)) keys.push(key);
  }
  const columns: ColumnSpec[] = keys.map((key) => ({ key, label: key, width: widthForKey(key) }));
  const rows: CellInput[][] = records.map((record) => keys.map((key) => toCell(record[key])));
  return { columns, rows };
}

/** A single record becomes a two-column key/value sheet. */
function pairsSheet(record: Record<string, unknown>): { columns: ColumnSpec[]; rows: CellInput[][] } {
  const columns: ColumnSpec[] = [
    { key: "field", label: "Field", width: 34 },
    { key: "value", label: "Value", width: 80, wrap: true },
  ];
  const rows: CellInput[][] = Object.entries(record).map(([key, value]) => [key, toCell(value)]);
  return { columns, rows };
}

/** One structured sheet per tool result, when the result is tabular or record-shaped. */
function dataSheetsFor(
  observations: { tool: string; result: string }[],
  taken: Set<string>,
): SheetRecipe[] {
  const sheets: SheetRecipe[] = [];
  for (const observation of observations) {
    if (sheets.length >= MAX_DATA_SHEETS) break;
    const parsed = safeParse(observation.result);
    const shaped = Array.isArray(parsed)
      ? parsed.filter(isRecord)
      : isRecord(parsed)
        ? [parsed]
        : [];
    if (!shaped.length) continue;
    const { columns, rows } = Array.isArray(parsed) ? tableSheet(shaped) : pairsSheet(shaped[0]);
    if (!columns.length || !rows.length) continue;
    sheets.push({ name: uniqueSheetName(observation.tool, taken), columns, rows });
  }
  return sheets;
}

/**
 * Build the workbook artifact for a single skill run.
 *
 * Always returns exactly one artifact: `ready` with a recipe when the run
 * collected tool evidence, `unavailable` with a `note` (never a recipe) when it
 * did not, which is what the download route reports as a 409.
 */
export function buildArtifacts(input: BuildArtifactsInput): SkillArtifact[] {
  const { skillId, symbol, shareName, source } = input;
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const id = `${skillId}:workbook`;

  if (!observations.length) {
    return [
      {
        id,
        skill_id: skillId,
        kind: "workbook",
        status: "unavailable",
        summary: "No workbook — the skill collected no tool evidence.",
        note: "This skill returned no tool results, so there is nothing to put in a workbook.",
      },
    ];
  }

  const okCount = observations.filter((o) => o.status === "ok").length;
  const errCount = observations.filter((o) => o.status === "ERR").length;
  const emptyCount = observations.length - okCount - errCount;

  const taken = new Set<string>(["summary", "evidence"]);
  const lastEvidenceRow = observations.length + 1;
  const countOverEvidence = (formula: string, cached: number): CellInput => ({
    formula,
    cached,
    format: "integer",
  });

  const summary: SheetRecipe = {
    name: "Summary",
    columns: [
      { key: "metric", label: "Metric", width: 26, bold: true },
      { key: "value", label: "Value", width: 82, wrap: true },
    ],
    rows: [
      ["Stock", shareName],
      ["Symbol", symbol],
      ["Market", source],
      ["Skill", skillId],
      ["Generated", new Date().toISOString()],
      ["Observations", countOverEvidence(`COUNTA(Evidence!$A$2:$A$${lastEvidenceRow})`, observations.length)],
      ["Successful tool calls", countOverEvidence(`COUNTIF(Evidence!$B$2:$B$${lastEvidenceRow},"ok")`, okCount)],
      ["Empty tool results", countOverEvidence(`COUNTIF(Evidence!$B$2:$B$${lastEvidenceRow},"EMPTY")`, emptyCount)],
      ["Failed tool calls", countOverEvidence(`COUNTIF(Evidence!$B$2:$B$${lastEvidenceRow},"ERR")`, errCount)],
      [
        "Note",
        "The counts above are live formulas: they recalculate from the Evidence sheet whenever the workbook is opened.",
      ],
    ],
  };

  const evidence: SheetRecipe = {
    name: "Evidence",
    columns: [
      { key: "tool", label: "Tool", width: 30 },
      { key: "status", label: "Status", width: 10 },
      { key: "args", label: "Arguments", width: 60, wrap: true },
      { key: "result", label: "Result", width: 90, wrap: true },
    ],
    rows: observations.map((observation) => [
      observation.tool,
      observation.status,
      pretty(observation.args),
      pretty(observation.result),
    ]),
  };

  const sheets: SheetRecipe[] = [summary, evidence, ...dataSheetsFor(observations, taken)];
  const recipe: WorkbookRecipe = {
    filename: `${slug(shareName)}-${slug(skillId)}.xlsx`,
    title: `${shareName} (${symbol}) — ${skillId}`,
    sheets,
  };

  return [
    {
      id,
      skill_id: skillId,
      kind: "workbook",
      status: "ready",
      summary: `${recipe.filename} — ${observations.length} tool observations with live formulas.`,
      recipe,
    },
  ];
}
