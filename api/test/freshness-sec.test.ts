import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { ensureFreshData } from "../src/freshness.js";
import { VoyagerClient } from "../src/voyager.js";

// ensureFreshData hits Supabase via getDb() for the local freshness check and
// pull-record upserts — mock it out; freshness state comes from the stubs below.
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../src/db.js", () => ({ getDb: () => ({ from }) }));

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

/**
 * Run `fn` under fake timers, advancing past the 5s poll sleeps (and any
 * Voyager retry backoff) until the promise settles.
 */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    let settled = false;
    const p = fn().finally(() => {
        settled = true;
    });
    for (let i = 0; i < 300 && !settled; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
    }
    try {
        return await p;
    } finally {
        vi.useRealTimers();
    }
}

function mockDbNoFreshData() {
    from.mockImplementation((table: string) => {
        if (table === "stock_pulls") {
            return {
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: async () => ({ data: null, error: { code: "PGRST116" } }),
                            }),
                        }),
                    }),
                }),
                upsert: async () => ({ error: null }),
            };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }), upsert: async () => ({ error: null }) };
    });
}

describe("ensureFreshData — SEC pulls (Voyager supports all sources)", () => {
    beforeEach(() => {
        from.mockReset();
        mockDbNoFreshData();
    });

    it("triggers a pull for a SEC symbol when no data exists (was previously gated off)", async () => {
        let sawTrigger = false;
        stubFetch((url, init) => {
            const isPost = (init?.method || "GET") === "POST";
            // POST /pull carries query params (?symbol=…&source=sec&…) — match the path, not the full URL.
            const path = url.split("?")[0];
            if (path.endsWith("/pull") && isPost) {
                sawTrigger = true;
                return new Response(JSON.stringify({ job_id: "job-sec-1", status: "queued", status_url: "/pull/jobs/job-sec-1" }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if (path.includes("/pull/jobs/")) {
                return new Response(JSON.stringify({ job_id: "job-sec-1", status: "done" }), { status: 200, headers: { "content-type": "application/json" } });
            }
            // GET /pull final status
            return new Response(JSON.stringify({ total_records: 42 }), { status: 200, headers: { "content-type": "application/json" } });
        });
        const voyager = new VoyagerClient("http://voyager.test", "k", 60);

        const res = await withFakeTimers(() => ensureFreshData(voyager, "IBM", "us", "sec", "user-1"));
        expect(sawTrigger).toBe(true); // the pull was actually attempted for source=sec
        expect(res.pulled).toBe(true);
    });

    it("still skips the pull when local data is fresh (fast path applies to all sources)", async () => {
        from.mockImplementation((table: string) => {
            if (table === "stock_pulls") {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    single: async () => ({
                                        data: { status: "completed", last_pulled_at: new Date().toISOString() },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    }),
                    upsert: async () => ({ error: null }),
                };
            }
            return { upsert: async () => ({ error: null }) };
        });
        stubFetch(() => new Response(JSON.stringify({ total_records: 0 }), { status: 200, headers: { "content-type": "application/json" } }));
        const voyager = new VoyagerClient("http://voyager.test", "k", 60);

        const res = await ensureFreshData(voyager, "IBM", "us", "sec", "user-1");
        expect(res.pulled).toBe(false);
        expect(res.reason).toContain("fresh");
    });

    it("does not treat SEC as unsupported — no hard-coded gate in the result reason", async () => {
        stubFetch((url, init) => {
            const path = url.split("?")[0];
            if (path.endsWith("/pull") && (init?.method || "GET") === "POST") {
                return new Response(JSON.stringify({ job_id: "j2", status: "queued", status_url: "/pull/jobs/j2" }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if (path.includes("/pull/jobs/")) {
                return new Response(JSON.stringify({ job_id: "j2", status: "done" }), { status: 200, headers: { "content-type": "application/json" } });
            }
            return new Response(JSON.stringify({ total_records: 5 }), { status: 200, headers: { "content-type": "application/json" } });
        });
        const voyager = new VoyagerClient("http://voyager.test", "k", 60);

        const res = await withFakeTimers(() => ensureFreshData(voyager, "AAPL", "us", "sec", "user-1"));
        expect(res.reason || "").not.toContain("only supported for NSE");
    });

    it("surfaces a Voyager trigger error as a non-fatal failed pull", async () => {
        stubFetch((url, init) => {
            const path = url.split("?")[0];
            if (path.endsWith("/pull") && (init?.method || "GET") === "POST") {
                return new Response(JSON.stringify({ detail: "unsupported source" }), {
                    status: 400,
                    headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify({ total_records: 0 }), { status: 200, headers: { "content-type": "application/json" } });
        });
        const voyager = new VoyagerClient("http://voyager.test", "k", 60);

        const res = await withFakeTimers(() => ensureFreshData(voyager, "IBM", "us", "sec", "user-1"));
        expect(res.pulled).toBe(false);
        expect(res.reason).toBeTruthy();
    });
});
