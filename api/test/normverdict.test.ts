import { describe, it, expect } from "vitest";
import { normVerdict } from "../src/skills/skillrun.js";

// The live KEI failure: get_technicals returned 60 sections and every anchor
// still came back "No data", so the run scored 0 of 5 and published an
// unavailable notice. The cause was exact-match verdict normalisation — any
// token that was not literally YES/PARTIAL/NO collapsed to INSUFFICIENT.
describe("normVerdict", () => {
  it.each(["YES", "yes", " Yes ", "TRUE", "SUPPORTED", "SUPPORTS", "CONFIRMED", "MET", "VALID"])(
    "reads %s as YES",
    (v) => expect(normVerdict(v)).toBe("YES"),
  );

  it.each(["NO", "no", "NOT CONFIRMED", "FAILS", "UNSUPPORTED", "VIOLATED", "INVALID", "REJECTED"])(
    "reads %s as NO",
    (v) => expect(normVerdict(v)).toBe("NO"),
  );

  it.each(["PARTIAL", "partially", "MOSTLY", "MIXED", "QUALIFIED", "MARGINAL"])(
    "reads %s as PARTIAL",
    (v) => expect(normVerdict(v)).toBe("PARTIAL"),
  );

  it.each(["INSUFFICIENT", "unknown", "N/A", "none", "missing", "cannot determine", "No data"])(
    "reads %s as INSUFFICIENT",
    (v) => expect(normVerdict(v)).toBe("INSUFFICIENT"),
  );

  // Order matters: "NOT CONFIRMED" contains CONFIRMED, and "NO DATA" contains
  // NO. Testing agreement first would score both as a positive signal.
  it("prefers negation over the agreement word it contains", () => {
    expect(normVerdict("Not confirmed")).toBe("NO");
    expect(normVerdict("No data")).toBe("INSUFFICIENT");
  });

  it("does not mistake an evidence phrase for absence of data", () => {
    expect(normVerdict("Data confirms the zone")).toBe("YES");
    expect(normVerdict("Data partially supports")).toBe("PARTIAL");
  });

  it("falls back to INSUFFICIENT for an unrecognised token", () => {
    expect(normVerdict("banana")).toBe("INSUFFICIENT");
    expect(normVerdict("")).toBe("INSUFFICIENT");
    expect(normVerdict(undefined)).toBe("INSUFFICIENT");
  });
});
