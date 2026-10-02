import { describe, it, expect } from "vitest";
import { cleanCitations } from "../src/skills/skillrun.js";

// The v2 eval regression: every figure in the report cited "Analyst research
// transcript" — the model's own prose. That is circular provenance: it points
// at the narrative instead of at data, so the report reads as fully sourced
// while being unverifiable.
const CIRCULAR = /\b(transcript|conversation|analyst research|assistant|the above|own analysis|prior output)/i;
const ALLOWED = new Set(["https://example.com/filing"]);

const clean = (cs: any) => cleanCitations(cs, ALLOWED, CIRCULAR);

describe("cleanCitations", () => {
  it("drops a citation that points at the model's own transcript", () => {
    expect(
      clean([{ source: "Analyst research transcript", label: "notes", value: "RSI 36" }]),
    ).toEqual([]);
  });

  it.each([
    "the conversation above",
    "my own analysis",
    "Assistant summary",
    "prior output",
  ])("drops circular source %s", (source) => {
    expect(clean([{ source, value: "x" }])).toEqual([]);
  });

  it("keeps a tool citation", () => {
    expect(clean([{ source: "marketdata", value: "rsi14=28.60" }])).toEqual([
      { source: "marketdata", value: "rsi14=28.60" },
    ]);
  });

  it("keeps a url a tool actually returned", () => {
    expect(
      clean([{ source: "web_search", url: "https://example.com/filing", value: "revenue" }]),
    ).toHaveLength(1);
  });

  it("strips an invented url but keeps the tool that was called", () => {
    const out = clean([{ source: "web_search", url: "https://never-fetched.example/x", value: "revenue" }]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBeUndefined();
  });

  it("drops an empty citation", () => {
    expect(clean([{ source: "", value: "x" }])).toEqual([]);
    expect(clean(undefined)).toEqual([]);
  });
});
