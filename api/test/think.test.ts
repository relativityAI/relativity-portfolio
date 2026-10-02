import { describe, it, expect } from "vitest";
import { geminiThinkingConfig } from "../src/skills/skillrun.js";

describe("geminiThinkingConfig", () => {
  it("uses thinkingLevel for Gemini 3 (budget 0 is rejected there)", () => {
    expect(geminiThinkingConfig("gemini/gemini-3.5-flash-lite")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    });
  });
  it("uses budget 0 for Gemini 2.x and nothing for other providers", () => {
    expect(geminiThinkingConfig("gemini/gemini-2.5-pro")).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(geminiThinkingConfig("openai/gpt-4o")).toBeUndefined();
  });
});
