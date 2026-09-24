import { Inngest } from "inngest";
import { getDb } from "./db.js";
import { loadAgent } from "./agentstore.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { VoyagerClient, toCountrySource, type PullStatus } from "./voyager.js";
import { runQuantitative, runQuantitativeLLM, applyQuantOverlay, fetchMetricsSnapshot, assessDataAdequacy, unscoredQuantResult } from "./quant.js";
import {
  runQualitative,
  investorProfileLine,
  parseQualStructure,
  normalizeQuantScale,
  buildScoreTables,
  scoreTablesToBlocks,
  synthesizeReport,
  sanitizeReport,
  planAnalyze,
  type QualParamEntry,
  type TraceCallback,
} from "./agent.js";
import { getAnalystToolCatalog } from "./tools.js";
import { ensureFreshData } from "./freshness.js";
import { resolveWebSearch, initialSteps, startStep, finishStep, toolEvidenceDigest, collectKnownValues, type RunRequest, type RunStep } from "./run.js";
import { keyPool } from "./keypool.js";
import { aggregateWeightedScores, combinePillars } from "./scoring.js";
import { log } from "./logger.js";
import { TraceCollector, traceHub } from "./trace.js";
import { persistChunks, ingestEvent } from "./kb/store.js";
import { docHash } from "./kb/chunks.js";

export const inngest = new Inngest({ id: "relativity-portfolio" });

export interface AnalysisRunEventData extends RunRequest {
  runId: string;
}

export const analysisRunFn = inngest.createFunction(
  {
    id: "analysis-run-pipeline",
    name: "Analysis Run Pipeline",
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

    // Step 1: Resolve Agent Configuration (markdown-first)
    await setStep("agent", "running");
    const agent = await step.run("resolve-agent", async () => {
      const { config: agentConfig, issues } = await loadAgent(req.userId, req.agent_name);
      if (!agentConfig) {
        throw new Error(`Agent not found: ${req.agent_name}`);
      }
      if (issues.length) log.warn(runTag, "agent md warnings:", issues.map((i) => i.message).join("; "));
      const source = req.source || "NSE";
      await updateRunStatus({ status: "RUNNING", source });
      return agentConfig;
    });
    await setStep("agent", "completed");

    // The market (NSE/SEC) is a property of the run, never the agent — agents
    // are independent stock evaluators that work on any listed company.
    const source = req.source || "NSE";
    const cs = toCountrySource(source);

    // Fetch user keys
    const { voyagerKey, llmKeys } = await step.run("fetch-keys", async () => {
      return fetchUserKeys(req.userId);
    });

    if (!voyagerKey) {
      await setStep("agent", "failed", "No Voyager API key configured.");
      await updateRunStatus({
        status: "FAILED",
        error: "No Voyager API key configured.",
      });
      throw new Error("No Voyager API key configured.");
    }

    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);

    // Resolve the model early so quantitative LLM judgement can reuse it.
    const modelId = req.model || keyPool.getDefaultModel(llmKeys);
    if (modelId !== req.model) {
      await updateRunStatus({ model: modelId });
    }

    // Step 2: Check Data Availability
    await setStep("data", "running");
    const dataAvailability = await step.run("check-data-availability", async () => {
      try {
        const status = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
        await updateRunStatus({ data_availability: status });
        return status;
      } catch (e: any) {
        log.warn(runTag, "data availability check failed:", e?.message);
        return { error: e?.message || String(e) };
      }
    });
    await setStep("data", "completed");

    // Step 3: Ensure Fresh Data
    await setStep("pull", "running");
    const pullResult = await step.run("ensure-fresh-data", async () => {
      try {
        return await ensureFreshData(voyager, req.symbol, cs.country, cs.source, req.userId);
      } catch (e: any) {
        return { pulled: false, reason: e?.message || String(e) };
      }
    });
    await setStep("pull", pullResult.pulled ? "completed" : "skipped", pullResult.pulled ? `Data pulled fresh` : pullResult.reason || "Data already available");

    // Step 4: Quantitative Scoring & Data Adequacy
    await setStep("quantitative", "running");
    const quantResult = await step.run("quantitative-scoring", async () => {
      const snap = await fetchMetricsSnapshot(
        voyager,
        req.symbol,
        cs.country,
        cs.source
      );
      // Outage ≠ no-data (plan 0.2/A3, revised parity with the local runner):
      // a provider outage DEGRADES the run instead of killing it — the quant
      // pillar is marked fully unscored (null scores, explicit reason), the
      // total becomes a qual-only estimate with a widened band, and the gap is
      // surfaced in the report rather than presented as an error page.
      let quant = unscoredQuantResult(agent, snap.price_data, "error");
      const metricsOutage: string | null = snap.outage
        ? snap.outage_error || "metrics provider outage"
        : null;
      const adequacy = assessDataAdequacy(dataAvailability as PullStatus | null, snap.metrics);
      if (!snap.outage) {
        quant = runQuantitative(agent, snap.metrics, snap.price_data);
        const quantOverlay = await runQuantitativeLLM({ modelId, llmKeys, entries: quant.quantitative_analysis });
        applyQuantOverlay(quant, quantOverlay);
        if (Object.keys(quantOverlay).length) log.info(runTag, `quant LLM-judged ${Object.keys(quantOverlay).length} criteria`);
      } else {
        log.warn(runTag, `metrics outage — degrading to qual-only scoring: ${metricsOutage}`);
      }
      const web = resolveWebSearch(req.web_search, adequacy, llmKeys.tavily);

      await updateRunStatus({
        data_adequacy: adequacy,
        web_search_effective: web.effective,
        web_search_note: web.note || null,
        quantitative_analysis: quant.quantitative_analysis,
        quantitative_score: quant.quantitative_score,
        fit_low: quant.fit_low,
        fit_high: quant.fit_high,
        coverage: quant.coverage,
        price_data: snap.price_data || null,
      });

      return { quant, adequacy, web, price_data: snap.price_data, metricsOutage };
    });
    await setStep("quantitative", quantResult.metricsOutage ? "failed" : "completed", quantResult.metricsOutage ? `Metrics provider outage — quantitative criteria unscored: ${quantResult.metricsOutage.slice(0, 160)}` : undefined);

    // Step 5: Qualitative Scoring (Parameter by Parameter Steps)
    const qualParams = [
      ...(agent?.asset_evaluation?.qualitative || []).map((p: any) => ({
        ...p,
        section: "asset_evaluation",
      })),
      ...(agent?.macro_evaluation?.qualitative || []).map((p: any) => ({
        ...p,
        section: "macro_evaluation",
      })),
    ];

    const qualitativeAnalysis: Record<string, QualParamEntry> = {};
    const qualitativeToolCalls: Record<string, Record<string, unknown>[]> = {};
    const investorContext = investorProfileLine(agent?.configuration, agent?.persona);

    const toolCtx = {
      voyager,
      tavilyKey: llmKeys.tavily,
      symbol: req.symbol,
      country: cs.country,
      source: cs.source,
      shareName: req.share_name || req.symbol,
      webSources: req.web_sources || [],
    };

    // Plan step (parity with the local runner): one cheap pre-scoring turn.
    const plan = await step.run("plan-analysis", async () => {
      if (qualParams.length === 0) return null;
      return planAnalyze({
        modelId,
        llmKeys,
        persona: agent.persona?.philosophy_and_mindset || "",
        agentDisplayName: agent.name,
        quant: Object.entries(quantResult.quant.quantitative_analysis).map(([key, e]: [string, any]) => ({
          key,
          metric_name: e.metric_name || key,
          value: e.value,
          threshold: e.threshold,
          operator: e.operator,
          score: e.score ?? 0,
        })),
        qual: qualParams.map((p: any) => ({ parameter: p.parameter, content: p.content, section: p.section })),
        adequacy: quantResult.adequacy,
        webSearch: quantResult.web.effective !== "off",
        tools: getAnalystToolCatalog(),
        subject: `${req.share_name || req.symbol} (${req.symbol}) on ${source}`,
      });
    });

    await setStep("qualitative", "running");
    for (const p of qualParams) {
      const label = p.parameter || "Qualitative Parameter";
      const stepKey = `qual-score-${p.section}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "_");

      const paramRes = await step.run(stepKey, async () => {
        let res = await runQualitative(
          modelId,
          llmKeys,
          toolCtx,
          { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
          req.documents || [],
          quantResult.web.effective !== "off",
          quantResult.adequacy,
          investorContext,
          (ev) => traceQual(label, ev),
          plan ?? undefined
        );

        if (res.error && res.retryable) {
          res = await runQualitative(
            modelId,
            llmKeys,
            toolCtx,
            { parameter: label, content: p.content, weightage: p.weightage, section: p.section },
            req.documents || [],
            quantResult.web.effective !== "off",
            quantResult.adequacy,
            investorContext,
            (ev) => traceQual(label, ev),
            plan ?? undefined
          );
        }

        return res;
      });

      // Zero-tool completions are UNSCORED, not 0 and not a memory-based guess
      // (plan A11) — same rule as the local runner.
      const zeroTool = (paramRes.toolCalls || []).length === 0;
      qualitativeAnalysis[label] = {
        score: zeroTool ? null : paramRes.score,
        weightage: typeof p.weightage === "number" ? p.weightage : 5,
        analysis: paramRes.analysis,
        error: paramRes.error ?? (zeroTool ? "No tool evidence gathered — parameter unscored" : undefined),
        unscored_reason: zeroTool ? "insufficient_data" : undefined,
        section: p.section,
        tokens: paramRes.tokens,
      };
      qualitativeToolCalls[label] = paramRes.toolCalls;
    }
    await setStep("qualitative", "completed");

    // Step 6: Finalize Report and Score
    await setStep("scorecard", "running");
    await setStep("finalize", "running");
    const finalized = await step.run("finalize-report", async () => {
      // Honest aggregation (plan 0.3): unknown ≠ 0; zero-tool params unscored.
      const qualEntries = Object.values(qualitativeAnalysis).map((e) => ({
        score: e.score ?? null,
        weightage: e.weightage,
        unscored_reason: e.error ? ("error" as const) : undefined,
      }));
      const qualAgg = aggregateWeightedScores(qualEntries);
      const qualScore = qualAgg.score;

      const quantScore = quantResult.quant.quantitative_score;
      const totalAgg = combinePillars([
        {
          key: "quantitative",
          result: {
            score: quantScore,
            fit_low: quantResult.quant.fit_low,
            fit_high: quantResult.quant.fit_high,
            coverage: quantResult.quant.coverage,
            totalWeight: Object.keys(quantResult.quant.quantitative_analysis).length,
            allWeight: Object.keys(quantResult.quant.quantitative_analysis).length,
            weightedSum: 0,
          },
          weight: 1,
        },
        {
          key: "qualitative",
          result: {
            score: qualScore,
            fit_low: qualAgg.fit_low,
            fit_high: qualAgg.fit_high,
            coverage: qualAgg.coverage,
            totalWeight: Object.keys(qualitativeAnalysis).length,
            allWeight: Object.keys(qualitativeAnalysis).length,
            weightedSum: 0,
          },
          weight: 1,
        },
      ]);
      const total = totalAgg.score;

      const qualErrors = Object.entries(qualitativeAnalysis)
        .filter(([, e]) => !!e.error)
        .map(([lbl, e]) => `${lbl}: ${e.error}`);

      const qualTotal = Object.keys(qualitativeAnalysis).length;
      const allQualFailed = qualTotal > 0 && qualErrors.length === qualTotal;
      const nothingScored = quantScore == null && qualScore == null;
      const qualErrorSummary = allQualFailed
        ? `Qualitative scoring failed — ${qualErrors.join("; ")}`
        : nothingScored && qualTotal === 0 && Object.keys(quantResult.quant.quantitative_analysis).length === 0
          ? "No scoring criteria were configured for this agent."
          : null;
      const finalStatus = qualErrorSummary ? "FAILED" : "COMPLETED";

      // Parsed per-parameter structure (checklist verdicts + code-computed
      // scores) — parity with the local runner (plan A4/A10).
      const parsedQual = parseQualStructure(qualitativeAnalysis);

      // ---- scorecard: deterministic tables rendered by CODE (plan 0.2/D2) ----
      const scoreTables = buildScoreTables({
        quantAnalysis: normalizeQuantScale(quantResult.quant.quantitative_analysis),
        qualAnalysis: parsedQual,
        quantScore,
        qualScore,
        totalScore: total,
        coverage: totalAgg.coverage,
      });
      log.info(runTag, `scorecard: ${scoreTables.length} code-rendered table(s)`);

      // ---- report synthesis (parity with the local runner) ----
      let report = null;
      if (total != null || quantScore != null || qualScore != null) {
        report = await synthesizeReport({
          modelId,
          llmKeys,
          agentPersona: agent.persona?.philosophy_and_mindset || "",
          agentDisplayName: agent.name || "Analysis Agent",
          quantAnalysis: normalizeQuantScale(quantResult.quant.quantitative_analysis),
          qualAnalysis: parsedQual,
          totalScore: total ?? 0,
          quantScore,
          qualScore,
          fitLow: totalAgg.fit_low,
          fitHigh: totalAgg.fit_high,
          coverage: totalAgg.coverage,
          asOf: new Date().toISOString().slice(0, 10),
          partial: !!qualErrorSummary,
          degraded: quantResult.metricsOutage
            ? `the metrics provider was unreachable, so all ${Object.keys(quantResult.quant.quantitative_analysis).length} quantitative criteria are unscored`
            : undefined,
          plan: plan ?? undefined,
          toolEvidence: toolEvidenceDigest(qualitativeToolCalls),
        });

        if (scoreTables.length) {
          const scoreBlocks = [
            { type: "heading", level: 2, text: "Score Summary" } as const,
            ...scoreTablesToBlocks(scoreTables),
          ];
          report = { ...report, blocks: [...report.blocks, ...scoreBlocks] };
        }

        // Numeric-integrity hard gate (spec Section 3): drop ungrounded blocks.
        const known = collectKnownValues(
          normalizeQuantScale(quantResult.quant.quantitative_analysis),
          parsedQual,
          total ?? 0,
          quantScore ?? 0,
          qualScore ?? 0,
          qualitativeToolCalls,
        );
        const { report: cleanReport, dropped } = sanitizeReport(report, known);
        if (dropped.length) {
          log.warn(runTag, `report sanitized — dropped ${dropped.length} block(s): ${dropped.slice(0, 5).join("; ")}`);
        }
        report = cleanReport;
        // Hero number is OUR stored total, never the model's (plan 0.2/D2).
        report = { ...report, heroPct: total != null ? Math.round(total * 10) / 10 : report.heroPct };
        log.info(runTag, `report ready (source=${report.source})`);
      }

      await updateRunStatus({
        status: finalStatus,
        error: qualErrorSummary,
        duration: (Date.now() - started) / 1000,
        qualitative_analysis: parsedQual,
        qualitative_tool_calls: qualitativeToolCalls,
        qualitative_score: qualScore,
        total_score: total,
        fit_low: totalAgg.fit_low,
        fit_high: totalAgg.fit_high,
        coverage: totalAgg.coverage,
        report,
      });
      collector.push("log", "finalize", { text: `${finalStatus}${total != null ? ` — total score ${total} (coverage ${totalAgg.coverage}%, band ${totalAgg.fit_low}\u2013${totalAgg.fit_high})` : " — nothing scored"}` });
      await collector.flush();

      return { total, status: finalStatus, qualErrorSummary };
    });
    await setStep("scorecard", "completed", `${finalized.status === "COMPLETED" ? "report synthesized" : "skipped"}`);
    await setStep("finalize", finalized.status === "COMPLETED" ? "completed" : "failed", finalized.qualErrorSummary ?? undefined);
  }
);

// ---- v2 KB ingestion (plan §6.4) ----
// Triggered after pulls and lazily at run time for missing docs. Idempotent by
// doc_hash; safe to fan out for the same symbol.
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

    // Deterministic doc/event hashes are stable across runs — dedupe at insert.
    await step.run("ingest-docs", async () => {
      const out = { chunks: 0, events: 0 };
      for (const doc of documents || []) {
        const text = doc.text || doc.title || "";
        if (!text) continue;
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
