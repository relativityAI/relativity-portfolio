/**
 * Canvas run — ONE autonomous agent, then a plain stitch.
 *
 * A single ToolLoopAgent loop researches AND writes the report: the agent
 * gathers evidence with the data tools (auto-archived to the in-memory KB —
 * compact stubs to the model, raw payloads out of context) and writes each
 * section onto the canvas via report_write as its evidence lands, following
 * the selected system prompt and its skills. When the budget runs low,
 * prepareStep appends a soft "start writing" nudge — advice only, never a
 * forced tool call.
 *
 * The report is only stitched: canvas.document() concatenates the section-
 * groups the agent wrote, one after the other, then renderFigures draws each
 * chart's SVG — no other post-processing.
 * The caller owns persistence: `onCanvas` fires after every report_write so a
 * throttled writer can snapshot the partial document. Nothing here touches the
 * filesystem.
 */

import { promptDoc, shouldSaveWorkspace } from "../config.js";
import { allBlocks, countCharts, sectionHeadings } from "../report/document.js";
import { attachChartData, renderFigures } from "../report/builder.js";
import { applyVariables } from "../system-prompts/catalog.js";
import { activateSkill, reportStructureBlock } from "../skills/activate.js";
import type { ToolContext, ToolDefinition } from "../tools/registry.js";
import type { TraceEvent } from "../types.js";
import { runAgentLoop } from "../loop/agent-loop.js";
import { plotReferenceMarkdown, sectionContractMarkdown } from "../report/reference.js";
import { ReportCanvas } from "./canvas.js";
import { reportWriteTool } from "./report-tool.js";
import { Workspace } from "../workspace/fs.js";
import { readPlan, workspaceTools } from "../workspace/tools.js";
import { PATHS } from "../workspace/paths.js";
import { webFetchTool } from "../tools/builtins/webfetch.js";
import { archiveResult } from "../workspace/archive.js";
import { friendlyError } from "../errors.js";
import { gradeReport, reportDigest, type Verdict } from "../report/verdict.js";
import type { RunCanvasOptions, RunCanvasResult, RunStats, CanvasRunStatus } from "../engine.js";
import { TEXT_TOOLS, datedPrompt, hasSeriesTool } from "../prompts.js";

// Re-exported for the canvas surface (barrel + tests); owned by prompts.ts.
export { TEXT_TOOLS };

export async function runCanvasAnalysis(options: RunCanvasOptions): Promise<RunCanvasResult> {
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    options.onEvent?.(e);
  };
  const notify = () => options.onCanvas?.(canvas);
  const canvas = new ReportCanvas(options.ctx.symbol);
  const workspace = new Workspace();
  const resumed = !!options.initialWorkspace && Object.keys(options.initialWorkspace).length > 0;
  if (resumed) workspace.hydrate(options.initialWorkspace!);
  // Root doc: the agent's instructions (the selected prompt doc),
  // seeded once (a resumed run keeps the agent's edits; reminders() re-sends
  // it when edited). The plan is NOT seeded — todo_write owns /workspace/plan.json.
  const agentsDoc = promptDoc(options.systemPrompt ?? "agents") || promptDoc("agents");
  if (agentsDoc && workspace.read(PATHS.agents) == null) workspace.write(PATHS.agents, agentsDoc);
  // Compaction must WORK without extra config: when no cheap summarizer model
  // is passed, summarize with the run's own model. (The summarize call runs
  // inside prepareStep — its own generateText, zero steps, zero budget tokens.)
  const summarizerModel = options.summarizerModel ?? options.model;

  // ── THE AGENT — one autonomous loop: research + write ────────────────────
  emit({ type: "phase", phase: "run", label: "Agent", detail: "One autonomous loop: gather evidence, write the report" });
  const baseTools = options.allowedTools?.length
    ? options.tools.filter((t) => options.allowedTools!.includes(t.name))
    : options.tools;
  // web_fetch is built here — only this layer has the workspace handle it
  // saves full pages into — and it obeys the same allow-list as the rest.
  const webFetch: ToolDefinition[] =
    !options.allowedTools?.length || options.allowedTools.includes("web_fetch") ? [webFetchTool(workspace)] : [];
  const dataTools = [...webFetch, ...baseTools];
  // Data tools archive automatically; the model sees the compact KB stub.
  const archived: ToolDefinition[] = dataTools.map((t) => ({
    ...t,
    execute: async (args: any, ctx: ToolContext) =>
      archiveResult(workspace, { tool: t.name, args, result: await t.execute(args, ctx), symbol: ctx.symbol }),
  }));
  // report_write joins the shared canvas_block vocabulary (same event v2
  // drafts emit) so both engines' section writes read the same on a timeline.
  const writeTool = reportWriteTool(canvas, notify);
  const sectionWrite: ToolDefinition = {
    ...writeTool,
    execute: async (args: any, ctx: ToolContext) => {
      const r: any = await writeTool.execute(args, ctx);
      if (r?.added) {
        emit({
          type: "canvas_block",
          taskId: String(args.title ?? "write"),
          taskTitle: String(args.title ?? "section"),
          status: "done",
          sectionCount: r.added,
          summary: r.rejected?.length ? `${r.added} sections · ${r.rejected.length} rejected` : `${r.added} sections written`,
        });
      }
      return r;
    },
  };
  const tools = [...workspaceTools(workspace), ...archived, sectionWrite];
  // Surface KB growth live: wrap every tool and emit when the volume changed.
  const watchKb = (t: ToolDefinition): ToolDefinition => ({
    ...t,
    execute: async (args: any, ctx: ToolContext) => {
      const before = workspace.stats();
      const result = await t.execute(args, ctx);
      const after = workspace.stats();
      if (after.files !== before.files || after.bytes !== before.bytes) emit({ type: "kb", ...after });
      return result;
    },
  });
  const watchedTools = tools.map(watchKb);

  const soul = options.soul?.trim() ?? "";
  // Dynamic slots: config-dir prose stays hand-edited; lists that change with
  // the schema or the workspace are generated per run ({{section_contract}},
  // {{plot_reference}}, {{workspace_tree}}) so neither needs a prompt edit.
  const seriesOk = hasSeriesTool(dataTools);
  const slots: Record<string, string | undefined> = {
    section_contract: sectionContractMarkdown(),
    plot_reference: plotReferenceMarkdown(seriesOk),
    workspace_tree: workspace.treeMarkdown(),
  };
  const fill = (text: string) => applyVariables(text, slots);
  // Contract & plots always reach the model — the prompt doc's slots decide
  // placement; without them they're appended here (format file edited away).
  const generated = [
    /\{\{\s*section_contract\s*\}\}/.test(agentsDoc)
      ? ""
      : `## Report sections\nreport_write accepts only these typed section blocks — any other type is rejected:\n${sectionContractMarkdown()}`,
    /\{\{\s*plot_reference\s*\}\}/.test(agentsDoc) ? "" : `## Plots\n${plotReferenceMarkdown(seriesOk)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Instructions = the selected prompt doc (identity + protocol + format contract),
  // then the skill-owned report structure as a BINDING block near the top
  // (models ignore specs appended after long skill bodies), then soul, per-run
  // bits, and the skill instructions themselves.
  const structure = reportStructureBlock(options.skills);
  const system = [
    fill(agentsDoc),
    structure ? `## Report structure — BINDING\n${structure}` : "",
    soul,
    generated,
    options.skills.length ? `## Skill instructions\n${options.skills.map(activateSkill).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = resumed
    ? `Resuming a previous run — the workspace (notes, sources, plan) is restored. Read ${PATHS.planMd} first, then continue.\n\n${options.prompt}`
    : options.prompt;
  const userPrompt = datedPrompt(prompt);

  // Live todo + memory, re-read every step (the agent edits both mid-run).
  // Format gaps ride the same reminder: the checklist is executed by the
  // harness every step, so the agent sees what's still missing while it can
  // still write it (soft instruction — never forces a tool call).
  const formatGaps = (): string => {
    const tpl = options.template;
    if (!tpl) return "";
    const doc = canvas.document();
    const have = sectionHeadings(doc);
    const missing = (tpl.required_sections ?? []).filter((w) => !have.some((h) => h.includes(w.toLowerCase())));
    const charts = countCharts(doc);
    const chartBlocks = allBlocks(doc).filter((x) => x.type === "chart");
    const gaps: string[] = [];
    if (missing.length) gaps.push(`sections still missing: ${missing.join(", ")}`);
    if (tpl.min_charts && charts < tpl.min_charts) gaps.push(`charts: ${charts}/${tpl.min_charts}`);
    if (tpl.require_sources && !doc.sources.length) gaps.push("no sources cited yet");
    const bare = chartBlocks.filter((x) => !x.measure || !x.sourceId).length;
    if (bare) gaps.push(`charts missing measure/sourceId: ${bare}`);
    return gaps.length
      ? `## Report format status — still missing\n- ${gaps.join("\n- ")}\nWrite the gaps with report_write before finishing.`
      : "## Report format status — all format requirements met.";
  };
  const reminders = (): string | undefined => {
    // Todo list re-sent EVERY step as the trailing reminder — the live plan,
    // straight from todo_write's journal (crash-resume reads the same file).
    const items = readPlan(workspace);
    const counts = items
      ? { done: items.filter((i) => i.status === "completed").length, total: items.length }
      : null;
    const plan = counts
      ? `## Todo list (${PATHS.planMd}) — update ONLY with todo_write; exactly ONE item in_progress\n${items!
          .map((i) => `${i.status === "completed" ? "[x]" : i.status === "in_progress" ? "[>]" : "[ ]"} ${i.content}`)
          .join("\n")}\nStatus: ${counts.done}/${counts.total} completed`
      : "## Todo list — no plan yet. Call todo_write FIRST with the full task list (id, content, status).";
    const liveAgents = workspace.read(PATHS.agents);
    const parts = [
      plan,
      // AGENTS.md rides the static instructions — only re-send the LIVE copy
      // when the agent actually edited it (otherwise it's plain duplication).
      liveAgents && liveAgents !== agentsDoc ? `## AGENTS.md (edited this run — live copy)\n${liveAgents}` : "",
      // Report structure rides the static system prompt only — instructions
      // survive compaction untouched, so re-sending it every step is pure
      // duplicate input (it used to ship 3×: system + skill body + reminder).
      formatGaps(),
    ].filter(Boolean);
    return parts.join("\n\n");
  };

  let loopStatus: "completed" | "budget_exhausted" | "failed" = "failed";
  let steps = 0;
  let tokens = 0;
  let inputTokens = 0;
  let peakInput = 0;
  try {
    const loop = await runAgentLoop({
      model: options.model,
      system,
      prompt: userPrompt,
      reminders,
      tools: watchedTools,
      ctx: options.ctx,
      budget: options.budget,
      contextBudget: options.contextBudget,
      summarizerModel,
      // Soft deadline nudge (instruction only — never forces a tool call).
      deadlineTool: "report_write",
      abortSignal: options.abortSignal,
      onEvent: emit,
      onStepFinish: options.onStepFinish,
    });
    loopStatus = loop.status;
    steps = loop.steps;
    tokens = loop.tokens;
    inputTokens = loop.inputTokens;
    peakInput = loop.peakInput;
    if (loop.status === "failed") emit({ type: "log", text: "agent loop failed — reading back whatever was written" });
  } catch (e: any) {
    emit({ type: "log", text: `agent loop crashed — ${friendlyError(e?.message || String(e))}` });
  }
  notify();

  // ── STITCH — the section-groups, one after the other, exactly as the agent
  // wrote them. Passes: attachChartData expands chart data tokens from this
  // run's archived results, renderFigures draws each chart's SVG. Raw [src:…]
  // tokens and sources stay exactly as written — no rewriting.
  const document = canvas.document();
  attachChartData(document, trace, workspace.payloadEntries());
  renderFigures(document);

  const loopErrors: string[] = [];
  if (loopStatus === "failed") loopErrors.push("agent loop failed");
  if (loopStatus === "budget_exhausted") loopErrors.push("agent stopped at the step/token budget");

  // Completion gate — the same verify loop the format checklist uses: a run
  // whose todo list still has open items ships PARTIAL, never "completed".
  // (A run that never called todo_write has no pending items — the per-step
  // reminder is its only nudge. ponytail: strict "plan must exist" gate if
  // soft pressure proves insufficient.)
  const gate: string[] = [];
  if (loopStatus === "completed") {
    const items = readPlan(workspace);
    const open = (items ?? []).filter((i) => i.status !== "completed");
    if (items && open.length) {
      gate.push(`completion gate: ${open.length} todo item(s) still open — ${open.map((i) => i.content.slice(0, 60)).join("; ")}`);
    }
  }

  const errors = [...loopErrors, ...gate];

  // Only a write that delivered NOTHING counts as damage — blocks the agent
  // re-sent successfully are history, and a cumulative counter kept every
  // fixed run permanently "partial".
  const rejectedSections = trace
    .filter((e) => e.type === "tool_result" && e.tool === "report_write" && e.status === "ok")
    .filter((e) => {
      const r = (e as any).result ?? {};
      return (r.rejected?.length ?? 0) > 0 && !(r.added > 0);
    })
    .reduce((n, e) => n + (((e as any).result?.rejected as unknown[] | undefined)?.length ?? 0), 0);
  const wroteAny = canvas.sectionCount() > 0;
  if (!wroteAny && rejectedSections) {
    errors.push(`every report_write was rejected (${rejectedSections} section(s)) — no valid section reached the canvas`);
  }
  if (!wroteAny && !errors.length) errors.push("agent finished without writing any sections");
  // A write whose sections were all rejected, or a plan left open, ships
  // PARTIAL — the loop's own gates, nothing report-format related.
  const status: CanvasRunStatus = !wroteAny
    ? "failed"
    : rejectedSections > 0 || gate.length > 0
      ? "partial"
      : "completed";
  emit({ type: "log", text: `Report stitched — ${document.sections.length} sections, ${status}` });

  // One quality verdict on the final document — outside the loop (no steps,
  // no budget tokens), null on failure/abort, report itself untouched.
  // API runs pass grade:false and grade in the background after persisting.
  let verdict: Verdict | null = null;
  if (options.grade !== false && wroteAny && !options.abortSignal?.aborted) {
    const digest = reportDigest(document);
    verdict = await gradeReport({ text: digest, model: summarizerModel, abortSignal: options.abortSignal });
    emit({ type: "log", text: verdict ? `report verdict: ${verdict}` : "report verdict unavailable" });
  }

  const stats: RunStats = {
    steps,
    tokens,
    inputTokens,
    peakInput,
    toolCalls: trace.filter((e) => e.type === "tool_call").length,
    kbFiles: workspace.stubs().length,
  };
  emit({
    type: "log",
    text: `run stats — in ${stats.inputTokens.toLocaleString()} (peak step ${stats.peakInput.toLocaleString()}) · out ${stats.tokens.toLocaleString()} tokens · ${stats.toolCalls} tool calls · ${stats.steps} steps · ${stats.kbFiles} KB sources`,
  });
  options.onWorkspace?.(workspace.compact());

  // Run flag (agent.yaml run.saveWorkspace, or the caller's --save-workspace):
  // hand the caller the COMPLETE filesystem (incl. raw payloads).
  const saveFull = shouldSaveWorkspace(options.saveWorkspace);
  const workspaceFull = saveFull ? workspace.toJSON() : undefined;

  return {
    status,
    document,
    errors,
    trace,
    budgetUsed: stats,
    canvas,
    rejectedSections,
    verdict,
    workspace: workspace.compact(),
    workspaceFull,
  };
}
