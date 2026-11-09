/**
 * websearch — free web search via a local SearXNG instance (keyless).
 *
 * Research (search-first): SearXNG aggregates ~10 engines behind one local
 * JSON API (GET /search?...&format=json) — no API key, no per-query cost,
 * and our IP never hammers a single provider the way the old direct
 * DuckDuckGo scraping did (that got us soft-blocked into 3-minute searches
 * that returned zero and killed a whole run). Individual engines may still
 * throttle some queries — partial results are normal, total blackouts are
 * not. Setup: `npm run searxng` (Docker, localhost:8888, JSON format on).
 *
 * One call is hard-bounded by web.timeoutMs (agent.yaml, default 10s),
 * attempts included — a hung or missing container returns an honest zero
 * fast instead of stranding an agent. The tool never throws into a loop.
 *
 * News = the same endpoint with categories=news; recency maps to
 * time_range (day/week/month, none beyond 31 days).
 */

import { wrapUntrusted } from "./untrusted.js";
import { log } from "../log.js";
import { loadAgentConfig } from "../config.js";

export interface WebSearchResult {
  title: string;
  url: string;
  published_date?: string;
  content?: string;
}

export interface WebSearchOutcome {
  query: string;
  provider: "searxng";
  count: number;
  results: WebSearchResult[];
}

/** One news story: the same shape web results use, plus the publisher. */
export interface NewsSearchResult extends WebSearchResult {
  source?: string;
}

export interface NewsSearchOutcome {
  query: string;
  provider: "searxng";
  count: number;
  results: NewsSearchResult[];
}

const MAX_SNIPPET_CHARS = 2000;
const MAX_RESULTS = 5;
const MAX_NEWS_RESULTS = 10;
// Tool contract: queries cap at 100 chars. Clamped while building the request
// so long model-generated queries never widen traffic or fragment the cache.
const MAX_QUERY_CHARS = 100;
// Searches repeat inside a run (same query, same window) — cache real hits
// briefly. Zeros are never cached, so a failed call never poisons a retry.
const RESULT_TTL_MS = 5 * 60 * 1000;
const MAX_RESULT_CACHE = 100;

const DEFAULTS = {
  baseUrl: "http://localhost:8888",
  /** Per-attempt fetch budget (starts when the pacing slot is granted). */
  timeoutMs: 15_000,
  maxAttempts: 2,
  retryGapMs: 1000,
  // Polite to the UPSTREAM engines behind SearXNG: bursts at 200ms/4 got
  // our IP suspended (CAPTCHA/429) for minutes mid-session.
  minIntervalMs: 750,
  maxConcurrent: 3,
};

export interface WebCfg {
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  retryGapMs: number;
  minIntervalMs: number;
  maxConcurrent: number;
}

/** agent.yaml web merged over defaults; SEARXNG_URL env wins over baseUrl. Exported: the /health/sources chip resolves the same URL. */
export function webCfg(): WebCfg {
  const web = (loadAgentConfig().web ?? {}) as Partial<WebCfg>;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const baseUrl = process.env.SEARXNG_URL || web.baseUrl || DEFAULTS.baseUrl;
  return {
    baseUrl,
    timeoutMs: num(web.timeoutMs, DEFAULTS.timeoutMs),
    maxAttempts: Math.max(1, num(web.maxAttempts, DEFAULTS.maxAttempts)),
    retryGapMs: num(web.retryGapMs, DEFAULTS.retryGapMs),
    minIntervalMs: num(web.minIntervalMs, DEFAULTS.minIntervalMs),
    maxConcurrent: Math.max(1, num(web.maxConcurrent, DEFAULTS.maxConcurrent)),
  };
}

// One honest UA for every fetch out of this module (SearXNG + web_fetch).
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let lastCallAt = 0;
let active = 0;
const slotWaiters: Array<() => void> = [];
// Test escape hatch: vitest stubs fetch, so production pacing only slows
// suites down. Exported via the test hooks below.
let pacingEnabled = true;
/** Test-only override for the whole web config (null = read agent.yaml). */
let cfgOverride: Partial<WebCfg> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function currentCfg(): WebCfg {
  return { ...webCfg(), ...(cfgOverride ?? {}) };
}

/**
 * Light gate: up to maxConcurrent in flight, ≥minIntervalMs between starts.
 * Local service — this only keeps our own fan-out polite, not a remote
 * provider's (SearXNG fans out across engines with its own timeouts).
 * ponytail: in-process only; multiple harness processes each run their own gate.
 */
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  if (!pacingEnabled) return fn();
  while (active >= currentCfg().maxConcurrent) {
    await new Promise<void>((r) => slotWaiters.push(r));
  }
  active++;
  try {
    for (;;) {
      const wait = lastCallAt + currentCfg().minIntervalMs - Date.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    lastCallAt = Date.now();
    return await fn();
  } finally {
    active--;
    slotWaiters.shift()?.();
  }
}

/** Test hooks: toggle pacing and override web config (tests only). */
export function disableSearchPacingForTests(): void {
  pacingEnabled = false;
}

export function configureSearchForTests(p: { enabled?: boolean; cfg?: Partial<WebCfg> | null } = {}): void {
  if (p.enabled !== undefined) pacingEnabled = p.enabled;
  cfgOverride = p.cfg ?? null;
  lastCallAt = 0;
  active = 0;
  slotWaiters.length = 0;
}

/** Paced gate under test — production code always goes through searxSearch. */
export function searchPacedForTests<T>(fn: () => Promise<T>): Promise<T> {
  return paced(fn);
}

/** Cached real hits; expires after RESULT_TTL_MS. */
function cacheGet<T extends WebSearchOutcome | NewsSearchOutcome>(key: string): T | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return hit.out as T;
}

/** Store a real hit (count>0); an honest zero stays uncached and retryable. */
function cachePut<T extends WebSearchOutcome | NewsSearchOutcome>(key: string, out: T): T {
  if (out.count > 0) {
    resultCache.set(key, { out, at: Date.now() });
    if (resultCache.size > MAX_RESULT_CACHE) {
      const oldest = resultCache.keys().next().value;
      if (oldest) resultCache.delete(oldest);
    }
  }
  return out;
}
const resultCache = new Map<string, { out: WebSearchOutcome | NewsSearchOutcome; at: number }>();

/** SearXNG returns ISO strings; tolerate epoch seconds just in case. */
function normalizeDate(date: unknown): string | undefined {
  if (typeof date === "number" && Number.isFinite(date)) {
    try {
      return new Date(date * 1000).toISOString();
    } catch {
      return undefined;
    }
  }
  if (typeof date === "string" && date.trim()) return date;
  return undefined;
}

/** Tags off, common entities decoded, whitespace collapsed — shared with web_fetch. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a look-back window in days to SearXNG's time_range (absent = no filter). */
function recencyToTimeRange(days?: number): string | undefined {
  if (!days || days <= 0) return undefined;
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return undefined;
}

/**
 * One bounded query against the local SearXNG. Returns parsed JSON or null
 * (never throws): connection refused, 403 (format=json not enabled), a slow
 * or hung container — all degrade to the caller's honest zero. Budget is
 * PER ATTEMPT and starts when the pacing slot is granted: queue waits belong
 * to the gate (batch tails at 750ms spacing used to blow an entry-based
 * shared deadline and log scary timeouts mid-run).
 */
async function searxQuery(params: { q: string; categories?: string; time_range?: string }): Promise<Record<string, any> | null> {
  const cfg = currentCfg();
  let lastErr = "";
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    if (attempt > 0 && cfg.retryGapMs > 0) await sleep(cfg.retryGapMs);
    try {
      const url = new URL(cfg.baseUrl.replace(/\/+$/, "") + "/search");
      url.searchParams.set("q", params.q);
      url.searchParams.set("format", "json");
      if (params.categories) url.searchParams.set("categories", params.categories);
      if (params.time_range) url.searchParams.set("time_range", params.time_range);
      const res = await paced(() =>
        fetch(url.toString(), {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(cfg.timeoutMs),
        }),
      );
      if (res.ok) return (await res.json()) as Record<string, any>;
      lastErr = `status ${res.status}`;
      if (res.status === 403 || res.status === 404) {
        // Config error (JSON format disabled / wrong path) — retrying won't help.
        lastErr += " (is format=json enabled in searxng/settings.yml?)";
        break;
      }
    } catch (e: any) {
      lastErr = e?.message || String(e);
      if (e?.cause?.code === "ECONNREFUSED") {
        lastErr += " — SearXNG not reachable, run `npm run searxng` (or docker start searxng)";
        break; // container down — retrying within the same run won't help
      }
      if (e?.name === "TimeoutError" || /timed? ?out|timeout/i.test(lastErr)) {
        lastErr += " — slow instance or suspended engines; returning empty";
        break; // a slow instance stays slow — retrying just burns the caller's step
      }
    }
  }
  log.warn("websearch", `searxng gave up: ${lastErr}`);
  return null;
}

/** Map SearXNG rows to the tool contract; malformed rows are skipped. */
function toResults(items: unknown[], max: number, withSource: boolean): NewsSearchResult[] {
  const results: NewsSearchResult[] = [];
  for (const raw of items) {
    if (results.length >= max) break;
    const it = raw as Record<string, unknown> | null;
    if (!it) continue;
    const title = stripTags(String(it.title || ""));
    const url = String(it.url || "");
    if (!title || !/^https?:/i.test(url)) continue;
    const content = stripTags(String(it.content || "")).slice(0, MAX_SNIPPET_CHARS);
    const source = withSource ? stripTags(String(it.source || "")) : "";
    results.push({
      title,
      url,
      ...(normalizeDate(it.publishedDate) ? { published_date: normalizeDate(it.publishedDate) } : {}),
      ...(content ? { content } : {}),
      ...(withSource && source ? { source } : {}),
    });
  }
  return results;
}

/**
 * Free web search — the local SearXNG's general category. Bounded by
 * web.timeoutMs; an unreachable instance yields count 0, never a throw.
 */
export async function searxSearch(
  query: string,
  opts?: { recencyDays?: number },
): Promise<WebSearchOutcome> {
  query = query.trim().slice(0, MAX_QUERY_CHARS);
  const time_range = recencyToTimeRange(opts?.recencyDays);
  const cacheKey = `web|${time_range ?? ""}|${query}`;
  const cached = cacheGet<WebSearchOutcome>(cacheKey);
  if (cached) return cached;
  const data = await searxQuery({ q: query, time_range });
  const results = data ? toResults(Array.isArray(data.results) ? data.results : [], MAX_RESULTS, false) : [];
  return cachePut(cacheKey, { query, provider: "searxng", count: results.length, results });
}

/** Free news search — same endpoint, categories=news, max 10 stories. */
export async function searxNewsSearch(
  query: string,
  opts?: { recencyDays?: number },
): Promise<NewsSearchOutcome> {
  query = query.trim().slice(0, MAX_QUERY_CHARS);
  const time_range = recencyToTimeRange(opts?.recencyDays);
  const cacheKey = `news|${time_range ?? ""}|${query}`;
  const cached = cacheGet<NewsSearchOutcome>(cacheKey);
  if (cached) return cached;
  const data = await searxQuery({ q: query, categories: "news", time_range });
  const results = data ? toResults(Array.isArray(data.results) ? data.results : [], MAX_NEWS_RESULTS, true) : [];
  return cachePut(cacheKey, { query, provider: "searxng", count: results.length, results });
}

/** The one entry point the web_search tool calls. */
export async function webSearch(
  query: string,
  opts?: { recencyDays?: number },
): Promise<WebSearchOutcome> {
  return searxSearch(query, { recencyDays: opts?.recencyDays });
}

/** The one entry point the search_news tool calls. */
export async function newsSearch(
  query: string,
  opts?: { recencyDays?: number },
): Promise<NewsSearchOutcome> {
  return searxNewsSearch(query, { recencyDays: opts?.recencyDays });
}

/** Tool-result shape for news: untrusted-wrapped, publisher first. */
export function newsToToolResult(out: NewsSearchOutcome): Record<string, unknown> {
  if (out.count === 0) {
    return {
      message:
        `News search returned no stories for this query in the requested window. ` +
        `News runs on the local SearXNG instance — if the container is down (\`npm run searxng\`) results are empty; ` +
        `retry once with a simpler query, then rely on other tools.`,
      query: out.query,
      count: 0,
      results: [],
    };
  }
  return {
    query: out.query,
    provider: out.provider,
    count: out.count,
    results: out.results.map((r) => ({
      title: r.title,
      url: r.url,
      source: r.source,
      published_date: r.published_date,
      content: r.content ? wrapUntrusted("news search", r.content) : undefined,
    })),
  };
}

/** Tool-result shape: untrusted-wrapped content, capped, model-readable. */
export function toToolResult(out: WebSearchOutcome): Record<string, unknown> {
  if (out.count === 0) {
    return {
      message:
        `Web search returned no results for this query. ` +
        `Search runs on the local SearXNG instance — if the container is down (\`npm run searxng\`) results are empty; ` +
        `retry once with a simpler query if you expected coverage.`,
      query: out.query,
      count: 0,
      results: [],
    };
  }
  return {
    query: out.query,
    provider: out.provider,
    count: out.count,
    results: out.results.map((r) => ({
      title: r.title,
      url: r.url,
      published_date: r.published_date,
      content: r.content ? wrapUntrusted("web search", r.content) : undefined,
    })),
  };
}
