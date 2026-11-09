import { describe, it, expect } from "vitest";
import { occurrence, latestOccurrence, isValidTime, isValidTimeZone } from "../src/schedule.js";

describe("validation", () => {
  it("accepts 24h HH:MM and valid IANA zones", () => {
    expect(isValidTime("09:00")).toBe(true);
    expect(isValidTime("21:05")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });
  it("rejects malformed time and bogus zones", () => {
    expect(isValidTime("9:00")).toBe(false);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("21:60")).toBe(false);
    expect(isValidTime("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("occurrence", () => {
  it("Asia/Kolkata (no DST): 21:00 IST is 15:30 UTC", () => {
    expect(occurrence("2026-11-06", "21:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 6, 15, 30));
  });

  it("America/New_York keeps 09:00 local across spring-forward (2026-03-08)", () => {
    // Mar 7 = EST (UTC-5); Mar 8 02:00→03:00 jumps to EDT (UTC-4):
    // same wall clock, different UTC — the point of storing tz, not offset.
    expect(occurrence("2026-03-07", "09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 7, 14, 0));
    expect(occurrence("2026-03-08", "09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 8, 13, 0));
  });

  it("America/New_York keeps 09:00 local across fall-back (2026-11-01)", () => {
    expect(occurrence("2026-10-31", "09:00", "America/New_York")).toBe(Date.UTC(2026, 9, 31, 13, 0));
    expect(occurrence("2026-11-01", "09:00", "America/New_York")).toBe(Date.UTC(2026, 10, 1, 14, 0));
  });
});

describe("latestOccurrence", () => {
  const tz = "Asia/Kolkata"; // 21:00 IST = 15:30 UTC

  it("returns today's occurrence once passed", () => {
    const now = Date.UTC(2026, 10, 6, 18, 0); // 23:30 IST
    expect(latestOccurrence("21:00", tz, now)).toEqual({
      at: Date.UTC(2026, 10, 6, 15, 30),
      date: "2026-11-06",
    });
  });

  it("returns yesterday's occurrence before today's time", () => {
    const now = Date.UTC(2026, 10, 6, 10, 0); // 15:30 IST
    expect(latestOccurrence("21:00", tz, now)).toEqual({
      at: Date.UTC(2026, 10, 5, 15, 30),
      date: "2026-11-05",
    });
  });

  it("rolls the local date at midnight in the user's zone, not UTC", () => {
    const now = Date.UTC(2026, 10, 6, 19, 0); // 00:30 IST on Nov 7
    expect(latestOccurrence("21:00", tz, now)).toEqual({
      at: Date.UTC(2026, 10, 6, 15, 30),
      date: "2026-11-06",
    });
  });
});
