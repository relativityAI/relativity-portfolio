/**
 * Canvas run — public surface.
 *
 * ONE autonomous agent loop writes the report onto an in-memory canvas via
 * report_write; assembly is deterministic. See run.ts for the flow.
 */

export { runCanvasAnalysis, TEXT_TOOLS } from "./run.js";
export { ReportCanvas, validateComposed } from "./canvas.js";
export type { CanvasEntry } from "./canvas.js";
export { reportWriteTool, reportRemoveTool } from "./report-tool.js";
