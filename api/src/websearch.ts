/**
 * websearch — free default web search via DuckDuckGo, plus optional Tavily.
 *
 * Research (search-first): DuckDuckGo exposes a plain-HTML results endpoint,
 * html.duckduckgo.com/html/, that needs NO API key and NO vqd token handshake
 * — one POST returns a parseable SERP. That makes DDG the zero-config default
 * web search; a configured Tavily key upgrades the same tool to better-quality
 * content extraction. Rate-limit discipline mirrors the ddgs ecosystem: a
 * process-wide minimum interval between DDG requests, one retry with backoff
 * on soft blocks, and randomized jitter so concurrent analysts never fire
 * together.
 *
 * News search (same research): apart from web results, DDG also exposes a
 * dedicated news vertical at https://duckduckgo.com/news.js — a GET returning
 * JSON. Unlike the HTML endpoint it DOES require a vqd token ("validation
 * query digest", DDG's bot-protection nonce), which is scraped from the HTML
 * of https://duckduckgo.com/?q=<query> (vqd="..." / vqd=...& / vqd='...').
 * Payload: l=<region> o=json noamp=1 q=<query> vqd=<token> p=<safesearch>
 * plus optional df=<d|w|m> recency filter and s=<offset> pagination (30/page).
 * Each result carries { date (epoch seconds or ISO), title, excerpt, url,
 * image, source }. The vqd is cached briefly per query — DDG serves the same
 * digest for a query and minting one costs an extra request.
 */

import { wrapUntrusted } from "./tools.js";
import { log } from "./logger.js";

export interface WebSearchResult {
  title: string;
  url: string;
  published_date?: string;
  content?: string;
}

export interface WebSearchOutcome {
  query: string;
  provider: "duckduckgo" | "tavily";
  count: number;
  results: WebSearchResult[];
}

/** One news story: the same shape web results use, plus the publisher. */
export interface NewsSearchResult extends WebSearchResult {
  source?: string;
}

export interface NewsSearchOutcome {
  query: string;
  provider: "duckduckgo" | "tavily";
  count: number;
  results: NewsSearchResult[];
}

const MAX_SNIPPET_CHARS = 2000;
const MAX_RESULTS = 5;
const MAX_NEWS_RESULTS = 10;
const MIN_INTERVAL_MS = 3500; // one DDG request per process at most every ~3.5s
const SEARCH_TIMEOUT_MS = 25_000;
// vqd tokens are per-query and stable for a while — cache to avoid one extra
// duckduckgo.com round-trip per news call.
const VQD_CACHE_TTL_MS = 10 * 60 * 1000;
const vqdCache = new Map<string, { vqd: string; at: number }>();

let lastDdgCallAt = 0;
let ddgQueue: Promise<void> = Promise.resolve();
// Test escape hatch: vitest stubs fetch, so the production pacing (which
// spaces real DDG calls 3.5s apart) only slows suites down. Exported via the
// test hook below.
let pacingEnabled = true;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialize + pace DDG calls process-wide (concurrent analysts share one IP). */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = ddgQueue.then(async () => {
    const wait = pacingEnabled ? lastDdgCallAt + MIN_INTERVAL_MS - Date.now() : 0;
    if (wait > 0) await sleep(wait);
    lastDdgCallAt = Date.now();
  });
  ddgQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(fn);
}

/** Disable the process-wide DDG pacing (tests only). */
export function disableDdgPacingForTests(): void {
  pacingEnabled = false;
}

/**
 * Mint a vqd token for a query by fetching duckduckgo.com's landing page and
 * scraping the digest DDG embedded for its JS clients. Mirrors the ddgs
 * library's _extract_vqd: try vqd="…", vqd=…& and vqd='…' byte patterns.
 */
async function getVqd(query: string): Promise<string | null> {
  const cached = vqdCache.get(query);
  if (cached && Date.now() - cached.at < VQD_CACHE_TTL_MS) return cached.vqd;
  try {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("websearch", `vqd fetch failed: status ${res.status}`);
      return null;
    }
    const html = await res.text();
    let vqd = "";
    for (const re of [/vqd="([\w-]+)"/, /vqd=([\w-]+)&/, /vqd='([\w-]+)'/]) {
      const m = re.exec(html);
      if (m) {
        vqd = m[1];
        break;
      }
    }
    if (!vqd) {
      log.warn("websearch", "vqd token not found in duckduckgo.com response");
      return null;
    }
    vqdCache.set(query, { vqd, at: Date.now() });
    if (vqdCache.size > 200) {
      // Bound the cache: drop the oldest entry when it grows unwieldy.
      const oldest = vqdCache.keys().next().value;
      if (oldest) vqdCache.delete(oldest);
    }
    return vqd;
  } catch (e: any) {
    log.warn("websearch", `vqd fetch error: ${e?.message || e}`);
    return null;
  }
}

/** news.js returns epoch seconds for fresh stories and ISO strings otherwise. */
function normalizeNewsDate(date: unknown): string | undefined {
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

/**
 * Free news search against DuckDuckGo's news.js endpoint — no API key. One
 * vqd handshake, then a GET returning JSON stories { date, title, excerpt,
 * url, image, source }.
 */
export async function ddgNewsSearch(
  query: string,
  opts?: { region?: string; recencyDays?: number },
): Promise<NewsSearchOutcome> {
  // us-en covers both tracked markets' English coverage; ddgs' region format.
  const region = opts?.region || "us-en";
  const doFetch = async (vqd: string): Promise<Response> => {
    const params = new URLSearchParams({
      l: region,
      o: "json",
      noamp: "1",
      q: query,
      vqd,
      p: "-1", // moderate safesearch
    });
    const df = recencyToDf(opts?.recencyDays);
    if (df) params.set("df", df);
    return fetch(`https://duckduckgo.com/news.js?${params.toString()}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://duckduckgo.com/",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  };

  // Same soft-block discipline as web search: one paced retry. A failed vqd
  // handshake or a blocked news.js call yields zero results (tool degrades,
  // never throws into the analyst loop).
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const vqd = await getVqd(query);
    if (!vqd) {
      lastErr = "no vqd token";
      break;
    }
    try {
      const r = await paced(() => doFetch(vqd));
      if (r.ok) {
        res = r;
        break;
      }
      lastErr = `status ${r.status}`;
      // A stale/rejected vqd surfaces as 403 — remint once on the retry.
      vqdCache.delete(query);
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
    if (attempt === 0) await sleep(2000 + Math.random() * 1500);
  }
  if (!res) {
    log.warn("websearch", `duckduckgo news failed: ${lastErr}`);
    return { query, provider: "duckduckgo", count: 0, results: [] };
  }

  try {
    const data = await res.json();
    const items: any[] = Array.isArray(data?.results) ? data.results : [];
    const results: NewsSearchResult[] = [];
    for (const it of items) {
      if (results.length >= MAX_NEWS_RESULTS) break;
      const title = stripTags(String(it?.title || ""));
      const url = String(it?.url || "");
      if (!title || !/^https?:/i.test(url)) continue;
      const excerpt = stripTags(String(it?.excerpt || "")).slice(0, MAX_SNIPPET_CHARS);
      results.push({
        title,
        url,
        published_date: normalizeNewsDate(it?.date),
        source: stripTags(String(it?.source || "")) || undefined,
        ...(excerpt ? { content: excerpt } : {}),
      });
    }
    return { query, provider: "duckduckgo", count: results.length, results };
  } catch (e: any) {
    log.warn("websearch", `duckduckgo news parse failed: ${e?.message || e}`);
    return { query, provider: "duckduckgo", count: 0, results: [] };
  }
}

/** Map a look-back window in days to DDG's df filter (d=1d, w=1w, m=1mo). */
function recencyToDf(days?: number): string | undefined {
  if (!days || days <= 1) return "d";
  if (days <= 7) return "w";
  if (days <= 31) return "m";
  return undefined;
}

function decodeDdgHref(href: string): string {
  // Results arrive wrapped as /l/?uddg=<encoded real url> — unwrap them.
  if (!href) return href;
  if (href.startsWith("//")) href = `https:${href}`;
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    return u.toString();
  } catch {
    return href;
  }
}

function stripTags(html: string): string {
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

/**
 * Free web search against DuckDuckGo's HTML endpoint — no API key, no vqd
 * handshake. One POST with the query; results parsed from the .result rows.
 */
export async function ddgSearch(query: string, opts?: { region?: string }): Promise<WebSearchOutcome> {
  const region = opts?.region || "wt-wt";
  const doFetch = async (): Promise<Response> => {
    const body = new URLSearchParams({ q: query, kl: region, df: "m" });
    return fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  };

  let res: Response | null = null;
  let lastErr = "";
  // Soft blocks (DDG's 202 / anomaly pages) are transient: one paced retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await paced(doFetch);
      if (r.ok) {
        res = r;
        break;
      }
      lastErr = `status ${r.status}`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
    if (attempt === 0) await sleep(2000 + Math.random() * 1500);
  }
  if (!res) {
    log.warn("websearch", `duckduckgo failed: ${lastErr}`);
    return { query, provider: "duckduckgo", count: 0, results: [] };
  }

  const html = await res.text();
  const results: WebSearchResult[] = [];
  // Each organic result lives in a .result row with an a.result__a title link
  // and a .result__snippet body (plain no-JS HTML, stable classes).
  const rowRe = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b[^"]*"|<div[^>]*class="[^"]*nav-link|$)/gi;
  const titleRe = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRe = /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  for (const rowMatch of html.matchAll(rowRe)) {
    if (results.length >= MAX_RESULTS) break;
    const row = rowMatch[1];
    const t = titleRe.exec(row);
    if (!t) continue;
    const title = stripTags(t[2]);
    const url = decodeDdgHref(t[1]);
    if (!title || !/^https?:/i.test(url)) continue;
    const s = snippetRe.exec(row);
    const snippet = s ? stripTags(s[1]).slice(0, MAX_SNIPPET_CHARS) : "";
    results.push({ title, url, ...(snippet ? { content: snippet } : {}) });
  }
  return { query, provider: "duckduckgo", count: results.length, results };
}

/** Tavily search (richer content extraction) — used when a key is configured. */
export async function tavilySearch(
  query: string,
  tavilyKey: string,
  opts?: { tavilyUrl?: string; webSources?: string[]; recencyDays?: number },
): Promise<WebSearchOutcome> {
  const res = await fetch(opts?.tavilyUrl || "https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query,
      max_results: MAX_RESULTS,
      ...(opts?.recencyDays ? { topic: "news", days: opts.recencyDays } : {}),
      ...(opts?.webSources?.length ? { include_domains: opts.webSources } : {}),
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { query, provider: "tavily", count: 0, results: [] };
  }
  const data = await res.json();
  const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    published_date: r.published_date,
    content: r.content ? String(r.content).slice(0, MAX_SNIPPET_CHARS) : undefined,
  }));
  return { query, provider: "tavily", count: results.length, results };
}

/**
 * Tavily news search (richer extraction) — used when a key is configured.
 * Tavily's `topic: "news"` vertical returns publish dates + source domains.
 */
export async function tavilyNewsSearch(
  query: string,
  tavilyKey: string,
  opts?: { tavilyUrl?: string; recencyDays?: number },
): Promise<NewsSearchOutcome> {
  const res = await fetch(opts?.tavilyUrl || "https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query,
      max_results: MAX_NEWS_RESULTS,
      topic: "news",
      ...(opts?.recencyDays ? { days: opts.recencyDays } : {}),
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { query, provider: "tavily", count: 0, results: [] };
  }
  const data = await res.json();
  const results: NewsSearchResult[] = (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    published_date: r.published_date,
    source: typeof r.source === "string" ? r.source : undefined,
    content: r.content ? String(r.content).slice(0, MAX_SNIPPET_CHARS) : undefined,
  }));
  return { query, provider: "tavily", count: results.length, results };
}

/**
 * The one entry point the search_news tool calls. Tavily when a key exists
 * (richer extraction), DuckDuckGo's news vertical always (free, keyless).
 */
export async function newsSearch(
  query: string,
  opts?: { tavilyKey?: string; recencyDays?: number },
): Promise<NewsSearchOutcome> {
  if (opts?.tavilyKey) {
    try {
      const out = await tavilyNewsSearch(query, opts.tavilyKey, opts);
      if (out.count > 0) return out;
    } catch (e: any) {
      log.warn("websearch", `tavily news failed, falling back to duckduckgo: ${e?.message || e}`);
    }
  }
  return ddgNewsSearch(query, { recencyDays: opts?.recencyDays });
}

/** Tool-result shape for news: untrusted-wrapped, publisher first. */
export function newsToToolResult(out: NewsSearchOutcome, tavilyKey?: string): Record<string, unknown> {
  if (out.count === 0) {
    return {
      message:
        `News search returned no stories for this query in the requested window. ` +
        (tavilyKey ? "" : "News ran on the free DuckDuckGo provider — retry once if this surprised you, then rely on other tools."),
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

/**
 * The one entry point the web_search tool calls. Tavily when a key exists
 * (better extraction), DuckDuckGo always (free, keyless).
 */
export async function webSearch(
  query: string,
  opts?: { tavilyKey?: string; webSources?: string[]; recencyDays?: number },
): Promise<WebSearchOutcome> {
  if (opts?.tavilyKey) {
    try {
      const out = await tavilySearch(query, opts.tavilyKey, opts);
      if (out.count > 0) return out;
    } catch (e: any) {
      log.warn("websearch", `tavily failed, falling back to duckduckgo: ${e?.message || e}`);
    }
  }
  return ddgSearch(query);
}

/** Tool-result shape: untrusted-wrapped content, capped, model-readable. */
export function toToolResult(out: WebSearchOutcome, tavilyKey?: string): Record<string, unknown> {
  if (out.count === 0) {
    return {
      message:
        `Web search returned no results for this query. ` +
        (tavilyKey
          ? ""
          : "Search ran on the free DuckDuckGo provider — retry with a simpler query if you expected coverage."),
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
