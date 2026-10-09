import { generateText } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { LAYOUT_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import type { SkillOutput } from "./skills/types.js";

/**
 * Layout agent + OpenUI Lang integration.
 *
 * Two deterministic halves around one model call:
 *   buildDataManifest  — code-only: serializes captured tool observations into
 *                        stable dataset rows + literal price scalars. The model
 *                        never types values or picks series; it only references
 *                        ids from this manifest.
 *   groundLang         — text-level check that every `@ds:`/`@lit:` reference in
 *                        the emitted Lang exists in the manifest. Non-blocking:
 *                        unresolved refs strip/badge, and a heavily-unresolved
 *                        Lang is discarded entirely.
 */

export interface LayoutManifestInput {
  symbol: string;
  shareName: string;
  source: string;
  agentName: string;
  runMode: string;
  asOf: string;
  outputs: SkillOutput[];
  totalScore: number | null;
  coverage: number | null;
  degraded?: string;
}

export interface ManifestDataset {
  id: string;
  label: string;
  kind: "series" | "table";
  cols: string[];
  /** Deterministic rows, keyed by col. Values are number | string | null. */
  rows: Record<string, number | string | null>[];
}

export interface LayoutManifest {
  api: 1;
  identity: {
    symbol: string;
    shareName: string;
    source: string;
    agentName: string;
    runMode: string;
    asOf: string;
  };
  score: {
    totalScore: number | null;
    coverage: number | null;
    degraded?: string;
  };
  skills: {
    id: string;
    name: string;
    category: string;
    weight: number;
    score: number | null;
    /** Analyst prose per skill. Empty ("") in the prompt view; kept when persisted. */
    markdown?: string;
  }[];
  price: {
    lastPrice: number | null;
    week52Low: number | null;
    week52High: number | null;
    asOf: string | null;
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    returns: Record<string, number | null>;
  } | null;
  datasets: ManifestDataset[];
}

const MAX_TABLE_ROWS = 300;
const MAX_CELL_CHARS = 160;

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function cellValue(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS)}…` : v;
  const s = JSON.stringify(v);
  return s && s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}

function parseObservationResult(result: string | undefined): unknown {
  if (!result) return undefined;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Price profile — pulled from the captured get_price_history/get_current_price
// tool results, expressed as littable scalars + named series datasets.
// ---------------------------------------------------------------------------

export interface PriceProfile {
  price: LayoutManifest["price"];
  datasets: ManifestDataset[];
}

const PRICE_TOOLS = new Set(["get_price_history", "get_current_price"]);

export function buildPriceProfile(observations: SkillOutput["raw_observations"]): PriceProfile {
  const lit: LayoutManifest["price"] = {
    lastPrice: null,
    week52Low: null,
    week52High: null,
    asOf: null,
    rsi14: null,
    sma20: null,
    sma50: null,
    sma200: null,
    returns: {},
  };
  const datasets: ManifestDataset[] = [];

  for (const obs of observations ?? []) {
    if (!PRICE_TOOLS.has(obs.tool) || obs.status === "ERR") continue;
    const data = parseObservationResult(obs.result);
    if (!data || typeof data !== "object") continue;

    if (obs.tool === "get_price_history") {
      const row = data as Record<string, unknown>;
      if (Array.isArray(row.candles_recent) && row.candles_recent.length) {
        datasets.push({
          id: "price_candles",
          label: "Price history",
          kind: "series",
          cols: ["date", "close", "volume"],
          rows: row.candles_recent.slice(-260).map((c: Record<string, unknown>) => ({
            date: String(c.date ?? ""),
            close: toNum(c.c ?? c.close),
            volume: toNum(c.v ?? c.volume),
          })),
        });
        const last = Array.isArray(row.candles_recent)
          ? (row.candles_recent[row.candles_recent.length - 1] as Record<string, unknown>)
          : null;
        lit.lastPrice = toNum(last?.c ?? last?.close) ?? toNum((row.digest as Record<string, unknown>)?.price);
      }
      for (const [key, id] of [
        ["sma20", "price_sma20"],
        ["sma50", "price_sma50"],
        ["sma200", "price_sma200"],
        ["rsi14", "price_rsi14"],
      ] as const) {
        const s = row[key];
        if (Array.isArray(s) && s.length) {
          datasets.push({
            id,
            label: key.toUpperCase(),
            kind: "series",
            cols: ["date", "value"],
            rows: s.slice(-260).map((p: Record<string, unknown>) => ({ date: String(p.date ?? ""), value: toNum(p.value ?? p.v) })),
          });
          lit[key] = toNum(s[s.length - 1]?.value ?? (s[s.length - 1] as Record<string, unknown>)?.v);
        }
      }
      if (row.fifty_two_week && typeof row.fifty_two_week === "object") {
        const f = row.fifty_two_week as Record<string, unknown>;
        lit.week52Low = toNum(f.low);
        lit.week52High = toNum(f.high);
      }
      if (row.fetched_at) lit.asOf = String(row.fetched_at).slice(0, 10);
    } else if (obs.tool === "get_current_price") {
      const row = data as Record<string, unknown>;
      lit.lastPrice = toNum(row.price) ?? lit.lastPrice;
      lit.week52High = toNum(row.week52High) ?? toNum(row.week52_high) ?? lit.week52High;
      lit.week52Low = toNum(row.week52Low) ?? toNum(row.week52_low) ?? lit.week52Low;
      lit.asOf = String(row.asOf ?? row.fetched_at ?? "").slice(0, 10) || lit.asOf;
      const returns = (row.returns ?? row.performance) as Record<string, unknown> | undefined;
      if (returns && typeof returns === "object") {
        for (const [k, v] of Object.entries(returns)) lit.returns[k] = toNum(v);
      }
    }
  }

  return { price: lit.lastPrice == null && !datasets.length ? null : lit, datasets };
}

// ---------------------------------------------------------------------------
// Generic tables — everything else captured by the analyst tools, capped.
// ---------------------------------------------------------------------------

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
}

export function normalizeDatasets(observations: SkillOutput["raw_observations"]): ManifestDataset[] {
  const datasets: ManifestDataset[] = [];
  for (const obs of observations ?? []) {
    if (obs.status === "ERR" || PRICE_TOOLS.has(obs.tool)) continue;
    const data = parseObservationResult(obs.result);
    if (!isArrayOfObjects(data) || data.length === 0) continue;

    const toolKey = obs.tool.replace(/[^a-z0-9_]/gi, "_").slice(0, 32);
    const cols: string[] = [];
    for (const row of data) for (const key of Object.keys(row)) if (!cols.includes(key)) cols.push(key);
    datasets.push({
      id: `obs_${toolKey}_${datasets.length}`,
      label: obs.tool,
      kind: "table",
      cols,
      rows: data.slice(0, MAX_TABLE_ROWS).map((row) => {
        const out: Record<string, number | string | null> = {};
        for (const col of cols) out[col] = cellValue(row[col]);
        return out;
      }),
    });
  }
  return datasets;
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

/** Full manifest — persisted and handed to the UI renderer (prose + rows). */
export function buildDataManifest(input: LayoutManifestInput): LayoutManifest {
  const observations = input.outputs.flatMap((o) => o.raw_observations ?? []);
  const { price, datasets: priceDatasets } = buildPriceProfile(observations);
  const skills = input.outputs.map((o) => ({
    id: o.skill_id,
    name: o.skill_name,
    category: o.category,
    weight: o.weight,
    score: o.score_0_100 ?? null,
    markdown: o.analysis ?? "",
  }));
  const scoreSkills: ManifestDataset = {
    id: "score_skills",
    label: "Skill scores",
    kind: "table",
    cols: ["id", "name", "category", "weight", "score"],
    rows: skills.map((s) => ({ id: s.id, name: s.name, category: s.category, weight: s.weight, score: s.score })),
  };
  const datasets: ManifestDataset[] = [...priceDatasets, scoreSkills, ...normalizeDatasets(observations)];
  return {
    api: 1,
    identity: {
      symbol: input.symbol,
      shareName: input.shareName,
      source: input.source,
      agentName: input.agentName,
      runMode: input.runMode,
      asOf: input.asOf,
    },
    score: {
      totalScore: input.totalScore,
      coverage: input.coverage,
      degraded: input.degraded,
    },
    skills,
    price,
    datasets,
  };
}

/**
 * Prompt-sized view: the model only needs dataset ids/labels/cols and skill ids
 * to compose `@ds:`/`@lit:` references — never the rows or per-skill prose (the
 * UI renders those from the full stored manifest). Rows must be dropped: a
 * single wide table (≤60 rows) plus the catalog easily overruns small models'
 * per-request token budget (e.g. Groq free tier = 8000 TPM), which silently
 * fails the whole layout.
 */
export function manifestForPrompt(manifest: LayoutManifest): LayoutManifest {
  return {
    ...manifest,
    skills: manifest.skills.map((s) => ({ ...s, markdown: "" })),
    datasets: manifest.datasets.map((d) => ({ ...d, rows: [] })),
  };
}

// ---------------------------------------------------------------------------
// Model turn + grounding
// ---------------------------------------------------------------------------

export interface LayoutResult {
  lang: string | null;
  /** Non-fatal diagnostics for tracing/UI. */
  unresolved: string[];
  pass: boolean;
}

/** Every component the layout DSL may call (mirrors the ui library spec). */
export const LAYOUT_COMPONENTS = new Set([
  "AnalysisPage",
  "StatHero",
  "PriceChart",
  "MultiLineChart",
  "BarChart",
  "PieChart",
  "BoxPlotChart",
  "HeatmapChart",
  "DataTable",
  "SkillScoreCard",
  "MarkdownBlock",
]);

/**
 * Strip a code fence and any prose before the root call, and guarantee the
 * entry statement is bound to `root`. The parser only renders a statement
 * bound to `root`; a bare `AnalysisPage(...)` parses but has no entry point
 * and renders nothing, so we bind it here.
 */
export function normalizeLang(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```[a-z0-9]*\n([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const m = /root\s*=\s*AnalysisPage\s*\(/.exec(s) ?? /AnalysisPage\s*\(/.exec(s);
  if (m && m.index > 0) s = s.slice(m.index).trim();
  if (/^AnalysisPage\s*\(/.test(s)) s = `root = ${s}`;
  return s;
}

/**
 * Cheap syntactic gate — the api cannot import the React parser, so this checks
 * the shape an invalid model output always violates: balanced delimiters, exactly
 * one root AnalysisPage first, and only known component names.
 */
export function validateLangStructure(lang: string): { ok: boolean; error?: string } {
  let depthP = 0;
  let depthB = 0;
  let inStr = false;
  for (let i = 0; i < lang.length; i++) {
    const ch = lang[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "(") depthP++;
    else if (ch === ")") depthP--;
    else if (ch === "[") depthB++;
    else if (ch === "]") depthB--;
  }
  if (inStr) return { ok: false, error: "unterminated string" };
  if (depthP !== 0) return { ok: false, error: "unbalanced parentheses" };
  if (depthB !== 0) return { ok: false, error: "unbalanced brackets" };
  if (!/^\s*root\s*=\s*AnalysisPage\s*\(/.test(lang)) return { ok: false, error: "AnalysisPage must be bound to root as the first statement" };

  const bare = lang.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const names = [...bare.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
  const roots = names.filter((n) => n === "AnalysisPage").length;
  if (roots !== 1) return { ok: false, error: `expected exactly one AnalysisPage(...) root, found ${roots}` };
  const unknown = [...new Set(names.filter((n) => !LAYOUT_COMPONENTS.has(n)))];
  if (unknown.length) return { ok: false, error: `unknown component(s): ${unknown.join(", ")}` };
  return { ok: true };
}

export async function runLayoutAgent(args: {
  model: string;
  llmKeys: LlmKeys;
  apiKey?: string;
  manifest: LayoutManifest;
}): Promise<string | null> {
  const prompt = `Layout manifest (you reference dataset/literal ids FROM THIS; never invent ids):\n${JSON.stringify(manifestForPrompt(args.manifest))}`;
  const attempt = (repair?: string) =>
    generateText({
      model: buildModel(args.model, args.llmKeys, args.apiKey),
      system: LAYOUT_AGENT_SYSTEM_PROMPT,
      prompt: repair ? `${prompt}\n\nYour previous output was invalid: ${repair}. Return corrected OpenUI Lang only.` : prompt,
      temperature: 0.2,
      // ponytail: free-tier models cap output (command-r7b = 4096); a higher
      // value makes the whole call 400 with TOO_MANY_TOKENS. Layout Lang is
      // small, so 4096 is ample. Raise per-model only if a model needs more.
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(120_000),
    });

  let lang: string | null = null;
  try {
    lang = normalizeLang((await attempt()).text) || null;
  } catch {
    // a transient provider hiccup shouldn't drop the layout — fall through to repair
  }
  if (lang && validateLangStructure(lang).ok) return lang;

  // One repair pass with the SAME model, telling it exactly what broke.
  const reason = lang ? validateLangStructure(lang).error : "empty output";
  try {
    const fixed = normalizeLang((await attempt(reason)).text);
    if (fixed) lang = fixed;
  } catch (e: unknown) {
    if (!lang) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.reject(new Error(`layout agent failed: ${msg}`));
    }
  }
  return lang;
}

function literalKeys(manifest: LayoutManifest): Set<string> {
  const keys = new Set<string>();
  const p = manifest.price;
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number" || typeof v === "string" || v == null) keys.add(`price.${k}`);
      else if (typeof v === "object") for (const kk of Object.keys(v)) keys.add(`price.${k}.${kk}`);
    }
  }
  for (const s of manifest.skills) {
    keys.add(`skill.${s.id}`);
    keys.add(`skill.${s.name}`);
  }
  keys.add("score.totalScore");
  keys.add("score.coverage");
  return keys;
}

export const MAX_UNRESOLVED_REFS = 8;

export function groundLang(lang: string, manifest: LayoutManifest): { pass: boolean; unresolved: string[] } {
  const validDatasets = new Set(manifest.datasets.map((d) => d.id));
  const validLits = literalKeys(manifest);
  const unresolved = new Set<string>();
  for (const m of lang.matchAll(/@(ds|lit):([\w.-]+)/g)) {
    const [, kind, id] = m;
    const ref = `${kind}:${id}`;
    const valid = kind === "ds" ? validDatasets.has(id) : validLits.has(id);
    if (!valid) unresolved.add(ref);
  }
  return { pass: unresolved.size <= MAX_UNRESOLVED_REFS, unresolved: [...unresolved] };
}