/**
 * Live probes for the navbar's "Data sources" chips. One honest upstream
 * call per source (SearXNG search with format=json, a Yahoo quote), never
 * throws — a dead source is just `ok:false` with the reason. The route
 * caches for a minute so a page load can't hammer Yahoo.
 */

import { yf } from "./harness/tools/builtins/yahoo.js";
import { webCfg } from "./harness/tools/search.js";

export interface SourceStatus {
  ok: boolean;
  href: string;
  error?: string;
}
export type SourceStatuses = Record<string, SourceStatus>;

/** Test seam — vitest stubs these; production uses the real ones. */
export interface ProbeDeps {
  fetchImpl?: typeof fetch;
  quote?: (symbol: string) => Promise<unknown>;
}

// SearXNG's JSON search fans out to upstream engines — a live instance can
// take several seconds, and a false "disconnected" chip is worse than a slow one.
const TIMEOUT_MS = 10_000;
const TTL_MS = 60_000;

const HREFS = {
  searxng: "https://github.com/searxng/searxng",
  yahoo: "https://github.com/ranaroussi/yfinance",
};

const shortErr = (e: unknown): string => String((e as Error)?.message || e).slice(0, 160);

async function probeFetch(fetchImpl: typeof fetch, url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

export async function probeSources(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const quote = deps.quote ?? ((symbol: string) => yf.quote(symbol));

  // Same URL resolution the search tool uses (agent.yaml web.baseUrl,
  // SEARXNG_URL env wins) — a chip must not disagree with the tool.
  const searxngUrl = `${webCfg().baseUrl.replace(/\/+$/, "")}/search?q=news&format=json`;

  const [searxng, yahoo] = await Promise.all([
    probeFetch(fetchImpl, searxngUrl),
    // Promise.resolve().then so a sync throw from a stubbed quote lands in the handler.
    Promise.resolve()
      .then(() => quote("AAPL"))
      .then(
        () => ({ ok: true as const }),
        (e) => ({ ok: false as const, error: shortErr(e) }),
      ),
  ]);

  return {
    searxng: { ...searxng, href: HREFS.searxng },
    yahoo: { ...yahoo, href: HREFS.yahoo },
  };
}

let cache: { at: number; value: SourceStatuses } | null = null;

/** Cached view for the route — upstreams get probed at most once a minute. */
export async function getSourceStatuses(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await probeSources(deps);
  cache = { at: Date.now(), value };
  return value;
}
