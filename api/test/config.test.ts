import { describe, it, expect } from "vitest";
import { parseCsv, parseServerKeys, parseServerModels, parseDailyCaps, DEFAULT_DAILY_REQUESTS } from "../src/config.js";

describe("parseCsv", () => {
  it("returns [] for undefined", () => {
    expect(parseCsv(undefined)).toEqual([]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(parseCsv(" k1 , k2, ,k3 ")).toEqual(["k1", "k2", "k3"]);
  });

  it("returns [] for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseServerKeys", () => {
  it("pools comma-separated keys per provider", () => {
    expect(parseServerKeys({ GEMINI_API_KEYS: "gk1,gk2,gk3" })).toEqual({ gemini: ["gk1", "gk2", "gk3"] });
  });

  it("falls back to the legacy single-key env var", () => {
    expect(parseServerKeys({ OPENAI_API_KEY: "legacy-1" })).toEqual({ openai: ["legacy-1"] });
  });

  it("prefers API_KEYS over the legacy fallback", () => {
    expect(parseServerKeys({ ANTHROPIC_API_KEYS: "a1,a2", ANTHROPIC_API_KEY: "legacy" })).toEqual({ anthropic: ["a1", "a2"] });
  });

  it("omits providers with no keys", () => {
    expect(parseServerKeys({})).toEqual({});
  });
});

describe("parseServerModels", () => {
  it("parses provider model lists", () => {
    expect(parseServerModels({ GEMINI_MODELS: "gemini/gemini-3.5-flash-lite,gemini/gemini-2.5-flash" })).toEqual({
      gemini: ["gemini/gemini-3.5-flash-lite", "gemini/gemini-2.5-flash"],
    });
  });

  it("returns {} when nothing is set", () => {
    expect(parseServerModels({})).toEqual({});
  });
});

describe("parseDailyCaps", () => {
  it("uses defaults when unset", () => {
    const caps = parseDailyCaps({});
    expect(caps["gemini"]).toBe(DEFAULT_DAILY_REQUESTS["gemini"]);
    expect(caps["groq"]).toBe(DEFAULT_DAILY_REQUESTS["groq"]);
  });

  it("honors explicit overrides", () => {
    expect(parseDailyCaps({ GEMINI_DAILY_REQUESTS: "5000" })["gemini"]).toBe(5000);
  });

  it("ignores invalid overrides and keeps the default", () => {
    expect(parseDailyCaps({ GEMINI_DAILY_REQUESTS: "banana" })["gemini"]).toBe(DEFAULT_DAILY_REQUESTS["gemini"]);
  });
});