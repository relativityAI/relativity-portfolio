import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { gradeReport, VERDICTS } from "../src/harness/report/verdict.js";

const textModel = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () =>
      ({
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        rawResponse: { headers: {} },
        warnings: [],
      }) as any,
  });

describe("gradeReport", () => {
  it("picks exactly one of the five bands", () => {
    expect([...VERDICTS]).toEqual(["Very Poor", "Poor", "Fair", "Good", "Excellent"]);
  });

  it("returns the band the model chose", async () => {
    const verdict = await gradeReport({ text: "A complete, sourced report.", model: textModel('{"verdict":"Excellent"}') as any });
    expect(verdict).toBe("Excellent");
  });

  it("returns null (never a fabricated grade) when the call fails", async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("boom");
      },
    });
    expect(await gradeReport({ text: "x", model: failing as any })).toBeNull();
  });

  it("does not call the model when the run was aborted", async () => {
    const never = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model must not be called");
      },
    });
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await gradeReport({ text: "x", model: never as any, abortSignal: ctrl.signal })).toBeNull();
  });
});
