/**
 * Local SearXNG search tests: request contract (format=json, recency →
 * time_range, news categories), row mapping, caching, and the failure
 * discipline that broke the last real run — a dead or hung instance must
 * return an honest zero fast (bounded attempts + whole-call budget), never
 * throw into an agent loop.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  configureSearchForTests,
  disableSearchPacingForTests,
  newsSearch,
  newsToToolResult,
  searxNewsSearch,
  searxSearch,
  toToolResult,
  webSearch,
} from "../src/harness/index.js";

let stubbedFetch: typeof fetch | undefined;
const calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  calls.length = 0;
  stubbedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}
function restoreFetch() {
  if (stubbedFetch) {
    globalThis.fetch = stubbedFetch;
    stubbedFetch = undefined;
  }
}
afterEach(restoreFetch);

beforeAll(() => {
  // Production pacing only slows stubbed suites down; budgets are set
  // per test that cares.
  disableSearchPacingForTests();
});

const SEARX_JSON = {
  results: [
    {
      url: "https://example.com/fy2025",
      title: "Apple FY2025 results",
      content: "Revenue $416.2B",
      publishedDate: "2026-10-20T00:00:00",
    },
    { url: "https://example.com/two", title: "Second <b>result</b>", content: "snippet two" },
    // Malformed rows are skipped, never crash the parse:
    { title: "no url", url: "ftp://bad" },
    null,
  ],
};

const NEWS_JSON = {
  results: [
    {
      url: "https://example.com/reliance-beats",
      title: "Reliance beats quarterly estimates",
      content: "Revenue rose 14.7% year over year.",
      publishedDate: "2026-09-20T21:00:00Z",
      source: "Reuters",
    },
    {
      url: "https://example.com/amzn-valuation",
      title: "Amazon valuation checks",
      content: "All values in USD.",
      publishedDate: 1790000000, // epoch tolerated → ISO
      source: "Bloomberg",
    },
    { title: "no url", url: "ftp://bad" },
    null,
  ],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("searxSearch (local SearXNG contract)", () => {
  it("queries /search with format=json and maps rows", async () => {
    stubFetch(() => json(SEARX_JSON));
    const out = await searxSearch("apple fiscal 2025 results");
    expect(out.provider).toBe("searxng");
    expect(out.count).toBe(2);
    expect(out.results[0].title).toBe("Apple FY2025 results");
    expect(out.results[0].published_date).toBe("2026-10-20T00:00:00");
    // HTML in titles/snippets is stripped
    expect(out.results[1].title).toBe("Second result");

    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/search");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("q")).toBe("apple fiscal 2025 results");
    expect(u.searchParams.get("categories")).toBeNull();
    expect(u.searchParams.get("time_range")).toBeNull();
  });

  it("maps recencyDays to time_range (day/week/month, none beyond 31)", async () => {
    stubFetch(() => json({ results: [] }));
    await searxSearch("q-time-1d", { recencyDays: 1 });
    await searxSearch("q-time-3d", { recencyDays: 3 });
    await searxSearch("q-time-14d", { recencyDays: 14 });
    await searxSearch("q-time-60d", { recencyDays: 60 });
    const ranges = calls.map((c) => new URL(c.url).searchParams.get("time_range"));
    expect(ranges).toEqual(["day", "week", "month", null]);
  });

  it("clamps queries to the 100-char contract", async () => {
    stubFetch(() => json({ results: [] }));
    await searxSearch(`long query padding ${"x".repeat(200)}`);
    expect(new URL(calls[0].url).searchParams.get("q")).toHaveLength(100);
  });

  it("serves a repeated query from cache — one request, identical rows", async () => {
    let served = 0;
    stubFetch(() => {
      served++;
      return json(SEARX_JSON);
    });
    const first = await searxSearch("apple cache five year");
    const second = await searxSearch("apple cache five year");
    expect(first.count).toBe(2);
    expect(second.results).toEqual(first.results);
    expect(served).toBe(1);
  });

  it("only ever talks to the configured instance (no third-party search APIs)", async () => {
    stubFetch(() => json(SEARX_JSON));
    await webSearch("provider check web");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(/tavily|serpapi|google\.com\/search|duckduckgo/i.test(c.url)).toBe(false);
      expect(new URL(c.url).pathname).toBe("/search");
    }
  });
});

describe("searxNewsSearch (news category)", () => {
  it("queries the same endpoint with categories=news and maps publishers", async () => {
    stubFetch(() => json(NEWS_JSON));
    const out = await searxNewsSearch("reliance quarterly results", { recencyDays: 14 });
    expect(out.provider).toBe("searxng");
    expect(out.count).toBe(2);
    expect(out.results[0].source).toBe("Reuters");
    expect(out.results[0].published_date).toBe("2026-09-20T21:00:00Z");
    // epoch-seconds dates normalize to ISO
    expect(out.results[1].published_date).toBe(new Date(1790000000 * 1000).toISOString());

    const u = new URL(calls[0].url);
    expect(u.searchParams.get("categories")).toBe("news");
    expect(u.searchParams.get("time_range")).toBe("month"); // 14 days
    // web and news cache separately for the same query text
    await searxSearch("reliance quarterly results", { recencyDays: 14 });
    expect(calls.length).toBe(2);
  });
});

describe("failure discipline (honest zero, bounded time)", () => {
  it("connection refused → zero results, no throw, stops immediately", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    const out = await searxSearch("dead container check");
    expect(out.count).toBe(0);
    expect(out.results).toEqual([]);
    expect(calls.length).toBe(1); // ECONNREFUSED → no pointless retry
  });

  it("HTTP 403 (format=json not enabled) → zero results, no retry", async () => {
    stubFetch(() => new Response("Forbidden", { status: 403 }));
    const out = await searxSearch("forbidden instance check");
    expect(out.count).toBe(0);
    expect(calls.length).toBe(1);
  });

  it("a hung instance is cut by the per-attempt budget — one try, no retry", async () => {
    configureSearchForTests({ enabled: false, cfg: { timeoutMs: 120, maxAttempts: 2, retryGapMs: 0 } });
    try {
      stubFetch(
        (_url, init) =>
          new Promise<Response>((_res, rej) => {
            // honor the abort signal the way a real fetch does
            init?.signal?.addEventListener("abort", () => rej((init!.signal as AbortSignal).reason));
          }),
      );
      const started = Date.now();
      const out = await searxSearch("hung instance check");
      const elapsed = Date.now() - started;
      expect(out.count).toBe(0);
      expect(calls.length).toBe(1); // TimeoutError → no pointless second 15s wait
      expect(elapsed).toBeLessThan(5000);
    } finally {
      configureSearchForTests({ enabled: false, cfg: null });
    }
  });

  it("queue waits don't eat the fetch budget (clock starts when the slot is granted)", async () => {
    // Regression: the old entry-based shared deadline counted gate waits —
    // the tail of a paced batch timed out before its fetch even started.
    configureSearchForTests({ enabled: true, cfg: { minIntervalMs: 300, maxConcurrent: 1, timeoutMs: 150, maxAttempts: 1, retryGapMs: 0 } });
    try {
      stubFetch(
        (_url, init) =>
          new Promise<Response>((res, rej) => {
            const t = setTimeout(() => res(json(SEARX_JSON)), 30);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              rej((init!.signal as AbortSignal).reason);
            });
          }),
      );
      const [a, b] = await Promise.all([searxSearch("queue gate alpha"), searxSearch("queue gate beta")]);
      expect(a.count).toBe(2);
      // b waited ≥300ms behind the gate yet still got its full 150ms inside it
      expect(b.count).toBe(2);
      expect(calls.length).toBe(2);
    } finally {
      configureSearchForTests({ enabled: false, cfg: null });
    }
  });

  it("the zero-result tool message points at the container", async () => {
    const res = toToolResult({ query: "x", provider: "searxng", count: 0, results: [] });
    expect(String(res.message)).toContain("searxng");
    const news = newsToToolResult({ query: "x", provider: "searxng", count: 0, results: [] });
    expect(String(news.message)).toContain("searxng");
  });
});

describe("entry points", () => {
  it("webSearch and newsSearch route through SearXNG only", async () => {
    stubFetch(() => json(SEARX_JSON));
    const web = await webSearch("entry web check");
    const news = await newsSearch("entry news check");
    expect(web.provider).toBe("searxng");
    expect(news.provider).toBe("searxng");
    expect(calls.every((c) => new URL(c.url).pathname === "/search")).toBe(true);
  });
});
