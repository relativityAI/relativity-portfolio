import { describe, it, expect } from "vitest";
import { projectSections } from "../src/tools.js";

const sample = {
  as_of: "2026-01-01",
  sections: {
    trend_analysis: { status: "ok", data: [1] },
    momentum_analysis: { status: "ok", data: [2] },
    volume_analysis: { status: "unavailable", data: null },
  },
};

describe("projectSections", () => {
  it("keeps only the requested sections and preserves other top-level keys", () => {
    expect(projectSections(sample, "trend_analysis, volume_analysis")).toEqual({
      as_of: "2026-01-01",
      sections: {
        trend_analysis: { status: "ok", data: [1] },
        volume_analysis: { status: "unavailable", data: null },
      },
    });
  });

  it("returns the payload unchanged when no names are requested", () => {
    expect(projectSections(sample)).toBe(sample);
    expect(projectSections(sample, "")).toBe(sample);
    expect(projectSections(sample, "  ,  ")).toBe(sample);
  });

  it("drops unknown names and tolerates a payload with no sections", () => {
    expect(projectSections(sample, "nope")).toEqual({ as_of: "2026-01-01", sections: {} });
    expect(projectSections({ as_of: "x" } as any, "trend_analysis")).toEqual({ as_of: "x" });
  });
});
