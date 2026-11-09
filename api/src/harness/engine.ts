/**
 * The engine seam — ONE entry for both run pipelines.
 *
 * runAnalysis(options, engine) picks the pipeline: v1 = one autonomous tool
 * loop (canvas/run.ts), v2 = plan-parallel (plan/run.ts). Both satisfy the
 * same RunCanvasOptions → RunCanvasResult contract, which lives HERE, at the
 * seam — not inside either engine. The CLI (harness/cli.ts) and the API
 * (src/runs.ts) are the two composition roots; neither re-implements the
 * engine choice.
 */

import type { LanguageModel, StepResult, ToolSet } from "ai";
import type { HarnessSkill } from "./skills/loader.js";
import type { ToolContext, ToolDefinition } from "./tools/registry.js";
import type { Budget, TraceEvent } from "./types.js";
import type { SystemPrompt } from "./system-prompts/catalog.js";
import type { ReportCanvas } from "./canvas/canvas.js";
import type { ReportDocument } from "./report/document.js";
import type { Verdict } from "./report/verdict.js";
import { runCanvasAnalysis } from "./canvas/run.js";
import { runPlanAnalysis } from "./plan/run.js";

/** Which pipeline runs a report — harness.config.json `engine` / --engine / HARNESS_ENGINE. */
export type Engine = "v1" | "v2";

export interface RunCanvasOptions {
  model: LanguageModel;
  soul: string;
  skills: HarnessSkill[];
  prompt: string;
  tools: ToolDefinition[];
  allowedTools?: string[];
  ctx: ToolContext;
  budget: Budget;
  /** Input-token working budget — summarize compaction trips at 90% of it. */
  contextBudget?: number;
  /** Cheap model for summarize compaction (clearing runs without it). */
  summarizerModel?: LanguageModel;
  /** Named system prompt (agent.yaml prompts.<name>); absent/unknown → the default `agents` doc. */
  systemPrompt?: string;
  /** The selected system prompt — its body is the report's format spec. */
  template?: SystemPrompt | null;
  onEvent?: (event: TraceEvent) => void;
  /**
   * Pure observation hook: fires after each loop step with the untouched
   * StepResult — presentation only (the CLI footer's step/token counter).
   * Optional; existing callers are unaffected.
   */
  onStepFinish?: (step: StepResult<ToolSet>) => void;
  /** Fires after each report_write with the live canvas (caller throttles). */
  onCanvas?: (canvas: ReportCanvas) => void;
  /** Fires with a compacted workspace snapshot at run end (caller throttles). */
  onWorkspace?: (snapshot: Record<string, string>) => void;
  /** Previous run's compacted workspace — restores notes, sources, plan, and citations. */
  initialWorkspace?: Record<string, string>;
  /** Persist the COMPLETE filesystem (incl. raw payloads) — overrides agent.yaml run.saveWorkspace. */
  saveWorkspace?: boolean;
  /** Grade the verdict AFTER the loop (default true). API runs pass false —
   *  the report is already persisted and renderable; the caller grades later. */
  grade?: boolean;
  abortSignal?: AbortSignal;
}

export type CanvasRunStatus = "completed" | "partial" | "failed";

/** End-of-run counters reported to callers and the CLI. */
export interface RunStats {
  steps: number;
  /** Output tokens (budget currency). */
  tokens: number;
  inputTokens: number;
  /** Highest single-step input — what compaction keeps down. */
  peakInput: number;
  toolCalls: number;
  kbFiles: number;
}

export interface RunCanvasResult {
  status: CanvasRunStatus;
  document: ReportDocument;
  errors: string[];
  trace: TraceEvent[];
  budgetUsed: RunStats;
  canvas: ReportCanvas;
  /** Sections rejected by report_write validation (partial writes). */
  rejectedSections: number;
  /** Five-band quality verdict (Very Poor … Excellent); null when the call failed or the run was aborted. */
  verdict: Verdict | null;
  /** Compacted workspace snapshot (notes/stubs/plan/sections; raw excluded). */
  workspace: Record<string, string>;
  /** Full snapshot incl. raw payloads — only when agent.yaml run.saveWorkspace is on. */
  workspaceFull?: Record<string, string>;
}

/** The run seam: same options in, same result out — the engine picks the pipeline. */
export async function runAnalysis(options: RunCanvasOptions, engine: Engine): Promise<RunCanvasResult> {
  return engine === "v2" ? runPlanAnalysis(options) : runCanvasAnalysis(options);
}
