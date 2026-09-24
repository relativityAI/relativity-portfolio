import { describe, it, expect } from "vitest";
import { parseRule, toPercent, unitForMetricType, MIN_SPREAD, FEATURE_KEYS, type Unit } from "../src/units.js";

describe("toPercent", () => {
  it("converts fractions to percent units (0.15 → 15)", () => {
    expect(toPercent(0.15)).toBe(15);
  });

  it("keeps percent-scale inputs as-is (15 → 15)", () => {
    expect(toPercent(15)).toBe(15);
    expect(toPercent("46.6%")).toBe(46.6);
  });

  it("handles strings and zero without distorting", () => {
    expect(toPercent("0.15")).toBe(15);
    expect(toPercent(0)).toBe(0);
    expect(toPercent("12.5%")).toBe(12.5);
  });

  it("returns null for non-numeric input", () => {
    expect(toPercent("not-a-number")).toBeNull();
    expect(toPercent(null)).toBeNull();
  });
});

describe("parseRule", () => {
  it("parses a percent threshold into canonical units", () => {
    const r = parseRule("> 15%", "pct")!;
    expect(r.operator).toBe("gt");
    expect(r.value).toBe(15);
  });

  it("canonicalizes a bare fraction threshold for pct metrics", () => {
    const r = parseRule("> 0.15", "pct")!;
    expect(r.value).toBe(15);
  });

  it("parses between into value_upper", () => {
    const r = parseRule("between 5 and 10")!;
    expect(r.operator).toBe("between");
    expect(r.value).toBe(5);
    expect(r.value_upper).toBe(10);
  });

  it("parses comparison operators", () => {
    expect(parseRule(">= 18")!.operator).toBe("gte");
    expect(parseRule("<= 0.5")!.operator).toBe("lte");
    expect(parseRule("< 25%")!.operator).toBe("lt");
    expect(parseRule("= 1")!.operator).toBe("eq");
  });

  it("rejects garbage", () => {
    expect(parseRule("")).toBeNull();
    expect(parseRule("xyz")).toBeNull();
  });
});

describe("unitForMetricType / MIN_SPREAD", () => {
  it("maps stored types to canonical units", () => {
    expect(unitForMetricType("percentage")).toBe("pct");
    expect(unitForMetricType("currency")).toBe("currency");
    expect(unitForMetricType("number")).toBe("ratio");
  });

  it("has a minimum spread for every unit", () => {
    for (const u of ["pct", "ratio", "currency", "count", "days"] as Unit[]) {
      expect(typeof MIN_SPREAD[u]).toBe("number");
      expect(MIN_SPREAD[u]).toBeGreaterThan(0);
    }
  });
});

describe("FEATURE_KEYS", () => {
  it("registers history features for findMetricId resolution", () => {
    expect(FEATURE_KEYS).toContain("roe_min_10y");
    expect(FEATURE_KEYS).toContain("op_margin_slope_5y");
    expect(FEATURE_KEYS).toContain("piotroski_f");
  });
});