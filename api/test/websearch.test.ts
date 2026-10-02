/**
 * News search tool tests (2026-09-29 Voyager report + DDG news vertical):
 * ddgNewsSearch's vqd handshake, payload, date normalization, and the
 * tavily-first fallback chain in newsSearch().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ddgNewsSearch, disableDdgPacingForTests, newsSearch } from "../src/websearch.js";

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
  // The 3.5s process-wide DDG spacing exists for the live endpoint; stubbed
  // tests run back-to-back and would otherwise queue up into timeouts.
  disableDdgPacingForTests();
});

const VQD_PAGE = `<html><script>vqd="4-1234567890abcdef";</script></html>`;
const NEWS_JSON = {
  results: [
    {
      date: 1790000000,
      title: "Reliance beats quarterly estimates",
      excerpt: "Revenue rose 14.7% year over year.",
      url: "https://example.com/reliance-beats",
      image: "https://img.example.com/x.jpg",
      source: "Reuters",
    },
    {
      date: "2026-09-20T21:00:00Z",
      title: "Amazon <b>valuation</b> checks",
      excerpt: "All values in USD.",
      url: "https://example.com/amzn-valuation",
      source: "Bloomberg",
    },
    // Malformed rows are skipped, never crash the parse:
    { title: "no url", excerpt: "", url: "ftp://bad", source: "X" },
    null,
  ],
};

describe("ddgNewsSearch (DDG news vertical)", () => {
  it("mints a vqd token then queries news.js with the documented payload", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://duckduckgo.com/?q=")) {
        return new Response(VQD_PAGE, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify(NEWS_JSON), { status: 200, headers: { "content-type": "application/json" } });
    });

    const out = await ddgNewsSearch("reliance quarterly results", { recencyDays: 14 });
    expect(out.count).toBe(2);
    expect(out.results[0].title).toBe("Reliance beats quarterly estimates");
    expect(out.results[0].source).toBe("Reuters");
    // epoch-seconds dates normalize to ISO
    expect(out.results[0].published_date).toBe(new Date(1790000000 * 1000).toISOString());
    // ISO dates pass through; HTML in titles is stripped
    expect(out.results[1].published_date).toBe("2026-09-20T21:00:00Z");
    expect(out.results[1].title).toBe("Amazon valuation checks");

    const newsUrl = calls.find((c) => c.url.includes("/news.js"))?.url || "";
    expect(newsUrl).toContain("https://duckduckgo.com/news.js?");
    const q = new URL(newsUrl).searchParams;
    expect(q.get("o")).toBe("json");
    expect(q.get("noamp")).toBe("1");
    expect(q.get("vqd")).toBe("4-1234567890abcdef");
    expect(q.get("p")).toBe("-1");
    expect(q.get("df")).toBe("m"); // 14 days → month filter
  });

  it("degrades to zero results (never throws) when the vqd handshake fails", async () => {
    stubFetch(() => new Response("blocked", { status: 403 }));
    const out = await ddgNewsSearch("anything");
    expect(out.count).toBe(0);
    expect(out.results).toEqual([]);
  });

  it("degrades to zero results when news.js soft-blocks twice", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://duckduckgo.com/?q=")) {
        return new Response(VQD_PAGE, { status: 200 });
      }
      return new Response("anomaly detected", { status: 202 });
    });
    const out = await ddgNewsSearch("soft blocked");
    expect(out.count).toBe(0);
  });

  it("maps a 1-7 day window to df=w and >31 days to no filter", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://duckduckgo.com/?q=")) {
        return new Response(VQD_PAGE, { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await ddgNewsSearch("q1", { recencyDays: 3 });
    await ddgNewsSearch("q2", { recencyDays: 60 });
    const u1 = new URL(calls.find((c) => c.url.includes("/news.js") && c.url.includes("q=q1"))!.url);
    const u2 = new URL(calls.find((c) => c.url.includes("/news.js") && c.url.includes("q=q2"))!.url);
    expect(u1.searchParams.get("df")).toBe("w");
    expect(u2.searchParams.get("df")).toBeNull();
  });
});

describe("newsSearch (tavily-first fallback chain)", () => {
  it("falls back to DDG when no tavily key is configured", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://duckduckgo.com/?q=")) {
        return new Response(VQD_PAGE, { status: 200 });
      }
      return new Response(JSON.stringify(NEWS_JSON), { status: 200, headers: { "content-type": "application/json" } });
    });
    const out = await newsSearch("fallback query");
    expect(out.provider).toBe("duckduckgo");
    expect(out.count).toBe(2);
    expect(calls.some((c) => c.url.includes("tavily"))).toBe(false);
  });

  it("uses tavily news when a key exists and it returns results", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            results: [{ title: "Tavily story", url: "https://tavily.example/story", published_date: "2026-09-28", source: "Reuters", content: "body" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const out = await newsSearch("tavily query", { tavilyKey: "tvly-test" });
    expect(out.provider).toBe("tavily");
    expect(out.count).toBe(1);
    expect(out.results[0].source).toBe("Reuters");
    expect(calls.some((c) => c.url.includes("duckduckgo"))).toBe(false);
  });

  it("falls back to DDG when tavily returns nothing", async () => {
    stubFetch((url) => {
      if (url.includes("api.tavily.com")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("https://duckduckgo.com/?q=")) {
        return new Response(VQD_PAGE, { status: 200 });
      }
      return new Response(JSON.stringify(NEWS_JSON), { status: 200, headers: { "content-type": "application/json" } });
    });
    const out = await newsSearch("quarterly results", { tavilyKey: "tvly-test" });
    expect(out.provider).toBe("duckduckgo");
    expect(out.count).toBe(2);
  });
});
