import { describe, it, expect } from "vitest";
import { describeInputError, RETRYABLE_ERROR, buildForceToolsPrepareStep, buildToolCallRepair } from "../src/harness.js";
import { MockLanguageModelV4 } from "ai/test";

describe("buildToolCallRepair", () => {
  const makeModel = (text: string) =>
    new MockLanguageModelV4({
      doGenerate: async ({ prompt, abortSignal, maxOutputTokens, temperature }) => {
        expect(abortSignal).toBeUndefined();
        const promptText = JSON.stringify(prompt);
        expect(promptText).toMatch(/Validation error/);
        expect(temperature).toBe(0);
        expect(maxOutputTokens).toBe(2048);
        return {
          content: [{ type: "text", text }],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 10 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          rawResponse: { headers: {} },
          warnings: [],
        } as any;
      },
    });

  it("re-asks with the tool schema and returns corrected args", async () => {
    const repair = buildToolCallRepair(makeModel('{"symbol":"RELIANCE","source":"nse"}') as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c1", toolName: "get_financial_metrics", input: '{"symbol":123}' },
      error: new Error("expected string, received number"),
      inputSchema: async () => ({ type: "object" }),
    });
    expect(fixed).toEqual({
      toolCallId: "c1",
      toolName: "get_financial_metrics",
      input: { symbol: "RELIANCE", source: "nse" },
    });
  });

  it("strips markdown fences around the repaired JSON", async () => {
    const repair = buildToolCallRepair(makeModel("```json\n{\"symbol\":\"TCS\"}```") as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c2", toolName: "get_financial_metrics", input: "{}" },
      error: new Error("bad"),
      inputSchema: async () => ({ type: "object" }),
    });
    expect(fixed?.input).toEqual({ symbol: "TCS" });
  });

  it("returns null (-> SDK surfaces original error) when the model does not emit JSON", async () => {
    const repair = buildToolCallRepair(makeModel("I cannot fix that") as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c3", toolName: "web_search", input: "{}" },
      error: new Error("bad"),
      inputSchema: async () => ({ type: "object" }),
    });
    expect(fixed).toBeNull();
  });

  it("returns null when inputSchema throws", async () => {
    const repair = buildToolCallRepair(makeModel('{"symbol":"X"}') as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c4", toolName: "nope", input: "{}" },
      error: new Error("bad"),
      inputSchema: async () => {
        throw new Error("no schema");
      },
    });
    expect(fixed).toBeNull();
  });
});

describe("describeInputError", () => {
  it("names the PDF-input limitation so the user can act on it", () => {
    expect(describeInputError({ message: 'Cannot read "KEI-854a1a95.pdf" (this model does not support pdf input)' })).toMatch(/text only/);
    expect(describeInputError({ message: "this model does not support pdf input" })).toMatch(/text only/);
  });

  it("ignores unrelated provider errors", () => {
    expect(describeInputError({ message: "rate limit exceeded" })).toBeUndefined();
    expect(describeInputError({ message: "" })).toBeUndefined();
    expect(describeInputError(undefined)).toBeUndefined();
  });
});

describe("RETRYABLE_ERROR", () => {
  it("covers the empty-stream and transient provider failures we retry on", () => {
    expect(RETRYABLE_ERROR.test("AI_NoOutputGeneratedError: No suitable output part found")).toBe(true);
    expect(RETRYABLE_ERROR.test("rate limit exceeded (429)")).toBe(true);
    expect(RETRYABLE_ERROR.test("429 Resource has been exhausted")).toBe(true);
    expect(RETRYABLE_ERROR.test("received 500 status code")).toBe(true);
  });
});

describe("buildForceToolsPrepareStep", () => {
  it("forces a tool call on step 0 so research is grounded, then frees the model", async () => {
    const prepareStep = buildForceToolsPrepareStep(["get_financials", "web_search"]);
    expect(await prepareStep({ stepNumber: 0 })).toEqual({
      toolChoice: "required",
      activeTools: ["get_financials", "web_search"],
    });
    expect(await prepareStep({ stepNumber: 1 })).toEqual({});
    expect(await prepareStep({ stepNumber: 2 })).toEqual({});
  });
});