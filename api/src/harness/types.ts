/**
 * Harness-level shared types. Kept deliberately small: the harness owns the
 * loop, budgets, and report contract — not the agent definition (that lives in
 * the existing `agents` table) or the skill loader (see ./skills/).
 */

export interface Budget {
  /** Max agent loop steps (model<->tool round trips). */
  maxSteps: number;
  /** Max output tokens across the run. */
  maxTokens: number;
  /** FS-workspace Context Builder: research sessions per run. */
  cbSessions: number;
  /** FS-workspace Context Builder: max loop steps per session. */
  cbSessionSteps: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 20,
  maxTokens: 200_000,
  cbSessions: 3,
  cbSessionSteps: 8,
};

function clampNum(value: number | undefined, def: number, lo: number, hi: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

export function clampBudget(partial: Partial<Budget> | undefined): Budget {
  const b = { ...DEFAULT_BUDGET, ...(partial ?? {}) };
  return {
    maxSteps: clampNum(b.maxSteps, DEFAULT_BUDGET.maxSteps, 1, 200),
    maxTokens: clampNum(b.maxTokens, DEFAULT_BUDGET.maxTokens, 1_000, 2_000_000),
    cbSessions: clampNum(b.cbSessions, DEFAULT_BUDGET.cbSessions, 1, 10),
    cbSessionSteps: clampNum(b.cbSessionSteps, DEFAULT_BUDGET.cbSessionSteps, 1, 20),
  };
}

/** Pipeline phase — groups the live timeline into human-readable stages. */
export type RunPhase = "run";

/** A single evidence event emitted by the loop; the report builder consumes these.
 *  `agent` tags the emitting agent in parallel runs ("planner", "p1", "synthesis"). */
export type TraceEvent =
  | { type: "thought"; text: string; agent?: string }
  | { type: "tool_call"; tool: string; toolCallId: string; args: unknown; summary?: string; agent?: string }
  | { type: "tool_result"; tool: string; toolCallId: string; status: "ok" | "error"; result: unknown; durationMs: number; summary?: string; agent?: string }
  | { type: "log"; text: string; agent?: string }
  /** Marks a pipeline stage transition for the live timeline. */
  | { type: "phase"; phase: RunPhase; label: string; detail?: string }
  /** A canvas task's sections landed (or failed) on the in-memory canvas. */
  | { type: "canvas_block"; taskId: string; taskTitle: string; status: "done" | "failed"; sectionCount: number; error?: string; durationMs?: number; summary?: string; agent?: string }
  /** Workspace KB changed after a tool call — file count and total bytes. */
  | { type: "kb"; files: number; bytes: number; agent?: string };
