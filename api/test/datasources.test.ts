import { describe, expect, it } from "vitest";
import { probeSources } from "../src/datasources.js";

const up = (() => ({ ok: true })) as unknown as typeof fetch;
const down = (() => {
  throw new Error("ECONNREFUSED");
}) as unknown as typeof fetch;
const fiveOhThree = (() => ({ ok: false, status: 503 })) as unknown as typeof fetch;

describe("probeSources", () => {
  it("marks every source up when the probes succeed", async () => {
    const out = await probeSources({ fetchImpl: up, quote: async () => ({ symbol: "AAPL" }) });
    expect(out.searxng.ok).toBe(true);
    expect(out.yahoo.ok).toBe(true);
    expect(out.searxng.href).toContain("github.com/searxng/searxng");
    expect(out.yahoo.href).toContain("ranaroussi/yfinance");
  });

  it("reports ok:false with the reason when a probe fails", async () => {
    const out = await probeSources({
      fetchImpl: down,
      quote: async () => {
        throw new Error("429 Too Many Requests");
      },
    });
    expect(out.searxng.ok).toBe(false);
    expect(out.searxng.error).toContain("ECONNREFUSED");
    expect(out.yahoo.ok).toBe(false);
    expect(out.yahoo.error).toContain("429");
  });

  it("treats a non-2xx as down but keeps the other sources honest", async () => {
    const out = await probeSources({ fetchImpl: fiveOhThree, quote: async () => ({}) });
    expect(out.searxng.ok).toBe(false);
    expect(out.searxng.error).toContain("503");
    expect(out.yahoo.ok).toBe(true);
  });
});
