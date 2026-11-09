/**
 * v2 plan harness — plan → parallel tool exec → parallel section drafts →
 * code assembly. Same RunCanvasOptions → RunCanvasResult contract as the v1
 * loop; both engines dispatch through runAnalysis (../engine.ts).
 *
 * Steps:
 *   1. PLAN      one generateText emits the whole task graph (zod-validated
 *                against the skill's SKILL.md `tools:` list), saved to
 *                /workspace/plan.json.
 *   2. EXECUTE   data tasks run in dependency levels through p-limit; every
 *                result is archived into the knowledge base (archiveResult).
 *   3. DRAFT     every generate_section task runs in parallel (Promise.all),
 *                each replying {sections, sources, score 1-10}.
 *   4. ASSEMBLE  code only: canvas → attachChartData → renderFigures; the
 *                verdict is the section-score average mapped to the five
 *                bands — no grading call.
 *
 * The drafting model gets fs read/write tools only — no web search; the data
 * tools are executed by the harness, not the model.
 *
 * ponytail: budget.maxSteps/maxMs are v1 concepts and not enforced here —
 * the 16-task plan cap bounds cost; add mid-run enforcement if a bill or the
 * API's wall-clock backstop says so.
 */

import { generateText, stepCountIs, type ToolSet } from "ai";
import pLimit from "p-limit";
import {
  ReportCanvas,
  Workspace,
  archiveResult,
  attachChartData,
  describeToolCall,
  extractJson,
  friendlyError,
  retryLlmCall,
  validateComposed,
  workspaceTools,
  type RunCanvasOptions,
  type RunCanvasResult,
  type RunStats,
  type Section,
  type Source,
  type ToolDefinition,
  type TraceEvent,
  type Verdict,
} from "../index.js";
import { renderFigures } from "../report/builder.js";
import { shouldSaveWorkspace } from "../config.js";
import { PATHS } from "../workspace/paths.js";
import { datedPrompt, draftSystemPrompt, hasSeriesTool, plannerSystemPrompt } from "../prompts.js";
import {
  DraftSchema,
  PlanSchema,
  SECTION_TOOL,
  resetPlan,
  validatePlan,
  type Plan,
  type PlanTask,
} from "./plan.js";

// ponytail: concurrency 8 for data fetches — the search layer keeps its own
// gate (3 concurrent), yahoo takes the rest in one wave.
const EXEC_CONCURRENCY = 8;

type DraftResult = { sections: Section[]; sources: Source[]; score?: number };

/** Map the 1-10 section-score average onto the five report bands. */
export function verdictFromScores(scores: number[]): Verdict | null {
  if (!scores.length) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 8.5) return "Excellent";
  if (avg >= 7) return "Good";
  if (avg >= 5.5) return "Fair";
  if (avg >= 4) return "Poor";
  return "Very Poor";
}

export async function runPlanAnalysis(options: RunCanvasOptions): Promise<RunCanvasResult> {
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    options.onEvent?.(e);
  };
  const canvas = new ReportCanvas(options.ctx.symbol);
  const workspace = new Workspace();
  if (options.initialWorkspace && Object.keys(options.initialWorkspace).length) {
    workspace.hydrate(options.initialWorkspace);
  }
  const errors: string[] = [];
  const stats: RunStats = { steps: 0, tokens: 0, inputTokens: 0, peakInput: 0, toolCalls: 0, kbFiles: 0 };
  const addUsage = (u: { inputTokens?: number; outputTokens?: number } | undefined) => {
    const inTok = u?.inputTokens ?? 0;
    const outTok = u?.outputTokens ?? 0;
    stats.inputTokens += inTok;
    stats.tokens += outTok;
    stats.peakInput = Math.max(stats.peakInput, inTok);
  };
  let rejectedSections = 0;
  let plan: Plan | undefined;
  // Wall-clock per phase — the answer to "what's taking so long" without archaeology.
  const phases: string[] = [];
  let mark = Date.now();
  const lap = (name: string) => {
    phases.push(`${name} ${((Date.now() - mark) / 1000).toFixed(1)}s`);
    mark = Date.now();
  };

  const finish = (status: RunCanvasResult["status"], extraErrors: string[] = []): RunCanvasResult => {
    // Assembly lives HERE so every exit path returns the stitched document
    // (chart data attached, SVGs rendered) exactly once.
    const document = canvas.document();
    attachChartData(document, trace, workspace.payloadEntries());
    renderFigures(document);
    stats.kbFiles = workspace.stubs().length;
    stats.toolCalls = trace.filter((e) => e.type === "tool_call").length;
    const scores =
      plan?.tasks.filter((t) => t.tool === SECTION_TOOL && typeof t.score === "number").map((t) => t.score!) ?? [];
    emit({ type: "log", text: `v2 run ${status} — ${document.sections.length} sections, ${stats.toolCalls} tool calls, verdict ${verdictFromScores(scores) ?? "unavailable"}${phases.length ? ` · ${phases.join(" · ")}` : ""}` });
    options.onCanvas?.(canvas);
    options.onWorkspace?.(workspace.compact());
    const saveFull = shouldSaveWorkspace(options.saveWorkspace);
    return {
      status,
      document,
      errors: [...errors, ...extraErrors],
      trace,
      budgetUsed: stats,
      canvas,
      rejectedSections,
      verdict: verdictFromScores(scores),
      workspace: workspace.compact(),
      ...(saveFull ? { workspaceFull: workspace.toJSON() } : {}),
    };
  };
  const fail = (msg: string): RunCanvasResult => {
    errors.push(msg);
    return finish("failed");
  };

  // ── GATE — the skill's SKILL.md must declare the v2 toolbox ──────────────
  const skill = options.skills[0];
  const declared = skill?.tools ?? [];
  if (!declared.length) {
    return fail(
      skill
        ? `skill "${skill.id}" declares no tools — add a \`tools:\` list to its SKILL.md (the v2 engine will not run without it)`
        : "no skill selected — the v2 engine needs a skill whose SKILL.md declares a `tools:` list",
    );
  }
  const dataTools = options.tools.filter((t) => declared.includes(t.name));
  if (!dataTools.length) {
    return fail(`none of the skill's declared tools exist in the registry: ${declared.join(", ")}`);
  }

  // ── STEP 1 — PLAN ────────────────────────────────────────────────────────
  emit({ type: "phase", phase: "run", label: "Plan", detail: "One call emits the full task graph" });
  try {
    plan = await retryLlmCall(
      "v2 plan",
      async (signal) => {
        const r = await generateText({
          model: options.model,
          system: plannerSystemPrompt(dataTools, skill!),
          prompt: datedPrompt(`Target: ${options.ctx.symbol} (${options.ctx.source}).\n\n${options.prompt}`),
          temperature: 0,
          maxOutputTokens: 6_000,
          abortSignal: signal,
        });
        stats.steps++;
        addUsage(r.usage);
        const parsed = PlanSchema.safeParse(extractJson(r.text ?? ""));
        if (!parsed.success) {
          throw new Error(
            `plan is not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
          );
        }
        const errs = validatePlan(parsed.data, dataTools);
        if (errs.length) throw new Error(errs.join("; "));
        return parsed.data;
      },
      { attempts: 2, timeoutMs: 120_000 },
    );
  } catch (e: any) {
    return fail(`planning failed: ${friendlyError(e?.message || String(e))}`);
  }
  resetPlan(plan);
  lap("plan");
  const savePlan = () => workspace.write(PATHS.planJson, JSON.stringify(plan, null, 1));
  savePlan();
  emit({
    type: "log",
    text: `plan ${plan.planId} — ${plan.tasks.length} tasks (${plan.tasks.filter((t) => t.tool !== SECTION_TOOL).length} data, ${plan.tasks.filter((t) => t.tool === SECTION_TOOL).length} sections)`,
  });

  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const toolByName = new Map(dataTools.map((t) => [t.name, t]));
  const drafts = new Map<string, DraftResult>();
  const views = new Map<string, unknown>(); // task id → archiveResult's compact view
  const aborted = () => options.abortSignal?.aborted === true;

  // ── STEP 2 — EXECUTE data tasks in dependency levels ─────────────────────
  emit({ type: "phase", phase: "run", label: "Execute", detail: `Dependency-ordered, ${EXEC_CONCURRENCY} in parallel` });
  const dataTasks = plan.tasks.filter((t) => t.tool !== SECTION_TOOL);
  const limit = pLimit(EXEC_CONCURRENCY);
  const runTask = async (task: PlanTask): Promise<void> => {
    const def = toolByName.get(task.tool)!;
    emit({ type: "tool_call", tool: task.tool, toolCallId: task.id, args: task.input, summary: describeToolCall(task.tool, task.input) });
    try {
      if (aborted()) throw new Error("aborted");
      const result = await def.execute(task.input, options.ctx);
      if (result == null) throw new Error("tool returned no data");
      const stub = archiveResult(workspace, { tool: task.tool, args: task.input, result, symbol: options.ctx.symbol });
      views.set(task.id, stub);
      task.status = "completed";
      const ref = (stub as { _source?: { path?: string } } | null)?._source?.path;
      task.outputRef = typeof ref === "string" ? ref : null;
      emit({ type: "tool_result", tool: task.tool, toolCallId: task.id, status: "ok", result: stub, durationMs: 0 });
      emit({ type: "kb", ...workspace.stats() });
    } catch (e: any) {
      task.status = "failed";
      task.error = friendlyError(e?.message || String(e));
      emit({ type: "tool_result", tool: task.tool, toolCallId: task.id, status: "error", result: task.error, durationMs: 0 });
    }
    savePlan();
  };
  for (;;) {
    for (const t of dataTasks.filter(
      (t) => t.status === "pending" && t.dependsOn.some((d) => byId.get(d)?.status === "failed"),
    )) {
      t.status = "failed";
      t.error = "dependency failed";
    }
    const ready = dataTasks.filter(
      (t) => t.status === "pending" && t.dependsOn.every((d) => byId.get(d)?.status === "completed"),
    );
    if (!ready.length) break;
    await Promise.all(ready.map((t) => limit(() => runTask(t))));
  }
  for (const t of dataTasks) {
    if (t.status === "pending") {
      t.status = "failed";
      t.error = "unresolved dependencies";
    }
  }
  savePlan();
  lap("exec");

  // ── STEP 3 — DRAFT every section in parallel ─────────────────────────────
  emit({ type: "phase", phase: "run", label: "Draft", detail: "One parallel call per report section" });
  // fs read/write only — todo_write belongs to the v1 loop's plan format.
  const fsTools = workspaceTools(workspace).filter((t) => t.name !== "todo_write");
  // Inline the compact views (scalars, series stats, row previews) — the
  // archive layer builds them precisely so drafts never re-read the KB.
  const evidence = dataTasks
    .filter((t) => t.status === "completed")
    .map((t) => ({ task: t.id, outputRef: t.outputRef, result: views.get(t.id) }));
  const sectionTasks = plan.tasks.filter((t) => t.tool === SECTION_TOOL);
  let callSeq = 0;
  const sdkTools: ToolSet = Object.fromEntries(
    fsTools.map((t) => [
      t.name,
      {
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: any) => {
          const callId = `fs_${++callSeq}`;
          emit({ type: "tool_call", tool: t.name, toolCallId: callId, args, summary: describeToolCall(t.name, args) });
          try {
            const r = await t.execute(args, options.ctx);
            emit({ type: "tool_result", tool: t.name, toolCallId: callId, status: "ok", result: r, durationMs: 0 });
            return r;
          } catch (e: any) {
            emit({ type: "tool_result", tool: t.name, toolCallId: callId, status: "error", result: String(e?.message || e), durationMs: 0 });
            throw e;
          }
        },
      },
    ]),
  ) as ToolSet;

  const draftOne = async (task: PlanTask): Promise<void> => {
    const started = Date.now();
    const prompt = [
      `Draft the report section "${task.name}" for ${options.ctx.symbol}.`,
      `sectionId: ${String((task.input as Record<string, unknown>)?.sectionId ?? task.id)}`,
      task.description ? `Instructions: ${task.description}` : "",
      `Evidence collected (cite as [src:<id>]):\n${JSON.stringify(evidence)}`,
      "Everything you need — numbers, dates, rows, series — is in the evidence above. Do NOT fs_read it back; the fs tools exist only for something specific that is genuinely missing (the raw payloads at the outputRef paths go deeper).",
      "Reply with ONLY the JSON object described in your instructions, as your final message — do not write the draft to a file.",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const draft = await retryLlmCall(
        `v2 draft ${task.id}`,
        async (signal) => {
          const r = await generateText({
            model: options.model,
            system: draftSystemPrompt(skill!, hasSeriesTool(dataTools)),
            prompt,
            tools: sdkTools,
            // 12: fs-heavy drafts burned the old 8-step cap before replying.
            stopWhen: stepCountIs(12),
            temperature: 0,
            maxOutputTokens: 12_000,
            abortSignal: signal,
          });
          stats.steps++;
          addUsage(r.usage);
          const raw = r.text ?? "";
          let json = extractJson(raw);
          // Models sometimes emit a stray object/prose before the real reply —
          // first-brace-to-last-brace then merges both into garbage. Anchor on
          // our own envelope marker instead (the LAST {"sections"} …).
          const anchor = raw.lastIndexOf('"sections"');
          if (anchor > 0) {
            const start = raw.lastIndexOf("{", anchor);
            const env = start >= 0 ? extractJson(raw.slice(start)) : null;
            if (env && typeof env === "object" && !Array.isArray(env)) json = env;
          }
          if (json == null) throw new Error(`unparseable reply (tail): …${raw.slice(-240)}`);
          // A bare sections array is the same draft without its envelope —
          // wrap it instead of burning a full regeneration on the shape.
          if (Array.isArray(json)) json = { sections: json };
          const parsed = DraftSchema.safeParse(json);
          if (!parsed.success) {
            throw new Error(
              `draft is not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
            );
          }
          // Validation inside the retry — a schema-rejected draft gets a
          // fresh model attempt instead of dying on the spot.
          const composed = validateComposed({ sections: parsed.data.sections, sources: parsed.data.sources as Source[] });
          if (!composed.sections.length) throw new Error(`no valid sections (${composed.invalid.join("; ")})`);
          return { ...composed, score: parsed.data.score, out: r.usage.outputTokens ?? 0 };
        },
        // 300s: a 12-step tool draft on a slow gateway outgrew the old 180s cap.
        { attempts: 2, timeoutMs: 300_000 },
      );
      rejectedSections += draft.invalid.length;
      if (draft.invalid.length) errors.push(`draft "${task.name}" dropped ${draft.invalid.length} invalid section(s)`);
      task.status = "completed";
      task.score = draft.score ?? null;
      drafts.set(task.id, { sections: draft.sections, sources: draft.sources, score: draft.score });
      emit({
        type: "canvas_block",
        taskId: task.id,
        taskTitle: task.name,
        status: "done",
        sectionCount: draft.sections.length,
        durationMs: Date.now() - started,
        summary: `${draft.score != null ? `score ${draft.score}/10` : "no score"} · ${((draft.out ?? 0) / 1000).toFixed(1)}k out`,
        agent: "v2",
      });
    } catch (e: any) {
      task.status = "failed";
      task.error = friendlyError(e?.message || String(e));
      emit({
        type: "canvas_block",
        taskId: task.id,
        taskTitle: task.name,
        status: "failed",
        sectionCount: 0,
        error: task.error,
        durationMs: Date.now() - started,
        agent: "v2",
      });
    }
    savePlan();
  };
  await Promise.all(sectionTasks.map((t) => draftOne(t)));
  lap("draft");

  // ── STEP 4 — ASSEMBLE in code (inside finish: canvas → data → figures) ───
  emit({ type: "phase", phase: "run", label: "Assemble", detail: "Canvas stitch, chart data, figures — no model call" });
  for (const [i, t] of sectionTasks.entries()) {
    const d = drafts.get(t.id);
    if (d) canvas.appendSections(t.name, d.sections, d.sources, i);
  }
  lap("assemble");

  if (!canvas.sectionCount()) return fail("no valid sections reached the canvas");
  const anyFailed = [...dataTasks, ...sectionTasks].some((t) => t.status === "failed");
  if (anyFailed) errors.push("some tasks failed — see the plan file for details");
  return finish(anyFailed || rejectedSections > 0 ? "partial" : "completed");
}
