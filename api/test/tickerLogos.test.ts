import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Canned Ticker Logos search responses, keyed by the query symbol.
const byQuery: Record<string, any> = {
  RELIANCE: {
    count: 1,
    results: [{ symbol: "RELIANCE.NS", website: "http://www.ril.com", exchange: "NSI" }],
  },
  KEI: {
    count: 3,
    results: [
      { symbol: "KEI.F", website: "http://www.keisei.co.jp", exchange: "FRA" },
      { symbol: "KEI.NS", website: "http://www.kei-ind.com", exchange: "NSI" },
    ],
  },
  MSFT: {
    count: 1,
    results: [{ symbol: "MSFT", website: "https://www.microsoft.com", exchange: "NMS" }],
  },
  FOO: { count: 1, results: [{ symbol: "BAR", website: "http://bar.com", exchange: "XXX" }] },
  NONE: { count: 0, results: [] },
};

let fetchMock: Mock;

async function loadModule() {
  vi.resetModules();
  return import("../src/tickerLogos.js");
}

beforeEach(() => {
  // Hermetic per-test state: fresh persist file, near-zero request spacing,
  // mocked network. The module reads these envs at import time.
  // Temp dir under os.tmpdir() — a bare prefix would create ticker-logos-*
  // folders in the repo cwd (they got committed once already).
  process.env.TICKER_LOGOS_CACHE_FILE = path.join(mkdtempSync(path.join(tmpdir(), "ticker-logos-")), "cache.json");
  process.env.TICKER_LOGOS_SLOT_GAP_MS = "1";

  fetchMock = vi.fn(async (raw: RequestInfo | URL) => {
    const url = String(raw);
    if (url.includes("logo-search")) {
      const q = new URL(url).searchParams.get("q")!.toUpperCase();
      return { ok: true, json: async () => byQuery[q] || { count: 0, results: [] } };
    }
    return {
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => Buffer.from("PNG"),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TICKER_LOGOS_CACHE_FILE;
  delete process.env.TICKER_LOGOS_SLOT_GAP_MS;
});

const searches = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("logo-search"));

describe("tickerLogos", () => {
  it("maps a symbol to the CDN url via exact or .NS match", async () => {
    const { tickerLogoUrl } = await loadModule();
    expect(await tickerLogoUrl("RELIANCE")).toBe("https://cdn.tickerlogos.com/ril.com");
    expect(await tickerLogoUrl("KEI")).toBe("https://cdn.tickerlogos.com/kei-ind.com");
    expect(await tickerLogoUrl("MSFT")).toBe("https://cdn.tickerlogos.com/microsoft.com");
  });

  it("returns null (never a loose guess) when there is no exact or .NS match", async () => {
    const { tickerLogoUrl } = await loadModule();
    expect(await tickerLogoUrl("FOO")).toBeNull(); // only BAR exists
    expect(await tickerLogoUrl("NONE")).toBeNull(); // empty results
    expect(await tickerLogoUrl("")).toBeNull(); // empty symbol, no fetch
    expect(await tickerLogoUrl()).toBeNull();
    expect(searches()).toHaveLength(2);
  });

  it("caches lookups so a repeated symbol costs no search call", async () => {
    const { tickerLogoUrl } = await loadModule();
    await tickerLogoUrl("PATANJALI");
    await tickerLogoUrl("PATANJALI");
    expect(searches()).toHaveLength(1);
  });

  it("survives a server restart by re-using the persisted map (no re-fetch)", async () => {
    const first = await loadModule();
    await first.tickerLogoUrl("RELIANCE");
    // Let the 2s debounced disk write happen before "rebooting".
    await new Promise((r) => setTimeout(r, 2100));

    // A "restart": fresh module scope (same persisted cache file). RELIANCE
    // must resolve from disk without touching the search API again.
    const second = await loadModule();
    expect(await second.tickerLogoUrl("RELIANCE")).toBe("https://cdn.tickerlogos.com/ril.com");
    expect(searches()).toHaveLength(1);
  });

  it("returns the logo bytes as a data URI for the PDF", async () => {
    const { tickerLogoDataUri } = await loadModule();
    const uri = await tickerLogoDataUri("MSFT");
    expect(uri).toBe("data:image/png;base64,UE5H");
  });
});