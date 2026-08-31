import { Inngest } from "inngest";
import { getDb } from "./db.js";
import { fetchUserKeys } from "./provision.js";
import { config } from "./config.js";
import { getModelIds } from "./models.js";
import { VoyagerClient, toCountrySource, type PullStatus } from "./voyager.js";
import { runQuantitative, fetchMetricsSnapshot, assessDataAdequacy } from "./quant.js";
import { runQualitative, parseFinalScoreResult, investorProfileLine, type QualParamEntry } from "./agent.js";
import { ensureFreshData } from "./freshness.js";
import { resolveWebSearch, DEFAULT_MODEL, type RunRequest } from "./run.js";
import { aggregateWeightedScores } from "./scoring.js";
import { log } from "./logger.js";

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
  },
  async ({ event, step }) => {
    const req = event.data as AnalysisRunEventData;
    const runId = req.runId;
    const db = getDb();

    const updateRunStatus = async (patch: Record<string, unknown>) => {
      await db.from("analysis_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", runId);
    };

    // Step 1: Resolve Agent Configuration
    const agent = await step.run("resolve-agent", async () => {
      const { data, error } = await db
        .from("agents")
        .select("*")
        .eq("user_id", req.userId)
        .or(`name.eq.${req.agent_name},id.eq.${req.agent_name}`)
        .single();

      if (error || !data) {
        throw new Error(`Agent not found: ${req.agent_name}`);
      }
      const source = req.source || data.source || "NSE";
      await updateRunStatus({ status: "RUNNING", source });
      return data;
    });

    const source = req.source || agent.source || "NSE";
    const cs = toCountrySource(source);

    // Fetch user keys
    const { voyagerKey, llmKeys } = await step.run("fetch-keys", async () => {
      return fetchUserKeys(req.userId);
    });

    if (!voyagerKey) {
      await updateRunStatus({
        status: "FAILED",
        error: "No Voyager API key configured.",
      });
      throw new Error("No Voyager API key configured.");
    }

    const voyager = new VoyagerClient(config.voyagerUrl, voyagerKey, config.voyagerRpm);

    // Step 2: Check Data Availability
    const dataAvailability = await step.run("check-data-availability", async () => {
      try {
        const status = await voyager.getPullStatus(req.symbol, cs.country, cs.source);
        await updateRunStatus({ data_availability: status });
        return status;
      } catch (e: any) {
        log.warn(`[inngest ${runId}]`, "data availability check failed:", e?.message);
        return { error: e?.message || String(e) };
      }
    });

    // Step 3: Ensure Fresh Data
    const pullResult = await step.run("ensure-fresh-data", async () => {
      try {
        return await ensureFreshData(voyager, req.symbol, cs.country, cs.source, req.userId);
      } catch (e: any) {
        return { pulled: false, reason: e?.message || String(e) };
      }
    });

    // Step 4: Quantitative Scoring & Data Adequacy
    const quantResult = await step.run("quantitative-scoring", async () => {
      const { metrics, price_data } = await fetchMetricsSnapshot(
        voyager,
        req.symbol,
        cs.country,
        cs.source
      );
      const adequacy = assessDataAdequacy(dataAvailability as PullStatus | null, metrics);
      const quant = runQuantitative(agent, metrics, price_data);
      const web = resolveWebSearch(req.web_search, adequacy, llmKeys.tavily);

      await updateRunStatus({
        data_adequacy: adequacy,
        web_search_effective: web.effective,
        web_search_note: web.note || null,
        quantitative_analysis: quant.quantitative_analysis,
        quantitative_score: quant.quantitative_score,
        price_data: price_data || null,
      });

      return { quant, adequacy, web, price_data };
    });

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
    const modelId = req.model || getModelIds()[0] || DEFAULT_MODEL;
    const investorContext = investorProfileLine(agent?.configuration);

    const toolCtx = {
      voyager,
      tavilyKey: llmKeys.tavily,
      symbol: req.symbol,
      country: cs.country,
      source: cs.source,
      shareName: req.share_name || req.symbol,
      webSources: req.web_sources || [],
    };

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
          investorContext
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
            investorContext
          );
        }

        return res;
      });

      qualitativeAnalysis[label] = {
        score: paramRes.score,
        weightage: typeof p.weightage === "number" ? p.weightage : 5,
        analysis: paramRes.analysis,
        error: paramRes.error,
        section: p.section,
        tokens: paramRes.tokens,
      };
      qualitativeToolCalls[label] = paramRes.toolCalls;
    }

    // Step 6: Finalize Report and Score
    await step.run("finalize-report", async () => {
      const { score: qualScore } = aggregateWeightedScores(Object.values(qualitativeAnalysis), {
        includeMissingAsZero: false,
      });

      const quantScore = quantResult.quant.quantitative_score;
      let total = 0;
      if (quantScore > 0 && qualScore > 0) total = (quantScore + qualScore) / 2;
      else if (quantScore > 0) total = quantScore;
      else if (qualScore > 0) total = qualScore;
      total = Math.round(total * 100) / 100;

      const qualErrors = Object.entries(qualitativeAnalysis)
        .filter(([, e]) => !!e.error)
        .map(([lbl, e]) => `${lbl}: ${e.error}`);

      const qualTotal = Object.keys(qualitativeAnalysis).length;
      const allQualFailed = qualTotal > 0 && qualErrors.length === qualTotal;
      const qualErrorSummary = allQualFailed
        ? `Qualitative scoring failed — ${qualErrors.join("; ")}`
        : null;

      const finalStatus = qualErrorSummary ? "FAILED" : "COMPLETED";

      await updateRunStatus({
        status: finalStatus,
        error: qualErrorSummary,
        qualitative_analysis: qualitativeAnalysis,
        qualitative_tool_calls: qualitativeToolCalls,
        qualitative_score: qualScore,
        total_score: total,
      });

      return { total, status: finalStatus };
    });
  }
);
