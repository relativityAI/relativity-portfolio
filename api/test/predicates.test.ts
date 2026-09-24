import { describe, it, expect } from "vitest";
import { evaluatePredicate } from "../src/predicates.js";

const ROE = [10, 22, 18, 31, 26];

describe("count_gt", () => {
  it("counts values above x across the last n", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ count_gt: [{ var: "roe_annual" }, 5, 15] }, 3] }, requires: ["roe_annual"] },
      { roe_annual: ROE },
    );
    expect(r.verdict).toBe("YES");
  });

  it("fails when fewer than k qualify", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ count_gt: [{ var: "roe_annual" }, 5, 15] }, 5] }, requires: ["roe_annual"] },
      { roe_annual: ROE },
    );
    expect(r.verdict).toBe("NO");
  });
});

describe("slope", () => {
  it("returns YES for a rising series", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ slope: [{ var: "op_margin" }, 5] }, 0] }, requires: ["op_margin"] },
      { op_margin: [10, 12, 14, 16, 18] },
    );
    expect(r.verdict).toBe("YES");
  });

  it("returns NO for a falling series", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ slope: [{ var: "op_margin" }, 5] }, 0] }, requires: ["op_margin"] },
      { op_margin: [18, 16, 14, 12, 10] },
    );
    expect(r.verdict).toBe("NO");
  });
});

describe("min_last", () => {
  it("checks the floor across the window", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ min_last: [{ var: "net_margin" }, 3] }, 20] }, requires: ["net_margin"] },
      { net_margin: [30, 22, 25] },
    );
    expect(r.verdict).toBe("YES");
    const r2 = evaluatePredicate(
      { expr: { ">=": [{ min_last: [{ var: "net_margin" }, 3] }, 25] }, requires: ["net_margin"] },
      { net_margin: [30, 22, 25] },
    );
    expect(r2.verdict).toBe("NO");
  });
});

describe("pct_change", () => {
  it("computes percent change over n periods", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ pct_change: [{ var: "revenue_annual" }, 3] }, 50] }, requires: ["revenue_annual"] },
      { revenue_annual: [100, 130, 160, 200] },
    );
    // (200 - 100)/100 * 100 = 100% ≥ 50 → YES (value is the boolean comparison)
    expect(r.value).toBe(true);
    expect(r.verdict).toBe("YES");
  });
});

describe("null propagation", () => {
  it("null required feature → INSUFFICIENT, never 0", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] },
      { roe_min_10y: null },
    );
    expect(r.verdict).toBe("INSUFFICIENT");
    expect(r.unscored_reason).toBe("missing_data");
  });

  it("missing required feature → INSUFFICIENT", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] },
      {},
    );
    expect(r.verdict).toBe("INSUFFICIENT");
  });
});

describe("determinism + audit", () => {
  it("same features, same expr → identical byte-for-byte result", () => {
    const p: Parameters<typeof evaluatePredicate>[0] = {
      expr: { ">=": [{ count_gt: [{ var: "roe_annual" }, 5, 15] }, 3] },
      requires: ["roe_annual"],
    };
    const a = evaluatePredicate(p, { roe_annual: ROE });
    const b = evaluatePredicate(p, { roe_annual: ROE });
    expect(a).toEqual(b);
    expect(a.inputs.value).toBe(true);
  });

  it("captures evaluated inputs for audit", () => {
    const r = evaluatePredicate(
      { expr: { ">=": [{ var: "roe_min_10y" }, 12] }, requires: ["roe_min_10y"] },
      { roe_min_10y: 18 },
    );
    expect(r.verdict).toBe("YES");
    expect(r.inputs.expr).toBeDefined();
    expect(r.value).toBe(true);
  });
});