import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveFeatures, persistFeatures, FEATURES_DATA_VERSION } from "../src/kb/features.js";

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("../src/db.js", () => ({ getDb: () => ({ from: () => ({ upsert }) }) }));

describe("deriveFeatures", () => {
  it("canonicalizes pct series from fractions to percent units", () => {
    const { features } = deriveFeatures({ roe_annual: [0.1, 0.22, 0.18] });
    expect(features.roe_annual).toEqual([10, 22, 18]);
  });

  it("keeps percent-scale series as-is", () => {
    const { features } = deriveFeatures({ op_margin: [11, 12, 14] });
    expect(features.op_margin).toEqual([11, 12, 14]);
  });

  it("sorts object-shaped series by key (oldest → newest)", () => {
    const { features } = deriveFeatures({ net_margin: { fy2023: 9, fy2021: 7, fy2022: 8 } });
    expect(features.net_margin).toEqual([7, 8, 9]);
  });

  it("canonicalizes pct scalars and leaves ratio scalars untouched", () => {
    const { features } = deriveFeatures({ roic_ttm: 0.19, net_debt_ebitda: 1.4 });
    expect(features.roic_ttm).toBe(19);
    expect(features.net_debt_ebitda).toBe(1.4);
  });

  it("omits non-computable features and reports them — absent ≠ 0", () => {
    const { features, missing } = deriveFeatures({ roic_ttm: 0.19 });
    expect("roe_annual" in features).toBe(false);
    expect(missing).toContain("roe_annual");
    expect(missing).toContain("net_debt_ebitda");
  });

  it("drops null/non-numeric entries inside series", () => {
    const { features } = deriveFeatures({ op_margin: [11, null, "bad", 14] });
    expect(features.op_margin).toEqual([11, 14]);
  });

  it("is deterministic", () => {
    const snap = { roe_annual: [0.1, 0.2], roic_ttm: 0.19 };
    expect(deriveFeatures(snap)).toEqual(deriveFeatures({ ...snap }));
  });
});

describe("persistFeatures", () => {
  beforeEach(() => upsert.mockReset());

  it("upserts one row keyed by (symbol, source, data_version)", async () => {
    upsert.mockResolvedValue({ error: null });
    const res = await persistFeatures("TEST", "NSE", { roic_ttm: 0.19 }, "2026-03-31");
    expect(res.persisted).toBe(true);
    expect(res.count).toBeGreaterThan(0);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "TEST",
        source: "NSE",
        data_version: FEATURES_DATA_VERSION,
        as_of: "2026-03-31",
      }),
      expect.objectContaining({ onConflict: "symbol,source,data_version" }),
    );
  });

  it("skips the write when no features could be derived", async () => {
    const res = await persistFeatures("TEST", "NSE", {}, null);
    expect(res.persisted).toBe(false);
    expect(res.count).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("degrades to persisted=false on a DB error — never throws", async () => {
    upsert.mockResolvedValue({ error: new Error("db down") });
    const res = await persistFeatures("TEST", "NSE", { roic_ttm: 0.19 }, null);
    expect(res.persisted).toBe(false);
  });
});
