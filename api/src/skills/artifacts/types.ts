/**
 * skills/artifacts/types — the declarative shape of a skill workbook.
 *
 * A workbook is stored as plain JSON: it rides inside `analysis_runs.skill_outputs`
 * and assembled into a real `.xlsx` only when someone asks for the file. Builders
 * emit `RefCell`s keyed by A1 reference; the writer in xlsx.ts turns those into a
 * spreadsheet.
 */

export type CellValue = string | number | boolean | null;

/** Where a cell's value came from — drives the amber fill writers apply. */
export type CellProvenance = "observed" | "assumption";

/** A single cell placed by absolute reference, e.g. `B4`. */
export interface RecipeCell {
  ref: string;
  /** Literal value written to the cell (absent on formula cells). */
  value?: CellValue;
  /** Formula body, with or without the leading `=`. */
  formula?: string;
  /** Cached result shown until the spreadsheet recalculates the formula. */
  result?: CellValue;
  /** Excel number format code, e.g. `#,##0`, `0.0%`. */
  numFmt?: string;
  provenance: CellProvenance;
  /** Cell comment explaining the value/assumption. */
  note?: string;
}

export interface RecipeSheet {
  /** Tab name — max 31 chars, no `: \ / ? * [ ]`. Canonicalises in xlsx.ts. */
  name: string;
  cells: RecipeCell[];
  /** Column widths by letter (`A`, `B`, …). */
  colWidths?: Record<string, number>;
}

export interface WorkbookRecipe {
  kind: "xlsx";
  /** Download filename, e.g. `reliance-industries_DCF_Model.xlsx`. */
  filename: string;
  /** One-line description used in the report. */
  description?: string;
  sheets: RecipeSheet[];
}

export type ArtifactStatus = "ready" | "partial" | "unavailable";

/** An editable assumption, listed in the report next to the file. */
export interface ArtifactAssumption {
  label: string;
  value: string;
  reason: string;
}

/** What a builder returns before it becomes a stored {@link SkillArtifact}. */
export interface ArtifactDraft {
  status: ArtifactStatus;
  recipe: WorkbookRecipe | null;
  summary: string;
  assumptions: ArtifactAssumption[];
  /** Which tool observations (indices) the draft draws on. */
  observation_refs: number[];
  note?: string;
}

/** One tool call recorded while running a skill (`index.ts` builds these). */
export interface ToolObservation {
  tool: string;
  /** JSON-encoded arguments, as recorded. */
  args?: string;
  /** JSON-encoded result, as recorded. */
  result: string;
  status?: string;
}

export interface ArtifactInput {
  skillId: string;
  symbol: string;
  shareName: string;
  source: string;
  observations: ToolObservation[];
}

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