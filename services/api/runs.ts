/**
 * Run orchestration: one place that knows how to execute a harness agent
 * against a symbol and persist the run into `analysis_runs`.
 *
 * Shared by POST /analysis (fire-and-forget) and POST /harness/agents/:id/run
 * (synchronous). index.ts owns HTTP; this module owns the run lifecycle:
 * compile → tools → key/model fallback loop → throttled snapshots → persist.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../db/db.js";
import { keyPool } from "./keypool.js";
import { buildModel, type LlmKeys } from "../harness/agent.js";
import { fetchUserKeys } from "./provision.js";
import { log } from "./logger.js";
import { TraceCollector, type TraceEvent } from "../harness/trace.js";
import {
  getAgent,
  listAgents,
  createAgent,
  DEFAULT_HARNESS_AGENT,
  compileAgent,
  clampBudget,
  runAnalysis,
  ReportCanvas,
  buildToolRegistry,
  loadCliConfig,
  getSystemPrompt,
  gradeReport,
  reportDigest,
  RETRYABLE_ERROR,
  type AgentDefinition,
  type ReportDocument,
  type RunCanvasResult,
  type Engine,
  type Verdict,
  type TraceEvent as HarnessTraceEvent,
} from "../harness/index.js";
import { resolveRunConfig } from "../harness/cli/config.js";

/** Verdict AFTER the report is already persisted — off the request's critical
 *  path (the UI shows the finished report seconds earlier; the badge lands
 *  when grading returns). Fire-and-forget; failures only cost the badge. */
async function gradeInBackground(document: ReportDocument, modelId: string, llmKeys: Record<string, string>, runId: string): Promise<void> {
  try {
    const digest = reportDigest(document);
    const { apiKey } = keyPool.pickKey(modelId, llmKeys);
    const verdict = await gradeReport({ text: digest, model: buildModel(modelId, llmKeys, apiKey) });
    if (!verdict) return;
    const { error } = await getDb()
      .from("analysis_runs")
      .update({ report: { ...document, verdict }, updated_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) log.warn("harness", `background verdict failed for run ${runId}: ${error.message}`);
  } catch (e: any) {
    log.warn("harness", `background verdict error for run ${runId}: ${e?.message || e}`);
  }
}

export interface HarnessRunResult {
  status: string;
  document: ReportDocument;
  errors: string[];
  verdict?: Verdict | null;
  runId: string;
}

/** Harness loop/canvas event → the snake_case fields every UI trace consumer reads.
 *  Written once; used by both the live collector push and the persisted trace. */
function serverTraceFields(e: any): Omit<TraceEvent, "seq" | "ts" | "type" | "key"> {
  return {
    text:
      e.type === "canvas_block"
        ? `${e.status === "done" ? "✓" : "✗"} ${e.taskTitle}${e.summary ? ` — ${e.summary}` : ""}`
        : e.text,
    tool: e.tool,
    tool_call_id: e.toolCallId,
    args: e.args,
    result: e.type === "canvas_block" ? { taskId: e.taskId, sectionCount: e.sectionCount, status: e.status } : e.result,
    status: e.status === "ok" ? "OK" : e.status === "error" ? "ERR" : e.status,
    duration_ms: e.durationMs,
    score: e.score,
    summary: e.summary,
    error: e.error,
    phase: e.phase,
    label: e.type === "canvas_block" ? e.taskTitle : e.label,
  };
}

/** Harness event list → the snake_case trace persisted with the run. */
export function toLegacyTrace(events: HarnessTraceEvent[]): TraceEvent[] {
  return events.map((e: any, i: number) => ({
    seq: i + 1,
    ts: Date.now() + i,
    type: e.type,
    key: e.taskId ?? e.tool ?? e.type,
    ...serverTraceFields(e),
  }));
}

/**
 * Run a harness agent against a symbol: compile the definition, wire the data
 * tools (the Voyager MCP — required, throws when MCP_VOYAGER_URL is unset),
 * execute the CANVAS pipeline (one agent loop: research + write; then assemble) with
 * key/model fallback, persist the run, and return the typed document.
 * Shared by POST /analysis and POST /harness/agents/:id/run. Returns null when
 * the agent does not exist for the user.
 *
 * The canvas lives in memory for the run; a throttled snapshot of the partial
 * document lands in `report` while status is still RUNNING, so the result page
 * renders sections as they compose and a crash leaves a valid partial report.
 */
export async function runHarnessSymbol(
  userId: string,
  agentId: string,
  symbol: string,
  source: string,
  requestedModel?: string,
  requestedSystemPrompt?: string,
  existingRunId?: string,
  /** Request override: 1 prompt. Absent = the synthesized Analyze prompt. */
  promptOverride?: string,
  /** Request override: skill id (max 1). Absent/empty = the agent's own skill. */
  skillIdsOverride?: string[],
  /** Request override: loop/token budget (--max-steps / --max-tokens). Caller
   *  only includes keys it actually parsed — an `undefined` value here would
   *  wipe the agent's budget back to defaults inside clampBudget. */
  budgetOverride?: { maxSteps?: number; maxTokens?: number },
  /** Request override: engine (--engine / body.engine). Absent = harness.config.json. */
  engineOverride?: Engine,
): Promise<HarnessRunResult | null> {
  const t0 = Date.now();
  const agent = await getAgent(userId, agentId);
  if (!agent) return null;

  // System prompt chosen by name (agent.yaml prompts.*): request override, else
  // the agent's own pick, else the default `agents` doc. Unknown names fall
  // back to the default in both resolvers below.
  const systemPrompt = requestedSystemPrompt || agent.systemPrompt || undefined;
  const template = getSystemPrompt(systemPrompt || "");
  const compiled = await compileAgent(userId, agent, {
    template,
    vars: { symbol, title: symbol, date: new Date().toISOString().slice(0, 10), source, agent: agent.name },
    skillIds: skillIdsOverride,
  });
  const { llmKeys } = await fetchUserKeys(userId);
  let modelId = requestedModel || agent.modelId || keyPool.getDefaultModel(llmKeys);
  const budget = clampBudget({ ...compiled.budget, ...budgetOverride });
  // API wall-clock backstop: soft "write now" at ~108s, hard stop at 180s.
  // ponytail: per-agent maxMs in the agents row when per-run tuning is asked for
  if (!budget.maxMs) budget.maxMs = 180_000;
  // Tool sources (websearch + MCP servers) come from harness.config.json's
  // `tools` section — same file the CLI reads. MCP tools are listed fresh from
  // each server per run, so new tools appear without an API restart.
  // The engine switch (v1 loop / v2 plan harness) lives in the same file.
  const cliCfg = loadCliConfig().config;
  const { engine } = resolveRunConfig({ engine: engineOverride }, process.env, cliCfg);
  const { registry } = await buildToolRegistry(cliCfg.tools ?? {}, process.env);

  const runId = existingRunId ?? randomUUID();

  // Re-run of an existing row: restore its workspace so the agent resumes
  // research (notes, plan, source stubs) instead of starting from nothing.
  let initialWorkspace: Record<string, string> | undefined;
  if (existingRunId) {
    try {
      const { data } = await getDb()
        .from("analysis_runs")
        .select("workspace")
        .eq("id", existingRunId)
        .eq("user_id", userId)
        .maybeSingle();
      initialWorkspace = (data?.workspace as Record<string, string> | null) ?? undefined;
    } catch {
      // column missing (pre-0.20) or row unreadable — run fresh
    }
  }

  // Live trace: every canvas/loop event is published to the SSE hub while the
  // run is going, and a throttled copy is persisted so a restart doesn't blank
  // the panel. The final write below replaces it with the complete trace.
  const collector = new TraceCollector(runId, async (events) => {
    try {
      await getDb()
        .from("analysis_runs")
        .update({ trace: events, updated_at: new Date().toISOString() })
        .eq("id", runId);
    } catch {
      // trace persistence is best-effort; the final write is authoritative
    }
  });

  // Throttled canvas + workspace snapshots → `report` / `workspace` columns
  // mid-run. UI polls GET /analysis/:id; the Agent Workspace tab and the live
  // report both ride this cadence.
  let lastCanvasFlush = 0;
  const flushCanvas = async (canvas: ReportCanvas, force = false) => {
    const now = Date.now();
    if (!force && now - lastCanvasFlush < 3000) return;
    lastCanvasFlush = now;
    try {
      await getDb()
        .from("analysis_runs")
        .update({ report: canvas.document(), updated_at: new Date().toISOString() })
        .eq("id", runId);
    } catch (e: any) {
      log.warn("harness", `canvas snapshot failed for run ${runId}: ${e?.message || e}`);
    }
  };
  let lastWorkspaceFlush = 0;
  const flushWorkspace = async (snapshot: Record<string, string>, force = false) => {
    const now = Date.now();
    if (!force && now - lastWorkspaceFlush < 5000) return;
    lastWorkspaceFlush = now;
    try {
      await getDb()
        .from("analysis_runs")
        .update({ workspace: snapshot, updated_at: new Date().toISOString() })
        .eq("id", runId);
    } catch (e: any) {
      log.warn("harness", `workspace snapshot failed for run ${runId}: ${e?.message || e}`);
    }
  };

  // Transient provider failures must not kill the run. The loop sets
  // maxRetries:0, so each attempt owns its key: rotate to a fresh key, and if
  // the provider stays exhausted, fall back to another model. The pattern is
  // the harness-wide RETRYABLE_ERROR (resilience.ts) — one definition of
  // "worth another attempt"; this loop's job is only the key/model rotation.
  // One seam: same options in, same result out — the engine picks the pipeline.
  let result: RunCanvasResult | undefined;
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const provider = keyPool.modelProvider(modelId);
    const { apiKey, keyRef } = keyPool.pickKey(modelId, llmKeys);
    try {
      result = await runAnalysis({
        model: buildModel(modelId, llmKeys as LlmKeys, apiKey),
        soul: agent.soulPrompt,
        skills: compiled.skills,
        prompt: promptOverride || `Analyze ${symbol} (${source}). Use the tools to gather the evidence a rigorous research report needs for ${symbol}.`,
        tools: registry.list(),
        allowedTools: compiled.allowedTools.length ? compiled.allowedTools : undefined,
        ctx: { symbol, source, tavilyKey: llmKeys.tavily || undefined },
        budget,
        systemPrompt,
        template,
        // Report lands first; verdict grades in the background (gradeInBackground).
        grade: false,
        initialWorkspace,
        onEvent: (e) => {
          const ev = e as any;
          collector.push(ev.type, ev.taskId ?? ev.tool ?? ev.type, serverTraceFields(ev));
        },
        onCanvas: (canvas) => {
          void flushCanvas(canvas);
        },
        onWorkspace: (snapshot) => {
          void flushWorkspace(snapshot);
        },
      }, engine);
      keyPool.recordUsage({ provider, keyRef, modelId, requests: 1, tokensOut: result.budgetUsed.tokens });
      break;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e);
      if (attempt >= 3 || !RETRYABLE_ERROR.test(msg)) throw e;
      keyPool.markFailure(provider, keyRef);
      const next = keyPool.getDefaultModel(llmKeys);
      log.warn("harness", `run ${agent.id} attempt ${attempt}/3 failed on ${modelId}: ${msg} — falling back to ${next || "same model"}`);
      if (next && next !== modelId) modelId = next;
      await new Promise((r) => setTimeout(r, 750 * attempt));
    }
  }
  if (!result) throw lastError;
  await collector.flush().catch(() => {});
  await flushCanvas(result.canvas, true).catch(() => {});

  // Harness runs persist into the existing analysis_runs table (agent_runs
  // from migration 019 was never created). The typed ReportDocument goes in
  // `report`; GET /analysis/:id surfaces it as `report_document`.
  //
  // A "partial" canvas run (some tasks failed) is still a renderable report —
  // COMPLETED with notes, not ERROR. Only a run that produced nothing is ERROR.
  const legacyStatus = result.status === "failed" ? "ERROR" : "COMPLETED";
  const notes = [...result.errors];
  if (result.status === "partial") notes.unshift("some report sections could not be composed (see notes below)");
  if (result.status === "failed") notes.unshift("run produced no valid sections");
  const payload = {
    status: legacyStatus,
    symbol,
    share_name: symbol,
    agent_name: agent.name,
    model: modelId,
    source,
    // Verdict rides inside the report jsonb: no verdict column exists (019
    // never shipped) and the list page needs it without selecting the whole
    // document — GET /analysis asks for `report->verdict`.
    report: result.verdict ? { ...result.document, verdict: result.verdict } : result.document,
    trace: toLegacyTrace(result.trace),
    workspace: result.workspace,
    duration: Math.round((Date.now() - t0) / 1000),
    // Report validation/fallback notes (e.g. "used prose fallback") — the only
    // channel that surfaces a degraded-but-renderable run. ponytail: no
    // budget_used column yet (agent_runs never shipped); add one when the
    // "stopped after N steps" banner is worth a migration.
    error: notes.length ? notes.join("\n") : null,
    updated_at: new Date().toISOString(),
  };
  if (existingRunId) {
    let { error } = await getDb().from("analysis_runs").update(payload).eq("id", existingRunId);
    if (error && /workspace/.test(error.message)) {
      log.warn("harness", `analysis_runs missing workspace column — apply services/db/supabase/migrations/020_analysis_workspace.sql (${error.message})`);
      const { workspace: _drop, ...rest } = payload;
      ({ error } = await getDb().from("analysis_runs").update(rest).eq("id", existingRunId));
    }
    if (error) throw new Error(error.message);
    // Grade only when the run carries no verdict yet (v1 passes grade:false
    // server-side; v2 sets its score-derived verdict itself).
    if (!result.verdict && result.status !== "failed") void gradeInBackground(result.document, modelId, llmKeys, existingRunId);
    return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId: existingRunId };
  }
  let row: Record<string, any> = {
    id: runId,
    user_id: userId,
    ...payload,
    system_prompt: systemPrompt ?? null,
    created_at: new Date().toISOString(),
  };
  let { error } = await getDb().from("analysis_runs").insert(row);
  // Columns newer than the deployed schema (020 workspace, 022 system
  // prompt) — drop whichever the table is missing and retry; the run's
  // report/trace are what the UI renders.
  for (const col of ["workspace", "system_prompt"]) {
    if (error && error.message.includes(col)) {
      log.warn("harness", `analysis_runs missing ${col} column — apply services/db/supabase/migrations (${error.message})`);
      delete row[col];
      ({ error } = await getDb().from("analysis_runs").insert(row));
    }
  }
  if (error) throw new Error(error.message);
  if (!result.verdict && result.status !== "failed") void gradeInBackground(result.document, modelId, llmKeys, runId);
  return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId };
}

export interface StartAnalysisRunOpts {
  userId: string;
  symbol: string;
  source: string;
  /** Raw request agent_id; absent → the user's default agent. */
  agentId?: string;
  model?: string;
  systemPrompt?: string;
  prompt?: string;
  skillIds?: string[];
  budget?: { maxSteps?: number; maxTokens?: number };
  /** Pipeline override (v1 loop / v2 plan); absent = harness.config.json. */
  engine?: Engine;
}

/**
 * Insert the placeholder row and launch the run in the background; returns the
 * run id immediately (POST /analysis responds before the run finishes, and the
 * schedule ticker fires the exact same path). Resolves the agent here so both
 * callers get the seeded-default fallback for free.
 */
export async function startAnalysisRun(o: StartAnalysisRunOpts): Promise<string> {
  let agent = o.agentId ? await getAgent(o.userId, o.agentId) : null;
  if (!agent) {
    const seeded = await listAgents(o.userId);
    agent = seeded[0] ?? (await createAgent(o.userId, DEFAULT_HARNESS_AGENT));
  }

  const runId = randomUUID();
  const runRow = {
    id: runId,
    user_id: o.userId,
    status: "RUNNING",
    symbol: o.symbol,
    share_name: o.symbol,
    agent_name: agent.name,
    model: o.model || agent.modelId || null,
    source: o.source,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Older databases may miss migration 021/022 — try with both columns, then
  // without the newer one; the run still starts and the list just shows less.
  const inserts = [
    { ...runRow, skill_ids: o.skillIds ?? null, system_prompt: o.systemPrompt ?? null },
    { ...runRow, skill_ids: o.skillIds ?? null },
    runRow,
  ];
  let phErr: { message: string } | null = null;
  for (const row of inserts) {
    ({ error: phErr } = await getDb().from("analysis_runs").insert(row));
    if (!phErr || !/skill_ids|system_prompt/.test(phErr.message)) break;
  }
  if (phErr) throw new Error(phErr.message);

  runHarnessSymbol(
    o.userId,
    // agent.id, NOT the raw request agent_id: when the caller omits it the
    // resolved default agent above is the one that must run — an empty id
    // makes runHarnessSymbol return null and the row hangs RUNNING forever.
    agent.id,
    o.symbol,
    o.source,
    o.model,
    o.systemPrompt,
    runId,
    o.prompt,
    o.skillIds,
    o.budget,
    o.engine,
  ).then((result) => {
    // Belt: a null resolution (agent row vanished mid-run) must fail the row
    // instead of leaving the UI on an eternal spinner.
    if (!result) throw new Error("run did not start: agent not found");
  }).catch(async (e: any) => {
    console.error("background analysis run failed:", e);
    await getDb().from("analysis_runs")
      .update({ status: "ERROR", error: e?.message || "run failed", updated_at: new Date().toISOString() })
      .eq("id", runId);
  });
  return runId;
}

const STALE_RUN_MS = 15 * 60 * 1000;

/** Fail analysis_runs stuck in PENDING/RUNNING (in-process runs don't survive a
 *  restart, and a hung model call would otherwise leave a run "running" forever). */
export async function sweepStaleRuns(reason: string, olderThanMs: number): Promise<void> {
  try {
    let q = getDb()
      .from("analysis_runs")
      .update({ status: "FAILED", error: reason, updated_at: new Date().toISOString() })
      .in("status", ["PENDING", "RUNNING"]);
    if (olderThanMs > 0) q = q.lt("started_at", new Date(Date.now() - olderThanMs).toISOString());
    const { error } = await q;
    if (error) log.warn("[sweeper]", `stale-run sweep failed: ${error.message}`);
  } catch (e: any) {
    log.warn("[sweeper]", `stale-run sweep error: ${e?.message || e}`);
  }
}

/** Boot + periodic calls used by the server's listen callback. */
export function startStaleRunSweeper(): void {
  void sweepStaleRuns("Server restarted while this run was in progress.", 0);
  setInterval(() => void sweepStaleRuns("Run timed out with no progress.", STALE_RUN_MS), 60_000).unref?.();
}
