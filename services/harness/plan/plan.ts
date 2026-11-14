/**
 * v2 plan contract — the JSON plan the planner emits and its validation.
 * The prompt builders live in ../prompts.ts.
 *
 * The plan is validated with zod BEFORE anything executes: unknown tools,
 * bad inputs (checked against the tool's own zod schema), dangling
 * dependencies and cycles all fail the run at the planning step instead of
 * half-executing.
 */

import { z } from "zod";
import type { ToolDefinition } from "../index.js";

/** The pseudo-tool every report-section draft task carries. */
export const SECTION_TOOL = "generate_section";

const PlanTaskSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string().default(""),
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  status: z.enum(["pending", "in_progress", "completed", "failed"]).default("pending"),
  outputRef: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  /** Section drafts only — quality score 1-10, set by the harness after drafting. */
  score: z.number().min(1).max(10).nullable().optional(),
});

export const PlanSchema = z.object({
  version: z.string().default("1.0.0"),
  planId: z.string().min(1),
  target: z.object({ entity: z.string().min(1), domain: z.string().min(1) }),
  executionMode: z.enum(["map_reduce", "sequential"]).default("map_reduce"),
  // ponytail: 16-task cap bounds worst-case cost (≤16 drafts) — raise it if
  // reports outgrow it.
  tasks: z.array(PlanTaskSchema).min(1).max(16),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;

/** What a section drafter must reply with — score rides alongside the sections.
 *  score is optional: a draft that omits it is KEPT (verdict averages the
 *  sections that did score) — regenerating a whole section over missing
 *  metadata costs a full minute and buys nothing. */
export const DraftSchema = z.object({
  sections: z.array(z.unknown()).min(1),
  sources: z.array(z.unknown()).default([]),
  score: z.number().min(1).max(10).optional(),
});
export type Draft = z.infer<typeof DraftSchema>;

/** Structural validation. Returns human-readable errors; empty = valid. */
export function validatePlan(plan: Plan, tools: ToolDefinition[]): string[] {
  const errs: string[] = [];
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const defs = new Map(tools.map((t) => [t.name, t]));
  let sectionCount = 0;

  for (const t of plan.tasks) {
    if (seen.has(t.id)) errs.push(`duplicate task id "${t.id}"`);
    seen.add(t.id);
    if (t.tool === SECTION_TOOL) {
      sectionCount++;
      continue;
    }
    const def = defs.get(t.tool);
    if (!def) {
      errs.push(`task "${t.id}" uses unknown tool "${t.tool}" — allowed: ${[...defs.keys()].join(", ")}`);
      continue;
    }
    const parsed = def.parameters.safeParse(t.input);
    if (!parsed.success) {
      errs.push(
        `task "${t.id}" input does not match ${t.tool} schema: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
      );
    }
  }

  for (const t of plan.tasks) {
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (!dep) errs.push(`task "${t.id}" depends on unknown task "${d}"`);
      else if (t.tool !== SECTION_TOOL && dep.tool === SECTION_TOOL) {
        errs.push(`data task "${t.id}" cannot depend on section task "${d}"`);
      }
    }
  }

  // Cycle detection (Kahn) over the whole graph.
  const indeg = new Map(plan.tasks.map((t) => [t.id, 0]));
  for (const t of plan.tasks) {
    for (const d of t.dependsOn) if (byId.has(d)) indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
  }
  const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  let seenCount = 0;
  while (queue.length) {
    const id = queue.shift()!;
    seenCount++;
    for (const t of plan.tasks) {
      if (!t.dependsOn.includes(id)) continue;
      const n = (indeg.get(t.id) ?? 0) - 1;
      indeg.set(t.id, n);
      if (n === 0) queue.push(t.id);
    }
  }
  if (seenCount !== plan.tasks.length) errs.push("plan contains a dependency cycle");

  if (!sectionCount) errs.push(`plan has no "${SECTION_TOOL}" tasks — it must plan every report section`);
  return errs;
}

/** Reset harness-owned fields (the model may have lied about statuses). */
export function resetPlan(plan: Plan): void {
  for (const t of plan.tasks) {
    t.status = "pending";
    t.outputRef = null;
    t.error = null;
    t.score = undefined;
  }
}
