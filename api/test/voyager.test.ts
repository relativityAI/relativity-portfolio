import { afterEach, describe, expect, it } from "vitest";
import { VoyagerClient, pullLastPulled, pullRecordCount } from "../src/voyager.js";

let stubbedFetch: typeof fetch | undefined;
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  stubbedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}
function restoreFetch() {
  if (stubbedFetch) {
    globalThis.fetch = stubbedFetch;
    stubbedFetch = undefined;
  }
}
afterEach(restoreFetch);

describe("pullRecordCount / pullLastPulled (GET /pull shape)", () => {
  it("reads total_records + record_counts from the real API shape", () => {
    const status = {
      total_records: 33,
      record_counts: { income_statements: 11, balance_sheets: 11, cash_flows: 11 },
    };
    expect(pullRecordCount(status)).toBe(33);
  });

  it("falls back to legacy collections shape for old stored rows", () => {
    const legacy = { collections: { financials: { records: 10 }, shareholdings: { records: 3 } } };
    expect(pullRecordCount(legacy)).toBe(13);
  });

  it("returns 0 for null and prefers total_records", () => {
    expect(pullRecordCount(null)).toBe(0);
    expect(pullRecordCount({})).toBe(0);
    expect(pullRecordCount({ total_records: 0, record_counts: { x: 5 } })).toBe(0);
  });

  it("reads last_pull (the real field)", () => {
    expect(pullLastPulled({ last_pull: "2026-09-13T07:42:41Z" })).toBe("2026-09-13T07:42:41Z");
    expect(pullLastPulled({ last_pulled: "legacy" })).toBe("legacy");
  });
});

describe("VoyagerClient resilience", () => {
  it("retries a 503 (cold start) and returns the eventual 200", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: "cold start" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new VoyagerClient("https://voyager.example", "vgr_test", 0);
    const data = await client.get("/healthz");
    expect(data).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it("retries network errors", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed (temporary DNS)");
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new VoyagerClient("https://voyager.example", undefined, 0);
    await expect(client.get("/healthz")).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it("does not retry 404s (legitimate no-data)", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return new Response(JSON.stringify({ detail: "No data found for NOPE" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new VoyagerClient("https://voyager.example", "vgr_test", 0);
    await expect(client.get("/financials", { symbol: "NOPE", source: "nse" })).rejects.toThrow(
      "No data found for NOPE",
    );
    expect(calls).toBe(1);
  });

  it("gives up after retries on persistent 503, preserving the status", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return new Response(JSON.stringify({ detail: "rate limit reached" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new VoyagerClient("https://voyager.example", "vgr_test", 0);
    // Delays are 700ms + 1.4s + 2.8s ≈ 5s worst case for this test.
    await expect(client.get("/pull")).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(4); // 1 initial + 3 retries
  });

  it("does not forward country to /pull (accepted params only)", async () => {
    let url = "";
    stubFetch((u) => {
      url = u;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = new VoyagerClient("https://voyager.example", "vgr_test", 0);
    await client.getPullStatus("LEN", "us", "sec");
    expect(url).toContain("symbol=LEN");
    expect(url).toContain("source=sec");
    expect(url).not.toContain("country");
  });
});