import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { runIterativeAgent } from "./iterative-agent.js";
import { traceHub, TraceCollector } from "./trace.js";
import { log } from "./logger.js";
import { cleanToolData } from "./tools.js";
import type { AnalysisReport } from "./agent.js";

/** Persistence seam: the only storage the pipeline needs. Prod adapter wraps Supabase (see index.ts); tests use an in-memory fake. */
/* ponytail: insert/update only — no query methods; extend the interface when a read path appears. */
export interface RunStore {
  insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  update(id: string, patch: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export interface AnalysisRequest {
  userId: string;
  symbol: string;
  skillId: string;
  source: string;
  shareName: string;
  agentName: string;
  skillMarkdown: string;
  modelId: string;
  model: LanguageModel;
  store: RunStore;
  onStarted: (id: string) => void;
}

let missingColumnsWarned = false;

function toolResultOverview(value: any): string {
  const data = cleanToolData(value);
  if (Array.isArray(data)) {
    const fields = data.find((item) => item && typeof item === "object" && !Array.isArray(item));
    return `Parsed ${data.length} rows${fields ? ` and ${Object.keys(fields).length} fields per row` : ""}. Full parsed values are in Source data.`;
  }
  if (data && typeof data === "object") {
    return `Parsed ${Object.keys(data).length} fields. Full parsed values are in Source data.`;
  }
  return data == null ? "No data returned." : `Parsed value: ${String(data)}`;
}

export async function runAnalysis(req: AnalysisRequest): Promise<void> {
  const { store, onStarted } = req;
  const id = randomUUID();
  const startedAt = Date.now();
  const createdAt = new Date(startedAt).toISOString();
  const { error } = await store.insert({
    id,
    user_id: req.userId,
    status: "PENDING",
    symbol: req.symbol,
    share_name: req.shareName,
    agent_name: req.agentName,
    model: req.modelId,
    source: req.source,
    run_mode: "iterative",
    skill_id: req.skillId,
    created_at: createdAt,
    started_at: createdAt,
    updated_at: new Date().toISOString(),
    duration: null,
    skill_outputs: [],
    trace: [],
  });
  if (error) throw new Error(error.message);
  traceHub.reset(id);
  const trace = new TraceCollector(id, async (events) => {
    const { error: traceError } = await store.update(id, { trace: events });
    if (traceError) log.error("[skill-run] trace persistence failed:", traceError.message);
  });
  onStarted(id);
  void (async () => {
    try {
      const instruction = [req.skillMarkdown, "", "Run the full analysis this skill prescribes for the bound company. Capture data with the tools before writing conclusions, and for charts call get_price_history with include_series=true."].join("\n");
      const result = await runIterativeAgent({
        instruction,
        symbol: req.symbol,
        source: req.source,
        model: req.model,
        onEvent: (event) => {
          if (event.type === "thought") trace.push("thought", "iterative", { text: event.text });
          else if (event.type === "tool_call") trace.push("tool_call", "iterative", { tool: event.tool, tool_call_id: event.toolCallId, args: event.args });
          else if (event.type === "tool_result") trace.push("tool_result", "iterative", { tool: event.tool, tool_call_id: event.toolCallId, status: event.status, result: toolResultOverview(event.result), duration_ms: event.duration_ms });
          else if (event.type === "decision") trace.push("decision", "iterative", { score: event.score, text: event.text });
        },
      });
      const done = result.status === "DONE";
      const report: AnalysisReport = {
        heroPct: 0,
        heroLabel: "",
        blocks: [
          { type: "heading", level: 2, text: "Iterative analysis" },
          { type: "paragraph", text: (result.text || result.error || "The run produced no output.").slice(0, 30000) },
        ],
        partial: !done,
        source: "fallback",
      };
      trace.push("log", "iterative", { text: done ? `Completed after ${result.iterations} iteration(s) — saving report.` : `Run ${result.status.toLowerCase()} — saving what was produced.` });
      await trace.flush();
      const updateRun = async (patch: Record<string, unknown>) => (await store.update(id, patch)).error;
      const artifacts = null;
      const updateError = await updateRun({
        status: done ? "COMPLETED" : "FAILED",
        error: done ? null : (result.error || "Iterative run did not complete"),
        updated_at: new Date().toISOString(),
        duration: (Date.now() - startedAt) / 1000,
        total_score: null,
        coverage: null,
        report,
        skill_outputs: [],
        artifacts,
      });
      if (updateError && /PGRST204|\bcolumn\b.*schema cache/i.test(String(updateError.message))) {
        if (!missingColumnsWarned) {
          missingColumnsWarned = true;
          console.warn("[iterative] analysis_runs missing new columns (artifacts/coverage); apply api/supabase/migrations/018_pipeline_artifacts.sql");
        }
        const retryError = await updateRun({ status: done ? "COMPLETED" : "FAILED", error: done ? null : (result.error || "Iterative run did not complete"), updated_at: new Date().toISOString(), duration: (Date.now() - startedAt) / 1000, total_score: null, report, skill_outputs: [] });
        if (retryError) throw new Error(retryError.message);
      } else if (updateError) throw new Error(updateError.message);
      return;
    } catch (e: any) {
      console.error("Skill run failed:", e);
      trace.push("log", "skill", { text: `Skill run failed: ${e?.message || "unknown error"}` });
      await trace.flush();
      await store.update(id, {
        status: "FAILED",
        error: e?.message || "Skill run failed",
        updated_at: new Date().toISOString(),
        duration: (Date.now() - startedAt) / 1000,
      });
    }
  })();
}
