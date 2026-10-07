/**
 * skills/artifacts/types — the declarative shape of a skill workbook.
 *
 * A workbook is stored as plain JSON: it rides inside `analysis_runs.skill_outputs`
 * and is handed back verbatim on download. The binary spreadsheet is only ever
 * assembled from a recipe when someone actually asks for the file, so nothing in
 * this module touches the filesystem or a spreadsheet library.
 */

/** Scalar values a cell can hold. Formulas are expressed separately. */
export type CellValue = string | number | boolean | null;

/** Number formats the XLSX writer understands. */
export type CellFormat = "text" | "number" | "integer" | "currency" | "percent";

/** A single cell: either a literal value or a live formula. */
export interface Cell {
  /** Literal value written to the cell. */
  value?: CellValue;
  /** Formula body with or without the leading `=`, e.g. `COUNTIF(Evidence!B:B,"ok")`. */
  formula?: string;
  /** Result shown until the spreadsheet recalculates the formula. */
  cached?: CellValue;
  /** Overrides the column format for this cell. */
  format?: CellFormat;
}

/** What a row accepts: a bare value or a full cell descriptor. */
export type CellInput = CellValue | Cell;

export interface ColumnSpec {
  key: string;
  label: string;
  /** Width in characters (Excel units, 1–255). */
  width?: number;
  format?: CellFormat;
  /** Wrap long text instead of clipping it. */
  wrap?: boolean;
  /** Bold the column's text cells (used for label columns). */
  bold?: boolean;
}

export interface SheetRecipe {
  /** Tab name — max 31 characters, no `: \ / ? * [ ]`. */
  name: string;
  /** Header row. When present it is row 1 and the data starts at row 2. */
  columns?: ColumnSpec[];
  rows: CellInput[][];
  /** Freeze the header row while scrolling. Defaults to true when columns exist. */
  freezeHeader?: boolean;
}

export interface WorkbookRecipe {
  /** Download filename, e.g. `reliance-industries-valuation.xlsx`. */
  filename: string;
  /** Document title written into the file's properties. */
  title?: string;
  sheets: SheetRecipe[];
}

export type ArtifactStatus = "ready" | "unavailable";

/** One artifact as stored in `skill_outputs` and listed in the PDF report. */
export interface SkillArtifact {
  /** `${skill_id}:workbook` — matches `/analysis/:id/artifact/:artifactId`. */
  id: string;
  skill_id: string;
  kind: "workbook";
  status: ArtifactStatus;
  /** One line shown in the report next to the filename. */
  summary?: string;
  /** Why the artifact could not be built; returned as the error on download. */
  note?: string;
  /** Absent whenever `status` is `unavailable`. */
  recipe?: WorkbookRecipe;
}

/** One tool call collected while running a skill (`index.ts` builds these). */
export interface ToolObservation {
  tool: string;
  /** JSON-encoded arguments, as recorded. */
  args: string;
  /** JSON-encoded result, as recorded. */
  result: string;
  status: string;
}

export interface BuildArtifactsInput {
  skillId: string;
  symbol: string;
  shareName: string;
  source: string;
  observations: ToolObservation[];
}
