/**
 * Run orchestration: one place that knows how to execute a harness agent
 * against a symbol and persist the run into `analysis_runs`.
 *
 * Shared by POST /analysis (fire-and-forget) and POST /harness/agents/:id/run
 * (synchronous). index.ts owns HTTP; this module owns the run lifecycle:
 * compile → tools → key/model fallback loop → throttled snapshots → persist.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { keyPool } from "./keypool.js";
import { buildModel, type LlmKeys } from "./agent.js";
import { fetchUserKeys } from "./provision.js";
import { log } from "./logger.js";
import { TraceCollector, type TraceEvent } from "./trace.js";
import {
  getAgent,
  compileAgent,
  runCanvasAnalysis,
  ReportCanvas,
  buildToolRegistry,
  loadCliConfig,
  getOutputTemplate,
  type AgentDefinition,
  type ReportDocument,
  type Verdict,
  type TraceEvent as HarnessTraceEvent,
} from "./harness/index.js";

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
  requestedTemplateId?: string,
  existingRunId?: string,
  /** Request override: 1 prompt. Absent = the synthesized Analyze prompt. */
  promptOverride?: string,
  /** Request override: skill ids. Absent/empty = the user's ALL skills. */
  skillIdsOverride?: string[],
): Promise<HarnessRunResult | null> {
  const agent = await getAgent(userId, agentId);
  if (!agent) return null;

  // System prompt: always the harness report format (one format now —
  // config/prompts/AGENTS.md; outputTemplateId is kept for schema compat but inert).
  const template = getOutputTemplate(requestedTemplateId || agent.outputTemplateId || "");
  const compiled = await compileAgent(userId, agent, {
    template,
    vars: { symbol, title: symbol, date: new Date().toISOString().slice(0, 10), source, agent: agent.name },
    skillIds: skillIdsOverride,
  });
  const { llmKeys } = await fetchUserKeys(userId);
  let modelId = requestedModel || agent.modelId || keyPool.getDefaultModel(llmKeys);
  // Tool sources (websearch + MCP servers) come from harness.config.json's
  // `tools` section — same file the CLI reads. MCP tools are listed fresh from
  // each server per run, so new tools appear without an API restart.
  const { registry } = await buildToolRegistry(loadCliConfig().config.tools ?? {}, process.env);

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
        .update({ report: canvas.document({ final: false }), updated_at: new Date().toISOString() })
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

  // Transient provider failures (429/quota/5xx/timeout) must not kill the run.
  // The loop sets maxRetries:0, so each attempt owns its key: rotate to a fresh
  // key, and if the provider stays exhausted, fall back to another model.
  // "parse" covers Groq/gpt-oss's intermittent output_parse_failed (400): a
  // stochastic harmony tool-call glitch, not a bad request — worth another roll.
  const RETRYABLE_MODEL_ERROR = /429|rate.?limit|too many requests|quota|overloaded|resource.?exhausted|unavailable|temporarily|5\d\d|timeout|ECONNRESET|ETIMEDOUT|aborted|output_parse_failed|could not be parsed|failed to parse|parsing failed/i;
  let result: Awaited<ReturnType<typeof runCanvasAnalysis>> | undefined;
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const provider = keyPool.modelProvider(modelId);
    const { apiKey, keyRef } = keyPool.pickKey(modelId, llmKeys);
    try {
      result = await runCanvasAnalysis({
        model: buildModel(modelId, llmKeys as LlmKeys, apiKey),
        soul: agent.soulPrompt,
        skills: compiled.skills,
        prompt: promptOverride || `Analyze ${symbol} (${source}). Use the tools to gather the evidence a rigorous research report needs for ${symbol}.`,
        tools: registry.list(),
        allowedTools: compiled.allowedTools.length ? compiled.allowedTools : undefined,
        ctx: { symbol, source },
        budget: compiled.budget,
        template,
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
      });
      keyPool.recordUsage({ provider, keyRef, modelId, requests: 1, tokensOut: result.budgetUsed.tokens });
      break;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e);
      if (attempt >= 3 || !RETRYABLE_MODEL_ERROR.test(msg)) throw e;
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
    report: result.document,
    trace: toLegacyTrace(result.trace),
    workspace: result.workspace,
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
      log.warn("harness", `analysis_runs missing workspace column — apply api/supabase/migrations/020_analysis_workspace.sql (${error.message})`);
      const { workspace: _drop, ...rest } = payload;
      ({ error } = await getDb().from("analysis_runs").update(rest).eq("id", existingRunId));
    }
    if (error) throw new Error(error.message);
    return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId: existingRunId };
  }
  let { error } = await getDb().from("analysis_runs").insert({
    id: runId,
    user_id: userId,
    ...payload,
    created_at: new Date().toISOString(),
  });
  // workspace is new in migration 020 — persist without it (report/trace are
  // what the UI renders) until the column is applied.
  if (error && /workspace/.test(error.message)) {
    log.warn("harness", `analysis_runs missing workspace column — apply api/supabase/migrations/020_analysis_workspace.sql (${error.message})`);
    const { workspace: _drop, ...rest } = payload;
    ({ error } = await getDb().from("analysis_runs").insert({ id: runId, user_id: userId, ...rest, created_at: new Date().toISOString() }));
  }
  if (error) throw new Error(error.message);
  return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId };
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
