/**
 * Standalone iterative analysis agent.
 *
 * A thin wrapper over `runAgentTurn` that keeps re-invoking the agent until it
 * signals the instruction is complete (`[[DONE]]`) or a turn budget is hit.
 * `runAgentTurn` already loops over TOOL calls within one turn; this loops over
 * whole TURNS so the model can plan, act, review its own progress, and continue
 * across as many turns as the instruction needs (YAGNI: no planner/executor split,
 * the model self-manages via the progress transcript).
 *
 * Not wired into the pipeline — call it directly (see `api/test` for usage).
 */
import type { LanguageModel } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { keyPool } from "./keypool.js";
import { buildTools, type ToolContext } from "./tools.js";
import { VoyagerClient, toCountrySource } from "./voyager.js";
import { runAgentTurn, retryLlmCall, type HarnessTraceEvent } from "./harness.js";
import { config } from "./config.js";
import { generateText } from "ai";
import {
  buildPriceProfile,
  normalizeDatasets,
  normalizeMetrics,
  manifestForPrompt,
  validateLangStructure,
  normalizeLang,
  groundLang,
  type LayoutManifest,
} from "./layout.js";
import type { SkillRawObservation } from "./skills/types.js";
import { ITERATIVE_AUTHOR_SYSTEM_PROMPT, ITERATIVE_SECTION_SYSTEM_PROMPT } from "./prompts.js";

/** Emitted by the agent (on its own line) when the instruction is complete. */
export const DONE_MARKER = "[[DONE]]";

export const DEFAULT_ITERATIVE_MODEL = "gemini/gemini-3.5-flash-lite";

export interface IterativeAgentOptions {
  /** What the agent must accomplish. */
  instruction: string;
  /** Company the tools are bound to (e.g. "RELIANCE"). */
  symbol: string;
  /** Model id used to pick a key + build the model. Ignored when `model` is set. */
  modelId?: string;
  /** Pre-built model (tests inject a mock; skips key picking). */
  model?: LanguageModel;
  /** Server key map for the model. Defaults to an empty map (server pool). */
  keys?: LlmKeys;
  /** Override the tool set (defaults to the analyst tools for `symbol`). */
  tools?: Record<string, unknown>;
  /** Override the system prompt (e.g. swap per task). Defaults to DEFAULT_SYSTEM. */
  system?: string;
  /** Market source for country/source binding. Default "NSE". */
  source?: string;
  /** Max outer turns before giving up. Default 6. */
  maxIterations?: number;
  /** Per-turn wall-clock budget, ms. */
  deadlineMs?: number;
  onEvent?: (event: HarnessTraceEvent) => void;
  /** Called after each outer turn with the prompt sent, output, and tools used. */
  onTurn?: (turn: { iteration: number; prompt: string; text: string; toolCalls: Record<string, unknown>[]; error?: string }) => void;
  /**
   * Independent completion gate, run when the agent emits `[[DONE]]`. The marker
   * alone is only a control signal — this decides whether the result actually
   * satisfies the task. Return `true` to accept, or a string describing the gap
   * to reject: the reason is fed back to the agent on the next turn. Omit to
   * trust the marker (legacy behaviour — you get exactly what the model says).
   */
  isComplete?: (result: { text: string; toolCalls: Record<string, unknown>[]; iterations: number }) => true | string;
}

export interface IterativeAgentResult {
  /** Accumulated text across all turns. */
  text: string;
  /** OpenUI Lang report authored from the same run; null when authoring was skipped or failed. */
  lang: string | null;
  /** Frozen manifest of the run's tool outputs; the renderer's only data source. */
  manifest: LayoutManifest | null;
  /** Number of outer turns that ran. */
  iterations: number;
  /** Every tool call the agent made (all turns). */
  toolCalls: Record<string, unknown>[];
  /** DONE only when a completion gate accepted (or no gate was given) and the marker was seen. */
  status: "DONE" | "PARTIAL" | "FAILED";
  /** Set when a turn failed (FAILED) or the criteria/budget were not met (PARTIAL). */
  error?: string;
}

/** Built-in system prompt; replace it by passing `opts.system`, or compose off it. */
export const DEFAULT_SYSTEM = [
  "You are an iterative analysis agent. You are bound to ONE company via your tools — the company symbol is handled for you, never pass a symbol for a different company.",
  "Work in turns. Each turn: think, call the tools you need, then write a concise progress note.",
  `When (and only when) the instruction is fully satisfied, write the final answer, then a line containing exactly ${DONE_MARKER}.`,
  "For charts later: ALWAYS call get_price_history with include_series=true (NOT default) so real price/SMA/RSI series are captured for plotting.",
  "If a document tool returns empty or unusable data, fall back to get_financial_metrics and get_price_history — never report numbers you did not get from a tool result.",
].join("\n");

export async function runIterativeAgent(opts: IterativeAgentOptions): Promise<IterativeAgentResult> {
  const modelId = opts.modelId ?? DEFAULT_ITERATIVE_MODEL;
  const maxIterations = opts.maxIterations ?? 6;

  const keys = opts.keys ?? {};
  const model = opts.model ?? buildModel(modelId, keys, keyPool.pickKey(modelId, keys as Record<string, string | undefined>).apiKey);

  // Symbol is closure-bound into every tool, so a "search for a company" tool is
  // worse than useless here — it invites the cross-company calls we saw. Drop it.
  const tools =
    opts.tools ??
    Object.fromEntries(
      Object.entries(buildTools(analysisContext(opts.symbol, opts.source), { analyst: true })).filter(
        ([name]) => name !== "search_symbol",
      ),
    );
  const system = opts.system ?? DEFAULT_SYSTEM;

  let text = "";
  let finalAnswer = "";
  const toolCalls: Record<string, unknown>[] = [];
  let iterations = 0;
  let error: string | undefined;
  let status: IterativeAgentResult["status"] = "PARTIAL";
  let rejectReason: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const prompt =
      i === 0
        ? `${opts.instruction}\n\nBegin.`
        : [
            "Progress so far:",
            text.trim() || "(no output yet)",
            ...(rejectReason
              ? ["", `Your previous answer was REJECTED: ${rejectReason}`, "Fix that gap before finishing."]
              : []),
            "",
            `Continue the instruction. If it is now fully satisfied, give the final answer then a line with exactly ${DONE_MARKER}; otherwise continue working.`,
          ].join("\n");

    const turn = await runAgentTurn({
      model,
      system,
      prompt,
      tools,
      forceTools: true,
      deadlineMs: opts.deadlineMs,
      onEvent: opts.onEvent,
    });

    toolCalls.push(...turn.toolCalls);
    if (turn.text) {
      text += (text ? "\n\n" : "") + turn.text;
      // The final answer is the last turn's text — earlier turns are progress
      // notes. Without a format step to distill, keep only the final answer.
      if (turn.text.includes(DONE_MARKER)) finalAnswer = turn.text;
    }

    opts.onTurn?.({ iteration: i + 1, prompt, text: turn.text, toolCalls: turn.toolCalls, error: turn.error });

    if (turn.error) {
      error = turn.streamError || turn.error;
      status = "FAILED";
      break;
    }
    if (turn.text.includes(DONE_MARKER)) {
      // The marker is a control signal, not proof. With a gate, the model only
      // gets to stop if the gate agrees; otherwise we tell it what's missing.
      if (!opts.isComplete) {
        status = "DONE";
        break;
      }
      const verdict = opts.isComplete({ text, toolCalls, iterations });
      if (verdict === true) {
        status = "DONE";
        break;
      }
      rejectReason = verdict;
    }
  }

  if (status !== "DONE" && status !== "FAILED") {
    error = rejectReason
      ? `Agent did not satisfy the completion criteria within ${maxIterations} iteration(s): ${rejectReason}`
      : `Agent did not complete within ${maxIterations} iteration(s).`;
  }

  // No format step distils the answer — keep only the final turn's text and
  // strip the control marker. Earlier turns are progress notes.
  if (status === "DONE" && finalAnswer) {
    text = finalAnswer.split(DONE_MARKER)[0].trim();
  }

  // Authoring pass: freeze the run's tool outputs into a manifest, then one
  // tool-less turn turns the shaped answer into an OpenUI Lang report (prose +
  // charts interleaved by the same model that wrote them). Gated on data — a
  // run that pulled nothing chartable keeps text as the whole result. A bad
  // authoring run degrades to text, never to a broken page.
  let lang: string | null = null;
  let manifest: LayoutManifest | null = null;
  if (text.trim() && status === "DONE" && toolCalls.length) {
    manifest = buildIterativeManifest({
      symbol: opts.symbol,
      shareName: opts.symbol,
      source: opts.source ?? "NSE",
      toolCalls,
    });
    const hasData = !!(manifest.price || manifest.datasets.length || manifest.metrics?.length);
    if (hasData) {
      lang = await authorLang({ model, manifest, text, deadlineMs: opts.deadlineMs });
      console.log(`[dbg] hasData=true datasets=${manifest.datasets.length} metrics=${manifest.metrics?.length} lang=${lang ? "ok" : "null"}`);
    } else {
      console.log(`[dbg] hasData=false price=${!!manifest.price} datasets=${manifest.datasets.length} metrics=${manifest.metrics?.length}`);
    }
  }

  return { text, lang, manifest, iterations, toolCalls, status, error };
}

/**
 * Freeze a run's tool calls into the layout manifest: the price profile plus
 * every measured dataset/metric group the agent actually pulled. Same
 * normalizers as the skill layout path — no new analysis code.
 */
export function buildIterativeManifest(args: {
  symbol: string;
  shareName: string;
  source: string;
  toolCalls: Record<string, unknown>[];
}): LayoutManifest {
  const observations: SkillRawObservation[] = args.toolCalls
    .filter((c) => c.tool_name)
    .map((c) => ({
      tool: String(c.tool_name),
      result: typeof c.result === "string" ? c.result : c.result == null ? "" : JSON.stringify(c.result),
      status: c.status === "ERR" || c.status === "EMPTY" ? (c.status as SkillRawObservation["status"]) : "ok",
    }));
  const { price, datasets: priceDatasets } = buildPriceProfile(observations);
  const datasets = [...priceDatasets];
  const metrics: LayoutManifest["metrics"] = [];
  normalizeDatasets(observations, undefined, datasets);
  normalizeMetrics(observations, undefined, metrics);
  return {
    api: 1,
    identity: {
      symbol: args.symbol,
      shareName: args.shareName,
      source: args.source,
      agentName: "iterative-analyst",
      runMode: "iterative",
      asOf: new Date().toISOString().slice(0, 10),
    },
    score: { totalScore: null, coverage: null },
    skills: [],
    price,
    datasets,
    metrics,
  };
}

/**
 * One tool-less authoring pass that turns the manifest + the agent's shaped
 * answer into an OpenUI Lang report, with the same validate + repair + ground
 * gates as the skill layout path. Returns null when nothing usable came back —
 * the caller keeps the plain-text result.
 *
 * Multi-section write-ups are authored one section at a time — each call sees
 * the FULL write-up so no finding is lost — then stitched into a single
 * AnalysisPage. Section calls run at bounded concurrency and ride
 * retryLlmCall, so a provider 429/quota blip retries instead of failing the
 * report. Any section failure (or a failed gate on the stitch) falls back to
 * the single-call path below rather than dropping content.
 */
export async function authorLang(args: {
  model: LanguageModel;
  manifest: LayoutManifest;
  text: string;
  deadlineMs?: number;
}): Promise<string | null> {
  const sections = parseSections(args.text);
  if (sections.length > 1) {
    const fragments = await mapWithConcurrency(sections, SECTION_CONCURRENCY, (section, i) =>
      authorSection({
        model: args.model,
        manifest: args.manifest,
        text: args.text,
        symbol: args.manifest.identity.symbol,
        section,
        index: i,
        total: sections.length,
      }),
    );
    if (fragments.every((f) => f !== null)) {
      const stitched = stitchSections(args.manifest.identity.symbol, fragments as string[]);
      if (stitched && validateLangStructure(stitched).ok && groundLang(stitched, args.manifest).pass) return stitched;
      console.log("[dbg] section authoring failed gates — falling back to single-call");
    } else {
      console.log("[dbg] a section call failed after retries — falling back to single-call");
    }
  }
  return authorLangSingle(args);
}

/** Single-call authoring — the original whole-report path, kept as fallback. */
async function authorLangSingle(args: {
  model: LanguageModel;
  manifest: LayoutManifest;
  text: string;
  deadlineMs?: number;
}): Promise<string | null> {
  const prompt = [
    "Layout manifest (reference dataset/literal ids FROM THIS; never invent ids):",
    JSON.stringify(manifestForPrompt(args.manifest)),
    "",
    "Analyst write-up (your own already-shaped words):",
    args.text,
  ].join("\n");
  const attempt = (repair?: string) =>
    generateText({
      model: args.model,
      system: ITERATIVE_AUTHOR_SYSTEM_PROMPT,
      prompt: repair ? `${prompt}\n\nYour previous output was invalid: ${repair}. Return corrected OpenUI Lang only.` : prompt,
      temperature: 0.2,
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(120_000),
    });
  let lang: string | null = null;
  try {
    lang = normalizeLang((await attempt()).text) || null;
  } catch {
    // fall through to repair with no candidate
  }
  if (lang && !validateLangStructure(lang).ok) {
    const reason = validateLangStructure(lang).error ?? "invalid output";
    try {
      const fixed = normalizeLang((await attempt(reason)).text);
      if (fixed) lang = fixed;
    } catch {
      // keep the first attempt; grounding decides
    }
  }
  if (lang && validateLangStructure(lang).ok && groundLang(lang, args.manifest).pass) return lang;
  return null;
}

/** Section calls stay serialized two-at-a-time: parallel enough to matter,
 *  gentle enough not to trip provider rate limits. */
const SECTION_CONCURRENCY = 2;
/** Cap on per-section LLM calls per report — bounds cost and rate-limit
 *  exposure no matter how many headings the write-up has. */
const MAX_SECTIONS = 6;

/**
 * Split the write-up into its titled sections (markdown headings, no LLM).
 * The lead chunk before the first heading rides along with the first header.
 * More than MAX_SECTIONS chunks are merged so the call count stays bounded.
 */
function parseSections(text: string): string[] {
  const heads: number[] = [];
  const re = /^(#{1,4}\s+.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) heads.push(m.index);
  if (!heads.length) return [text.trim()];
  const chunks: string[] = [];
  let prev = 0;
  for (const h of heads) {
    if (text.slice(prev, h).trim()) chunks.push(text.slice(prev, h).trim());
    prev = h;
  }
  if (text.slice(prev).trim()) chunks.push(text.slice(prev).trim());
  if (chunks.length <= MAX_SECTIONS) return chunks;
  const per = Math.ceil(chunks.length / MAX_SECTIONS);
  const merged: string[] = [];
  for (let i = 0; i < chunks.length; i += per) merged.push(chunks.slice(i, i + per).join("\n\n"));
  return merged;
}

/** Order-preserving bounded-concurrency map (worker pool, no dependency). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * One section's Lang fragment: full write-up + manifest + the section spec.
 * Emits bare inner statements only — no root wrapper. Null only when every
 * retry failed (rate-limit 429s included), so the dispatcher can fall back.
 */
async function authorSection(args: {
  model: LanguageModel;
  manifest: LayoutManifest;
  text: string;
  symbol: string;
  section: string;
  index: number;
  total: number;
}): Promise<string | null> {
  const prompt = [
    "Layout manifest (reference dataset/literal ids FROM THIS; never invent ids):",
    JSON.stringify(manifestForPrompt(args.manifest)),
    "",
    "Analyst write-up (full — your section may draw on any part of it):",
    args.text,
    "",
    `YOUR SECTION (${args.index + 1} of ${args.total}) — author ONLY this section:`,
    args.section,
  ].join("\n");
  try {
    const res = await retryLlmCall(
      `author-section-${args.index + 1}`,
      (signal) =>
        generateText({
          model: args.model,
          system: ITERATIVE_SECTION_SYSTEM_PROMPT,
          prompt,
          temperature: 0.2,
          maxOutputTokens: 2048,
          abortSignal: signal,
        }),
      { attempts: 3, delayMs: 2000, timeoutMs: 120_000, check: (r) => r.text.trim().length > 0 },
    );
    return res.text.trim();
  } catch {
    return null;
  }
}

/**
 * Tolerantly flatten fragments into statement lines and wrap them in the root
 * AnalysisPage call. Fragments may carry code fences, stray prose, or even a
 * root wrapper anyway — only the statement lines inside survive.
 */
function stitchSections(symbol: string, fragments: string[]): string | null {
  const statements = fragments.flatMap((raw) => {
    let s = raw.trim();
    const fence = s.match(/```[a-z0-9]*\n([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const wrapped = /AnalysisPage\s*\(\s*"[^"]*"\s*,\s*\[([\s\S]*)\]/.exec(s);
    if (wrapped) s = wrapped[1];
    return s
      .split("\n")
      .map((l) => l.trim().replace(/,$/, ""))
      .filter((l) => l && !/^root\s*=/.test(l));
  });
  if (!statements.length) return null;
  return normalizeLang(`root = AnalysisPage(${JSON.stringify(symbol)}, [\n${statements.join(",\n")}\n])`);
}

function analysisContext(symbol: string, source = "NSE"): ToolContext {
  const market = toCountrySource(source);
  return {
    // Standalone path has no per-user key, so use the shared data:read key. The
    // admin key is only valid on /admin/* and 401s every data route.
    // ponytail: one shared key; thread a per-user key here if debug runs ever
    // need isolation (the HTTP path already does this via `voyagerKey`).
    voyager: new VoyagerClient(config.voyagerUrl, config.voyagerApiKey, config.voyagerRpm),
    symbol,
    country: market.country,
    source: market.source,
    shareName: symbol,
  };
}
