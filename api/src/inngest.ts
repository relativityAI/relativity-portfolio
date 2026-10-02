import { Inngest } from "inngest";
import { getDb } from "./db.js";
import { loadAgent } from "./agentstore.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { VoyagerClient, toCountrySource, type PullStatus } from "./voyager.js";
import { fetchMetricsSnapshot, assessDataAdequacy } from "./quant.js";
import { synthesizeSkillReport, sanitizeReport, buildSourcesBlocks, type TraceCallback } from "./agent.js";
import { getAnalystToolCatalog } from "./tools.js";
import { buildMarketSnapshot } from "./marketdata.js";
import { ensureFreshData } from "./freshness.js";
import { resolveWebSearch, initialSteps, startStep, finishStep, toolEvidenceDigest, type RunRequest, type RunStep } from "./run.js";
import { keyPool } from "./keypool.js";
import { log } from "./logger.js";
import { TraceCollector, traceHub } from "./trace.js";
import { resolveSkillsForAgent } from "./skills/resolve.js";
import { runAllSkills } from "./skills/skillrun.js";
import { aggregateSkillOutputs, isScoreDisplayable, MIN_COVERAGE_FOR_SCORE } from "./skills/aggregate.js";
import { assembleSkillCharts, buildSkillScoreCharts, toolEvidenceForCharts } from "./skills/charts.js";
import { runQuantScreen } from "./skills/quantscreen.js";
import { buildSkillScoreTables } from "./skills/tables.js";

export const inngest = new Inngest({ id: "relativity-portfolio" });

export interface AnalysisRunEventData extends RunRequest {
  runId: string;
}

export const analysisRunFn = inngest.createFunction(
  {
    id: "analysis-run-pipeline",
    name: "Analysis Run Pipeline (skills)",
    triggers: [{ event: "analysis/run.requested" }],
    concurrency: [
      { limit: 5 },
      { key: "event.data.symbol + '-' + (event.data.source || 'NSE')", limit: 1 },
    ],
    retries: 2,
    // When every retry is exhausted, mark the run FAILED instead of leaving it
    // stuck in RUNNING until the stale-run sweeper fires (parity with the
    // local runner's error handling).
    onFailure: async ({ event, error }) => {
      // The failure event wraps the original event payload one level down.
      const original = (event.data as { event?: { data?: AnalysisRunEventData } } | undefined)?.event;
      const runId = original?.data?.runId;
      if (!runId) return;
      try {
        await getDb()
          .from("analysis_runs")
          .update({ status: "FAILED", error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() })
          .eq("id", runId);
      } catch (e) {
        log.error(`[inngest ${runId}]`, "failed to persist failure:", e);
      }
    },
  },
  async ({ event, step }) => {
    const req = event.data as AnalysisRunEventData;
    const runId = req.runId;
    const db = getDb();
    const runTag = `[inngest ${runId}]`;
    const started = Date.now();

    // Live trace: publish every event to SSE subscribers, persist throttled.
    traceHub.reset(runId);
    const collector = new TraceCollector(runId, async (events) => {
      await updateRunStatus({ trace: events });
    });
    const traceQual = (key: string, ev: Parameters<TraceCallback>[0]) => {
      // skillrun failure diagnostics arrive as log events (outside the
      // TraceCallback union) — persist them so a failed skill still
      // leaves its reasoning and raw error in the trace.
      if ((ev as any).type === "log") {
        collector.push("log", key, { text: (ev as any).text });
        return;
      }
      switch (ev.type) {
        case "thought":
          collector.push("thought", key, { text: ev.text });
          break;
        case "tool_call":
          collector.push("tool_call", key, { tool: ev.tool, args: ev.args });
          break;
        case "tool_result":
          collector.push("tool_result", key, { tool: ev.tool, result: ev.result, status: ev.status === "ERR" ? "ERR" : "OK", duration_ms: ev.duration_ms });
          break;
        case "decision":
          collector.push("decision", key, { score: ev.score, text: ev.text });
          break;
      }
    };

    // Steps tracking (parity with the local runner): the UI's progress UI reads
    // analysis.steps; without this the Inngest path left every step "pending".
    let steps: RunStep[] = initialSteps();
    const setStep = async (key: string, status: RunStep["status"], detail?: string) => {
      steps = status === "running" ? startStep(steps, key) : finishStep(steps, key, status, detail);
      await updateRunStatus({ steps });
    };

    const updateRunStatus = async (patch: Record<string, unknown>) => {
      await db.from("analysis_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", runId);
    };

    // Step 1: Resolve Agent Configuration (markdown-first, lazily migrated to v3)
    await setStep("agent", "running");
    const agent = await step.run("resolve-agent", async () => {
      const { config: agentConfig, issues } = await loadAgent(req.userId, req.agent_name);
      if (!agentConfig) {
        throw new Error(`Agent not found: ${req.agent_name}`);
      }
      if (issues.length) log.warn(runTag, "agent md warnings:", issues.map((i) => i.message).join("; "));
      const source = req.source || "NSE";
      // Stamp the true start clock on the PENDING→RUNNING edge (the UI's
      // elapsed timer anchors here, so reloads show total actual time).
      await updateRunStatus({ status: "RUNNING", source, started_at: new Date().toISOString() });
      return agentConfig;
    });
    await setStep("agent", "completed");

    const source = req.source || "NSE";
    const cs = toCountrySource(source);

    // Fetch user keys
    const { voyagerKey, llmKeys } = await step.run("fetch-keys", async () => {
      return fetchUserKeys(req.userId);
    });

    // Keyless runs proceed on web search (parity with the local runner).
    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);

    const modelId = req.model || keyPool.getDefaultModel(llmKeys);
    if (modelId !== req.model) {
      await updateRunStatus({ model: modelId });
    }

    // Step 2: Check Data Availability (skipped when keyless)
    await setStep("data", "running");
    const dataAvailability = await step.run("check-data-availability", async () => {
      if (!voyagerKey) return null;
      try {
        const status = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
        await updateRunStatus({ data_availability: status });
        return status;
      } catch (e: any) {
        log.warn(runTag, "data availability check failed:", e?.message);
        return { error: e?.message || String(e) };
      }
    });
    await setStep("data", voyagerKey ? "completed" : "skipped", voyagerKey ? undefined : "No data-provider key — web search only.");

    // Step 3: Ensure Fresh Data (skipped when keyless)
    await setStep("pull", "running");
    const pullResult = await step.run("ensure-fresh-data", async () => {
      if (!voyagerKey) return { pulled: false, reason: "No data-provider key — skipping the data pull step." };
      try {
        return await ensureFreshData(voyager, req.symbol, cs.country, cs.source, req.userId);
      } catch (e: any) {
        return { pulled: false, reason: e?.message || String(e) };
      }
    });
    await setStep("pull", pullResult.pulled ? "completed" : "skipped", pullResult.pulled ? `Data pulled fresh` : pullResult.reason || "Data already available");

    // Step 4: Skills fan-out (per-skill analysts + deterministic rule screens)
    await setStep("skills", "running");
    const skillsResult = await step.run("skills-fanout", async () => {
      const snap = voyagerKey
        ? await fetchMetricsSnapshot(voyager, req.symbol, cs.country, cs.source)
        : { outage: true, outage_error: "no data-provider key configured", metrics: {}, price_data: "unknown" };
      const metrics = snap.outage ? {} : snap.metrics;
      const price_data = snap.outage ? "unknown" : snap.price_data;
      // Freeze the market context (price, market cap, trailing 6-month chart)
      // for this run date. Best-effort: null on failure, UI degrades honestly.
      const marketSnapshot = await buildMarketSnapshot(req.symbol, snap.outage ? null : metrics);
      const adequacy = assessDataAdequacy(dataAvailability as PullStatus | null, metrics);
      const web = resolveWebSearch(req.web_search, adequacy, llmKeys.tavily);

      await updateRunStatus({
        data_adequacy: adequacy,
        web_search_effective: web.effective,
        web_search_note: web.note || null,
        price_data: price_data || null,
      });

      const persona = agent.persona?.philosophy || "";
      const resolved = await resolveSkillsForAgent(req.userId, agent);
      if (resolved.length === 0) {
        throw new Error("Agent has no skills attached");
      }

      const skillCtx = {
        toolCtx: {
          voyager,
          tavilyKey: llmKeys.tavily,
          symbol: req.symbol,
          country: cs.country,
          source: cs.source,
          shareName: req.share_name || req.symbol,
          webSources: req.web_sources || [],
        },
        modelId,
        llmKeys,
        persona,
        documents: req.documents || [],
        webSearch: web.effective !== "off",
        toolCatalog: getAnalystToolCatalog(),
        // skillrun envelopes its events ({ parameter, section, type, data }) —
        // unwrap the real event and key it by skill name; passing the
        // envelope itself leaves every field traceQual reads (text/tool/
        // args) undefined, so the reasoning tab filled with empty rows.
        onTrace: (raw: any) =>
          traceQual(String(raw?.parameter ?? "skills"), raw?.data ?? raw),
        // Live per-skill progress (parity with the local runner).
        onSkillStart: ({ name }: { id: string; name: string }) => {
          collector.push("log", "skills", { text: `▸ ${name} — running` });
        },
        onSkillEnd: (
          { name }: { id: string; name: string },
          out: { error?: string; verdicts?: unknown[]; findings?: unknown[] },
          durationMs: number,
        ) => {
          const secs = (durationMs / 1000).toFixed(1);
          if (out.error) {
            collector.push("log", "skills", { text: `✗ ${name} — failed (${secs}s): ${String(out.error).slice(0, 140)}` });
          } else {
            const n = (out.verdicts?.length ?? 0) + (out.findings?.length ?? 0);
            collector.push("log", "skills", { text: `✓ ${name} — done (${secs}s, ${n} item${n === 1 ? "" : "s"})` });
          }
          skillsDone += 1;
          // Update the running step's detail in place (no finish semantics).
          steps = steps.map((s) => (s.key === "skills" ? { ...s, detail: `${skillsDone}/${resolved.length} skills finished — ${name}` } : s));
          void updateRunStatus({ steps }).catch(() => {});
        },
      };

      let skillsDone = 0;

      const weights = Object.fromEntries(resolved.map((r) => [r.skill.id, r.weight]));
      let outputs = await runAllSkills(skillCtx, resolved);

      // Deterministic rule-screen skills are scored in code, never by the LLM.
      outputs = await Promise.all(
        outputs.map(async (out) => {
          const entry = resolved.find((r) => r.skill.id === out.skill_id);
          if (entry?.skill.category !== "custom" || !/quant-screen|quant screen/i.test(entry.skill.name)) return out;
          return runQuantScreen(entry.skill, out, snap.outage ? null : snap.metrics, price_data);
        }),
      );

      return { outputs, weights, resolved, adequacy, web, price_data, marketSnapshot, metricsOutage: snap.outage ? snap.outage_error || "metrics provider outage" : null };
    });
    const { outputs, weights, resolved, price_data, marketSnapshot } = skillsResult;
    const skillErrors = outputs.filter((o) => o.error).map((o) => `${o.skill_name}: ${o.error}`);
    await setStep("skills", skillErrors.length === outputs.length ? "failed" : "completed", skillErrors.length ? `${skillErrors.length} skill(s) reported problems` : `${outputs.length} skill(s) completed`);

    // Step 5: Aggregate + finalize
    await setStep("scorecard", "running");
    await setStep("finalize", "running");
    const finalized = await step.run("aggregate-finalize", async () => {
      const agg = aggregateSkillOutputs(outputs, weights);
      // Attach computed per-skill scores onto the stored outputs (parity with
      // the local runner) — the UI reads score_0_100/coverage per skill card.
      for (const s of agg.per_skill) {
        const out = outputs.find((o) => o.skill_id === s.skill_id);
        if (out) {
          out.score_0_100 = s.score_0_100 ?? undefined;
          out.coverage = s.coverage;
        }
      }
      // Honest headline (parity with the local runner): a number resting on
      // mostly-unassessed anchors is suppressed, not displayed.
      const total = isScoreDisplayable(agg) ? agg.total_score : null;
      const totalCoverage = Math.round(agg.coverage * 1000) / 10;
      const errorSummary =
        agg.scored_count === 0
          ? `All skills failed to produce a score — ${
              skillErrors.length
                ? skillErrors.slice(0, 3).join("; ")
                : agg.failure_reason || "every anchor came back without usable data"
            }`
          : null;
      const finalStatus = agg.scored_count === 0 ? "FAILED" : "COMPLETED";

      // Persist the deterministic results BEFORE any LLM-dependent synthesis:
      // a synthesis throw must not void the computed score (parity with the
      // local runner's early-results patch).
      await updateRunStatus({
        status: finalStatus,
        error: errorSummary,
        skill_outputs: outputs,
        pipeline_version: "v3-skills",
        total_score: total,
        fit_low: agg.fit_low,
        fit_high: agg.fit_high,
        coverage: totalCoverage,
      });

      const scoreTables = buildSkillScoreTables(outputs, agg, agent.name);
      const scoredOutputs = outputs.filter((o) => !o.error);

      // Parity with the local runner: synthesize an executive summary
      // for EVERY run that produced usable skill output — including runs
      // whose headline score was suppressed for thin coverage
      // (totalScore: null tells the model not to invent a headline
      // number). Only a run where every skill failed outright skips it.
      let report = null;
      if (scoredOutputs.length > 0) {
        report = await synthesizeSkillReport({
          modelId,
          llmKeys,
          agentPersona: agent.persona?.philosophy || "",
          agentDisplayName: agent.name || "Analysis Agent",
          outputs: scoredOutputs,
          totalScore: total,
          fitLow: agg.fit_low,
          fitHigh: agg.fit_high,
          coverage: totalCoverage,
          asOf: new Date().toISOString().slice(0, 10),
          degraded:
            skillErrors.length > 0
              ? `${skillErrors.length} of ${outputs.length} skills reported problems: ${skillErrors.slice(0, 2).join("; ")}`
              : agg.status === "degraded"
                ? "some skills could not assess every anchor (INSUFFICIENT data) — coverage is below 100%"
                : total == null
                  ? "the headline total score was suppressed (coverage below the reliability floor) — do not invent a headline number"
                  : undefined,
          toolEvidence: toolEvidenceDigest(
            Object.fromEntries(outputs.map((o) => [o.skill_name, (o.tools_used || []).map((t) => ({ tool: t, status: o.error ? "ERR" : "OK" }))])),
          ),
        });

        // Resilience visibility: synthesis degrades to the deterministic
        // fallback when the LLM fails after retries — surface it in the
        // reasoning trace instead of failing silently.
        if (report.source === "fallback") {
          collector.push("log", "finalize", {
            text: "Executive summary degraded to the deterministic fallback — LLM synthesis failed after retries",
          });
        }

        if (scoreTables.length) {
          report = { ...report, blocks: [...report.blocks, ...scoreTables] };
        }
        const chartEvidence = toolEvidenceForCharts(
          traceToolCallMap(
            collector.snapshot().filter((ev) => ev.type === "tool_result" && ev.status !== "ERR"),
          ),
        );
        const chartBlocks = await assembleSkillCharts(outputs, resolved, req.symbol, chartEvidence, voyager, cs.source);
        if (chartBlocks.length) {
          report = { ...report, blocks: [...report.blocks, ...chartBlocks] };
        }

        // Score visualizations: the run's computed results, plotted from
        // the aggregate (code-assembled, exempt from the numeric gate by
        // prefix). Rendered even when the headline total is suppressed:
        // per-skill scores still exist and are worth plotting.
        const scoreChartBlocks = buildSkillScoreCharts(outputs, agg.per_skill, total);
        if (scoreChartBlocks.length) {
          report = { ...report, blocks: [...report.blocks, ...scoreChartBlocks] };
        }

        // Numeric-integrity allowlist: totals + every number analysts observed.
        const known = new Set<number>();
        if (total != null) known.add(Math.round(total * 10) / 10);
        const visit = (v: unknown): void => {
          if (typeof v === "number" && Number.isFinite(v)) known.add(Math.round(v * 10) / 10);
          else if (typeof v === "string") {
            for (const m of v.matchAll(/-?\d+(?:\.\d+)?/g)) {
              const n = parseFloat(m[0]);
              if (Number.isFinite(n)) known.add(Math.round(n * 10) / 10);
            }
          } else if (Array.isArray(v)) v.forEach(visit);
          else if (v && typeof v === "object") Object.values(v).forEach(visit);
        };
        for (const o of outputs) {
          (o.findings || []).forEach(visit);
          (o.verdicts || []).forEach((v) => visit(v.evidence));
        }
        // Sources & raw data: deterministic provenance section appended to
        // every report, before the sanitizer so the allowlist (built from the
        // same raw observations) accepts its figures.
        const sourceBlocks = buildSourcesBlocks(outputs);
        report = { ...report, blocks: [...report.blocks, ...sourceBlocks] };
        const { report: cleanReport, dropped } = sanitizeReport(report, known);
        if (dropped.length) log.warn(runTag, `report sanitized — dropped ${dropped.length} block(s)`);
        report = cleanReport;
        // The hero number is OUR stored total, not the model's: clamp
        // heroPct to the deterministic aggregate so the headline can never
        // drift from the persisted total_score (no clamp when suppressed).
        report = { ...report, heroPct: total != null ? Math.round(total * 10) / 10 : report.heroPct };
      }

      await updateRunStatus({
        status: finalStatus,
        error: errorSummary,
        duration: (Date.now() - started) / 1000,
        report,
        market_snapshot: marketSnapshot ?? null,
      });
      collector.push("log", "finalize", {
        text: `${finalStatus}${
          total != null
            ? ` — total score ${total} (coverage ${totalCoverage}%, band ${agg.fit_low}\u2013${agg.fit_high})`
            : agg.scored_count > 0
              ? ` — score suppressed (coverage ${totalCoverage}% is below the ${Math.round(MIN_COVERAGE_FOR_SCORE * 100)}% reliability floor) — read the skill reports`
              : " — nothing scored"
        }`,
      });
      await collector.flush();

      return { total, status: finalStatus, errorSummary };
    });
    await setStep("scorecard", "completed");
    await setStep("finalize", finalized.status === "COMPLETED" ? "completed" : "failed", finalized.errorSummary ?? undefined);
    void price_data;
  }
);

/**
 * Group trace tool_result events into the per-skill map shape the chart
 * grounder reads (parity with the local runner's traceToolCallMap).
 */
function traceToolCallMap(events: { key: string; tool?: string; result?: unknown }[]): Record<string, unknown[]> {
  const map: Record<string, unknown[]> = {};
  for (const ev of events) {
    if (!ev.tool) continue;
    (map[ev.key] ||= []).push({ tool_name: ev.tool, status: "OK", result: ev.result });
  }
  return map;
}

// ---- KB ingestion (retained for document caching; not part of scoring) ----
export const kbIngestFn = inngest.createFunction(
  {
    id: "kb-ingest",
    name: "KB Ingest (chunks + events)",
    triggers: [{ event: "kb/ingest.requested" }],
    concurrency: [{ key: "event.data.symbol + '-' + (event.data.source || 'NSE')", limit: 1 }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { symbol, source, documents, announcements } = event.data as {
      symbol: string;
      source: string;
      documents?: { title?: string; text: string; kind?: string }[];
      announcements?: { heading: string; date?: string; text?: string }[];
    };

    await step.run("ingest-docs", async () => {
      const out = { chunks: 0, events: 0 };
      for (const doc of documents || []) {
        const text = doc.text || doc.title || "";
        if (!text) continue;
        const { persistChunks } = await import("./kb/store.js");
        const { docHash } = await import("./kb/chunks.js");
        const res = await persistChunks({
          symbol,
          source,
          doc_hash: docHash(text, doc.kind || "filing", doc.title || null),
          kind: doc.kind || "filing",
          text,
          as_of: null,
          source_ref: doc.title || null,
        });
        out.chunks += res.inserted;
      }
      return out;
    });

    await step.run("ingest-events", async () => {
      let events = 0;
      for (const a of announcements || []) {
        const { persistChunks, ingestEvent } = await import("./kb/store.js");
        void persistChunks;
        const res = await ingestEvent({
          symbol,
          source,
          text: a.text || a.heading,
          as_of: a.date || null,
          source_ref: a.heading || null,
        });
        if (!res.skipped) events++;
      }
      return { events };
    });

    return { symbol, source };
  }
);
// ---- v2 KB ingestion (plan §6.4) ----
// Triggered after pulls and lazily at run time for missing docs. Idempotent by
// doc_hash; safe to fan out for the same symbol.
