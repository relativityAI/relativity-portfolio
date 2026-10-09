import { generateText, generateObject } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible as _createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { sanitizeSSEFetch } from "./sse.js";

// All OpenAI-compatible gateways go through one fetch wrapper — see sse.ts.
const sanitizeFetch = sanitizeSSEFetch();
const createOpenAICompatible = (o: Parameters<typeof _createOpenAICompatible>[0]) =>
  _createOpenAICompatible({ fetch: sanitizeFetch, ...o });
import { config } from "./config.js";
import { buildTools, getToolCatalog } from "./tools.js";
import { log } from "./logger.js";
import { runAgentTurn, retryLlmCall } from "./harness.js";
import { keyPool } from "./keypool.js";
import { buildDraftParametersPrompt, SKILL_REPORT_SYNTHESIS_SYSTEM_PROMPT } from "./prompts.js";

export interface LlmKeys {
  openai?: string;
  gemini?: string;
  anthropic?: string;
  cerebras?: string;
  groq?: string;
  openrouter?: string;
  mistral?: string;
  nvidia?: string;
  cohere?: string;
  zai?: string;
  tavily?: string;
}

function providerFor(modelId: string): string {
  return modelId.split("/")[0];
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  groq: "Groq",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  nvidia: "NVIDIA NIM",
  cohere: "Cohere",
  zai: "Z.AI",
  ollama: "Ollama",
};

/**
 * Every provider except local Ollama requires an API key. buildModel must
 * fail LOUDLY when none is configured — otherwise the provider call goes out
 * with no Authorization header, the provider answers 401, and the harness
 * surfaces only the generic "No output generated" while the run burns its
 * full time budget retrying a request that can never succeed.
 */
export function assertProviderKeyAvailable(provider: string, key: string | undefined): void {
  if (provider === "ollama") return;
  if (!key || !String(key).trim()) {
    throw new Error(
      `No API key configured for "${PROVIDER_LABELS[provider] || provider}" — add one in Settings or pick a model from a provider that has a key.`,
    );
  }
}

function modelNameFor(modelId: string): string {
  return modelId.slice(modelId.indexOf("/") + 1);
}

// Legacy single-key env fallbacks (superseded by the key pool, kept safe).
const LEGACY_ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  cerebras: process.env.CEREBRAS_API_KEY,
  groq: process.env.GROQ_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
  nvidia: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
  cohere: process.env.COHERE_API_KEY || process.env.COHERE_API_TOKEN,
  zai: process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY,
};

export function buildModel(modelId: string, keys: LlmKeys, apiKey?: string) {
  const provider = providerFor(modelId);
  const name = modelNameFor(modelId);
  const key = apiKey || keys[provider as keyof LlmKeys] || LEGACY_ENV_KEYS[provider];
  assertProviderKeyAvailable(provider, key);
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: key })(name);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: key })(name);
    case "anthropic":
      return createAnthropic({ apiKey: key })(name);
    case "cerebras":
      return createOpenAICompatible({
        name: "cerebras",
        apiKey: key,
        baseURL: "https://api.cerebras.ai/v1",
      })(name);
    case "groq":
      return createOpenAICompatible({
        name: "groq",
        apiKey: key,
        baseURL: "https://api.groq.com/openai/v1",
      })(name);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        apiKey: key,
        baseURL: "https://openrouter.ai/api/v1",
      })(name);
    // Free-tier providers (no credit card needed for an API key). All expose
    // OpenAI-compatible chat endpoints.
    case "mistral":
      return createOpenAICompatible({
        name: "mistral",
        apiKey: key,
        baseURL: "https://api.mistral.ai/v1",
      })(name);
    case "nvidia":
      return createOpenAICompatible({
        name: "nvidia",
        apiKey: key,
        baseURL: "https://integrate.api.nvidia.com/v1",
      })(name);
    case "cohere":
      return createOpenAICompatible({
        name: "cohere",
        apiKey: key,
        baseURL: "https://api.cohere.ai/compatibility/v1",
      })(name);
    case "zai":
      return createOpenAICompatible({
        name: "zai",
        apiKey: key,
        baseURL: "https://api.z.ai/api/paas/v4",
      })(name);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: config.ollamaUrl,
      })(name);
    default:
      throw new Error(`Unknown model provider: ${provider}`);
  }
}

// System prompt imported from prompts.ts


// Draft qualitative parameters from an investor's persona text.
export async function draftParameters(
  modelId: string,
  keys: LlmKeys,
  persona: string,
  section: "asset_evaluation" | "macro_evaluation",
  count: number,
): Promise<{ parameter: string; content: string; weightage: number }[]> {
  const { apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>);
  const model = buildModel(modelId, keys, apiKey);
  const scope =
    section === "macro_evaluation"
      ? "market-level / macro qualitative factors a stock picker should monitor"
      : "company-level qualitative parameters for judging individual stocks";
  const result = await generateText({
    model,
    prompt: buildDraftParametersPrompt(persona, count, scope, getToolCatalog()),
    temperature: 0.4,
    maxOutputTokens: 1500,
  });
  keyPool.recordUsage({
    provider: providerFor(modelId),
    keyRef,
    modelId,
    requests: 1,
    tokensIn: result.usage?.inputTokens,
    tokensOut: result.usage?.outputTokens,
  });
  const text = (result.text || "").replace(/```(?:json)?|```/g, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Draft response was not a JSON array");
  let arr: any[];
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Could not parse drafted parameters");
  }
  return (Array.isArray(arr) ? arr : [])
    .filter((p) => p && typeof p.parameter === "string" && p.parameter.trim())
    .slice(0, count)
    .map((p) => ({
      parameter: String(p.parameter).trim(),
      content: String(p.content ?? "").trim(),
      weightage: Number.isFinite(Number(p.weightage)) ? Math.min(Math.max(Math.round(Number(p.weightage)), 1), 10) : 5,
    }));
}


export const ReportBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: z.string() }),
  z.object({ type: z.literal("paragraph"), text: z.string(), citedKeys: z.array(z.string()).optional() }),
  z.object({ type: z.literal("table"), title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("chart"), chartType: z.enum(["bar", "line", "radar", "area", "scatter", "pie", "candlestick"]), title: z.string().optional(), data: z.array(z.record(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["positive", "caution", "negative", "neutral"]), text: z.string() }),
  z.object({ type: z.literal("quote"), text: z.string(), attribution: z.string().optional() }),
]);

export type ReportBlock = z.infer<typeof ReportBlockSchema>;

export const AnalysisReportSchema = z.object({
  heroPct: z.number(),
  heroLabel: z.string(),
  blocks: z.array(ReportBlockSchema),
  partial: z.boolean(),
  /** "llm" = narrative synthesized by the model, "fallback" = deterministic assembly from scored data. */
  source: z.enum(["llm", "fallback"]).default("llm"),
  layoutSections: z.array(z.any()).optional(),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;




// ============================================================================
// 4. Skill-pipeline report synthesis (v3)
// One synthesis pass over the structured per-skill outputs. The narrative is
// the model's job; every number it may cite is provided pre-computed, and the
// sanitizeReport gate still drops ungrounded figures.
// ============================================================================

export interface SkillSynthesisInput {
  modelId: string;
  llmKeys: LlmKeys;
  agentPersona: string;
  agentDisplayName: string;
  /** Structured outputs from each skill analyst (findings + verdicts). */
  outputs: import("./skills/types.js").SkillOutput[];
  /** Null when the aggregate score was suppressed (coverage below the reliability floor). */
  totalScore: number | null;
  fitLow?: number;
  fitHigh?: number;
  coverage?: number;
  asOf?: string;
  degraded?: string;
  toolEvidence?: string;
  /**
   * Deterministic facts pack (WS-1): price, SMA/RSI/MACD/ATR/Bollinger/VWAP
   * and the level map, computed in code. The synthesis must quote these
   * exactly — never invent or recompute a figure.
   */
  factsPack?: string;
  /**
   * Code-derived stance (WS-3): per-timeframe + overall with confidence.
   * The synthesis must use this as the hero headline — never "alignment".
   */
  stance?: { short: string; medium: string; long: string; overall: string; confidence: number };
  /** Sampling temperature. The gate retry passes a higher value so it is a real second opinion, not a reroll. */
  temperature?: number;
  /** Consistency-gate issues the previous draft was rejected for (retry pass only). */
  fixIssues?: string[];
}

/**
 * Deterministic "Sources & citations" section, appended to EVERY skills-pipeline
 * report (LLM-synthesized or fallback). Built by CODE from the analysts'
 * recorded citations and raw tool observations — the unvarnished data the
 * analysis ran on, with the external URL where one exists. Not model output.
 */
/** Display domain of a URL ("nseindia.com"), or null when unparsable. */
function domainOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** One-line human summary of a JSON payload (first few key: value pairs). */
/**
 * One human-readable row pulled from an observation payload: a web story
 * (title / publisher / date / snippet) or a flattened key-value readout for
 * non-web feeds. Parsing mirrors the UI's SourceDataPanel so both ends agree
 * on what "readable" means — the model prompt's verbatim evidence, not a
 * JSON dump, is what reaches the report here.
 */
interface ObservationSummary {
    kind: "web" | "feed";
    items: { title: string | null; date: string | null; snippet: string | null }[];
}

function parseObservation(raw: string): ObservationSummary | null {
    if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
    try {
        const j = JSON.parse(raw);
        const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.results) ? j.results : [];
        if (arr.length > 0) {
            const items: ObservationSummary["items"] = [];
            for (const it of arr.slice(0, 6)) {
                if (!it || typeof it !== "object") continue;
                const title = typeof it.title === "string" && it.title.trim() ? it.title.trim() : null;
                const snippet = typeof it.content === "string" ? it.content.replace(/\s+/g, " ").trim().slice(0, 200) : null;
                if (!title && !snippet) continue;
                items.push({
                    title: title ? (title.length > 120 ? `${title.slice(0, 117)}…` : title) : null,
                    date: typeof it.published_date === "string" && it.published_date ? shortDateLabel(it.published_date) : null,
                    snippet,
                });
            }
            if (items.length > 0) return { kind: "web", items };
        }
        // Data feed: flattened key: value pairs, skipping URLs and long strings.
        const flat: string[] = [];
        const visit = (v: unknown, prefix = ""): void => {
            if (flat.length >= 6) return;
            if (v == null) return;
            if (typeof v === "object") {
                for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 10)) visit(val, prefix ? `${prefix}.${k}` : k);
            } else if (typeof v === "number" || typeof v === "boolean") {
                flat.push(`${prefix}: ${v}`);
            } else if (typeof v === "string") {
                const sv = v.replace(/\s+/g, " ").trim();
                if (sv.length <= 60 && !/^https?:/.test(sv)) flat.push(`${prefix}: ${sv}`);
            }
        };
        visit(j);
        if (flat.length > 0) return { kind: "feed", items: [{ title: null, date: null, snippet: flat.join(" · ") }] };
        return null;
    } catch {
        return null;
    }
}

/** Compact date label for an observation row ("26 Sep 2026"). */
function shortDateLabel(raw: string): string {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Deterministic "Sources" section appended to every skills-pipeline report.
 * One compact table per evidence class — web stories and feed reads — with
 * each row carrying its tool, the readable content, and the source key so
 * the report's citation numbering resolves against it.
 */
export function buildSourcesBlocks(outputs: import("./skills/types.js").SkillOutput[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const withEvidence = outputs.filter(
    (o) => (o.citations?.length || o.raw_observations?.length) && !o.error,
  );
  if (!withEvidence.length) return blocks;

  blocks.push({ type: "heading", level: 2, text: "Sources" });

  // ── Web stories: one table across all skills. Row = title / publisher /
  // date / snippet, with the URL in sourceKeys so the citation list links it. ──
  const storyRows: (string | number)[][] = [];
  const storyUrls: string[] = [];
  for (const out of withEvidence) {
    for (const c of out.citations || []) {
      if (c.url) {
        const domain = domainOfUrl(c.url);
        storyRows.push([c.label || domain || "web source", domain || "", c.value || "", out.skill_name]);
        if (!storyUrls.includes(c.url)) storyUrls.push(c.url);
      }
    }
    for (const obs of (out.raw_observations || []).slice(0, 12)) {
      if (obs.status !== "ok") continue;
      const parsed = parseObservation(obs.result || "");
      if (!parsed) continue;
      if (parsed.kind === "web") {
        for (const item of parsed.items.slice(0, 3)) {
          if (!obs.url && !item.title) continue;
          const domain = obs.url ? domainOfUrl(obs.url) : "";
          storyRows.push([item.title || item.snippet?.slice(0, 80) || "web source", domain, item.date || "", out.skill_name].map((v) => v ?? ""));
          if (obs.url && !storyUrls.includes(obs.url)) storyUrls.push(obs.url);
        }
      }
    }
  }

  if (storyRows.length) {
    blocks.push({
      type: "table",
      title: "Web stories read",
      columns: ["Story", "Publisher", "Date", "Skill"],
      rows: storyRows,
      sourceKeys: storyUrls.length ? storyUrls : ["skill_outputs"],
    });
  }
  return blocks;
}

/** Deterministic fallback for the skills pipeline: code-assembled narrative. */
export function buildSkillFallbackReport(input: SkillSynthesisInput): AnalysisReport {
  const blocks: ReportBlock[] = [];
  blocks.push({ type: "heading", level: 2, text: "Summary" });
  blocks.push({
    type: "paragraph",
    text: input.totalScore != null
      ? `${input.agentDisplayName} evaluated this company through ${input.outputs.length} skill${input.outputs.length === 1 ? "" : "s"}. The total score is ${input.totalScore} with coverage ${input.coverage ?? 0}%.`
      : `${input.agentDisplayName} evaluated this company through ${input.outputs.length} skill${input.outputs.length === 1 ? "" : "s"}. The total score was suppressed — coverage ${input.coverage ?? 0}% is below the reliability floor, so no headline number is reported. Read the per-skill verdicts instead.`,
  });
  if (input.degraded) blocks.push({ type: "callout", tone: "caution", text: `Degraded: ${input.degraded}` });

  for (const out of input.outputs) {
    blocks.push({ type: "heading", level: 3, text: out.skill_name });
    // Current pipeline output is markdown prose, not structured findings —
    // without this the fallback would show an empty section per skill.
    if (out.analysis && !(out.findings || []).length && !(out.verdicts || []).length) {
      blocks.push({ type: "paragraph", text: out.analysis });
    }
    for (const f of (out.findings || []).slice(0, 4)) {
      blocks.push({
        type: "paragraph",
        text: `${f.title}: ${f.detail}`,
        citedKeys: (f.citations || []).map((c: any) => c.url || c.source).filter(Boolean) as string[],
      });
    }
    if (out.verdicts?.length) {
      blocks.push({
        type: "table",
        title: `${out.skill_name} verdicts`,
        columns: ["Anchor", "Verdict", "Evidence", "Source"],
        rows: out.verdicts.map((v) => [
          v.anchor,
          v.verdict,
          v.evidence,
          (v.citations || []).map((c: any) => c.url || c.source).filter(Boolean).join("; ") || "—",
        ]),
        sourceKeys: ["skill_outputs"],
      });
    }
    if (out.error) blocks.push({ type: "callout", tone: "caution", text: `${out.skill_name}: ${out.error}` });
  }

  blocks.push(...buildSourcesBlocks(input.outputs));

  return {
    heroPct: input.totalScore != null ? Math.round(input.totalScore * 10) / 10 : 0,
    heroLabel: input.stance
      ? `${input.stance.overall} · ${input.stance.confidence}% confidence`
      : `Alignment with ${input.agentDisplayName}`,
    blocks,
    partial: true,
    source: "fallback",
  };
}

/**
 * Synthesis is bounded by retryLlmCall's per-attempt timeout (harness.ts), not
 * here: without it a hung provider stream blocks the run until the stale-run
 * sweeper kills it, leaving a report that was already computed but never
 * written.
 * ponytail: 3 attempts x 120s is the real ceiling. Raise it only if synthesis
 * genuinely needs longer than 2 minutes; raise STALE_RUN_THRESHOLD_MS with it.
 */

export async function synthesizeSkillReport(input: SkillSynthesisInput): Promise<AnalysisReport> {
  const { apiKey, keyRef } = keyPool.pickKey(input.modelId, input.llmKeys as Record<string, string | undefined>);
  const model = buildModel(input.modelId, input.llmKeys, apiKey);
  const provider = input.modelId.split("/")[0];
  const started = Date.now();

  const fallback = () => {
    log.warn("[agent]", "using deterministic fallback report (skill synthesis failed)");
    void keyPool.recordUsage({ provider, keyRef, modelId: input.modelId, requests: 1 });
    return buildSkillFallbackReport(input);
  };

  // Citations ride as structured metadata only. They are NOT printed into the
  // prompt prose (the model was copying them into sentences as "(Source: ...)"
  // litter); the report renderer attaches them to the right sentences itself.
  const skillSummaries = input.outputs
    .map((out) => {
      const verdicts = (out.verdicts || [])
        .map((v) => `- ${v.anchor}: ${v.verdict} — ${v.evidence}`)
        .join("\n");
      const findings = (out.findings || [])
        .map((f) => `- ${f.title}: ${f.detail}`)
        .join("\n");
      const citeLines = [
        ...(out.findings || []).flatMap((f: any) => (f.citations || []).map((c: any) => `${out.skill_name} | ${f.title} | ${c.source ?? c.url ?? ""} | ${c.value ?? ""}`)),
        ...(out.verdicts || []).flatMap((v: any) => (v.citations || []).map((c: any) => `${out.skill_name} | ${v.anchor} | ${c.source ?? c.url ?? ""} | ${c.value ?? ""}`)),
      ].filter((l: string) => l.trim().split("|").length >= 3);
      return [
        `### ${out.skill_name} (${out.category})`,
        out.error ? `Status: ${out.error}` : "Status: ok",
        out.analysis ? `Analysis:\n${out.analysis}` : "",
        findings ? `Findings:\n${findings}` : "",
        verdicts ? `Verdicts:\n${verdicts}` : "",
        citeLines.length ? `CITATION TABLE (attach these to the matching sentences via citedKeys — never print them in prose):\n${citeLines.slice(0, 80).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const prompt = [
    `Company analysis by the investor agent "${input.agentDisplayName}".`,
    input.agentPersona ? `Investor persona:\n${input.agentPersona.slice(0, 2000)}` : "",
    "",
    input.totalScore != null
      ? `AGGREGATE (computed in code — state these exactly): total score ${input.totalScore},${input.fitLow != null && input.fitHigh != null ? ` uncertainty band ${input.fitLow}–${input.fitHigh},` : ""} coverage ${input.coverage ?? 0}% of assessed skills.`
      : `AGGREGATE (computed in code): the total score was SUPPRESSED — coverage ${input.coverage ?? 0}% is below the reliability floor. Say so plainly and do NOT state or invent any headline number.${input.fitLow != null && input.fitHigh != null ? ` The uncertainty band is ${input.fitLow}–${input.fitHigh}.` : ""}`,
    input.degraded ? `Degraded run note: ${input.degraded}` : "",
    input.fixIssues?.length
      ? `A previous draft of this report was REJECTED by an automated consistency check against the figures above. Correct exactly these and do not repeat them:\n${input.fixIssues.map((i) => `- ${i}`).join("\n")}`
      : "",
    "",
    "FACTS — computed in code, quote these exactly:",
    input.factsPack || "(no facts pack available)",
    "The lines beginning READING are the pipeline's own INTERPRETATION of those figures and are authoritative. " +
      "Quote the READING verdict verbatim instead of deriving your own reading: a timeframe is only 'oversold' when its zone says oversold, " +
      "MACD level and momentum must both be stated when they disagree, 'regime' names the actual trend state, and a price below VWAP is weakness. " +
      "Never contradict a READING line — if you believe it is wrong, say the figures are inconsistent and stop.",
    "Every number you write must appear in this facts pack, the per-skill outputs below, or the aggregate line above. Never compute, estimate, or 'fill in' a figure. If a needed figure is marked INSUFFICIENT, say so.",
    "",
    input.stance
      ? `STANCE (computed in code — use this as the headline, never "alignment" or "fit"): overall ${input.stance.overall}, confidence ${input.stance.confidence}%. Per timeframe: short ${input.stance.short}, medium ${input.stance.medium}, long ${input.stance.long}.`
      : "",
    "",
    "PER-SKILL STRUCTURED OUTPUTS (already produced by focused analyst runs):",
    skillSummaries.slice(0, 60000),
    "",
    "TASK: Write the final client-facing report. Requirements:",
    "- Open with the headline: what this investor should think of this company, through the lens of their skills and persona.",
    "- One section per skill summarizing its findings and verdict outcome. You may quote the findings and verdicts verbatim — do not invent new numbers, do not recompute anything.",
    "- NEVER print citations inline in the prose. Do not write '(Source: tool)', '(Citation: ...)', or paste URLs into sentences. Citation metadata is attached separately by the system; the reader sees it rendered. Write clean sentences only.",
    "- State the aggregate total, band, and coverage, and what INSUFFICIENT/unscored items mean for confidence.",
    "- End with a short synthesis: where the skills agree, where they disagree, and the single most important thing to watch next.",
    "- Every number you mention must appear in the material above. No exceptions.",
    "- Do NOT write a separate \"Data Sources\", \"Sources\", \"Tools used\", or similar section or table. The pipeline renders the Sources section automatically from the tools actually called, their responses, and their URLs. Enumerating tools or sources in your prose or tables is redundant and will be stripped.",
  ]
    .filter(Boolean)
    .join("\n");

  // Resilience: the executive-summary pass is one shot per run, so a
  // single provider hiccup used to leave the whole report empty. Retry
  // transient failures (rotating the key pool on quota/rate errors)
  // before degrading to the deterministic fallback.
  const res = await retryLlmCall(
    "skill report synthesis",
    (signal) =>
      generateObject({
        model,
        schema: AnalysisReportSchema,
        system: SKILL_REPORT_SYNTHESIS_SYSTEM_PROMPT,
        prompt,
        temperature: input.temperature ?? 0.1,
        abortSignal: signal,
      }),
    {
      attempts: 3,
      delayMs: 1500,
      onError: (msg) => {
        log.warn("[agent]", "skill report synthesis attempt failed:", msg);
        if (/quota|rate.?limit|429|exceeded|resource.?exhausted/i.test(msg)) keyPool.markFailure(provider, keyRef);
      },
      check: (r) => !!r?.object?.blocks,
    },
  ).catch((e: any) => {
    log.warn("[agent]", "skill report synthesis failed after retries:", e?.message || e);
    return null;
  });

  if (!res) return fallback();

  keyPool.recordUsage({
    provider,
    keyRef,
    modelId: input.modelId,
    requests: 1,
    tokensIn: (res.usage as any)?.inputTokens,
    tokensOut: (res.usage as any)?.outputTokens,
  });
  log.info("[agent]", `Skill report synthesized in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const report = { ...res.object, source: (res.object.source ?? "llm") as "llm" | "fallback" };
  // The Sources section is appended by CODE after this return — a model
  // that still emitted its own source/tools listing would render it
  // twice. Strip it here so only the authoritative section survives.
  report.blocks = stripSourceListingBlocks(report.blocks);
  return report;
}

/**
 * Deterministic backstop against redundant source listings: the LLM
 * sometimes emits its own "Data sources" / "Tools used" section even
 * though buildSourcesBlocks renders the authoritative one from the
 * tools actually called. Matches headings and tables whose entire
 * subject is the source/tool inventory — never a table that merely
 * cites a source in a cell.
 */
export function stripSourceListingBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const SOURCE_HEADING = /^\s*(data\s+)?sources?\s*(used)?\s*$/i;
  const SOURCE_TABLE = /\b(data\s+)?sources?\s*(used)?\b|tools?\s+used\b/i;
  return blocks.filter((b) => {
    if (b.type === "heading" && SOURCE_HEADING.test(b.text)) return false;
    if (b.type === "table" && b.title && SOURCE_TABLE.test(b.title)) {
      // Only drop when the table's columns are about the tooling itself
      // (tool / source / url), not when it merely cites sources as data.
      const cols = b.columns.join(" ").toLowerCase();
      if (/tool|source|url|provider|feed/.test(cols)) return false;
    }
    return true;
  });
}
