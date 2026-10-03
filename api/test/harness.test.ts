import { describe, it, expect } from "vitest";
import {
  describeInputError,
  RETRYABLE_ERROR,
  buildForceToolsPrepareStep,
  buildToolCallRepair,
  retryLlmCall,
} from "../src/harness.js";
import { clampMaxOutputTokensForTest, runAgentTurn } from "../src/harness.js";
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

describe("clampMaxOutputTokens", () => {
  it("clamps Cohere requests to its 4096 output cap (live-probed EOL of TOO_MANY_TOKENS 400)", () => {
    expect(clampMaxOutputTokensForTest("cohere.chat", 8192)).toBe(4096);
    expect(clampMaxOutputTokensForTest("cohere.chat", 4096)).toBe(4096);
    expect(clampMaxOutputTokensForTest("cohere.chat", 2000)).toBe(2000);
  });

  it("leaves other providers untouched", () => {
    expect(clampMaxOutputTokensForTest("groq.chat", 8192)).toBe(8192);
    expect(clampMaxOutputTokensForTest("google.generative-ai", 8192)).toBe(8192);
    expect(clampMaxOutputTokensForTest("", 8192)).toBe(8192);
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

describe("runAgentTurn error attribution", () => {
  it("names the in-repo throw site for a bare TypeError", async () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'type')");
    boom.stack = [
      "TypeError: Cannot read properties of undefined (reading 'type')",
      "    at /app/src/harness.ts:237:12",
      "    at node_modules/ai/dist/index.js:1:1",
    ].join("\n");
    const res = await runAgentTurn({
      model: {
        specificationVersion: "v4",
        provider: "test",
        modelId: "m",
        doGenerate: async () => { throw boom; },
        doStream: async () => { throw boom; },
      } as any,
      system: "s",
      prompt: "p",
    });
    expect(res.error).toContain("Cannot read properties of undefined");
    expect(res.error).toMatch(/\[thrown at .*src\/harness\.ts:\d+/);
    expect(res.error).not.toContain("node_modules");
  });
});

describe("retryLlmCall", () => {
  it("retries a transient failure and returns the later success", async () => {
    let calls = 0;
    const res = await retryLlmCall(
      "test call",
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("empty stream: provider hiccup");
        return { value: "ok" };
      },
      { attempts: 3, delayMs: 0 },
    );
    expect(res.value).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries a result the checker rejects, then accepts a valid one", async () => {
    let calls = 0;
    const res = await retryLlmCall(
      "extraction",
      async () => {
        calls += 1;
        return { blocks: calls >= 3 ? ["b"] : [] };
      },
      { attempts: 3, delayMs: 0, check: (r) => r.blocks.length > 0 },
    );
    expect(res.blocks).toEqual(["b"]);
    expect(calls).toBe(3);
  });

  it("fails fast on permanent errors (auth) without burning attempts", async () => {
    let calls = 0;
    await expect(
      retryLlmCall(
        "synthesis",
        async () => {
          calls += 1;
          throw new Error("invalid api key provided");
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).rejects.toThrow(/invalid api key/);
    expect(calls).toBe(1);
  });

  it("throws the last error after exhausting all attempts", async () => {
    let calls = 0;
    await expect(
      retryLlmCall(
        "planning",
        async () => {
          calls += 1;
          throw new Error(`transient ${calls}`);
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).rejects.toThrow("transient 3");
    expect(calls).toBe(3);
  });

  it("reports each failure to onError with the attempt number", async () => {
    const seen: Array<[string, number]> = [];
    await expect(
      retryLlmCall(
        "extraction",
        async () => {
          throw new Error("rate limited");
        },
        { attempts: 2, delayMs: 0, onError: (msg, attempt) => seen.push([msg, attempt]) },
      ),
    ).rejects.toThrow(/rate limited/);
    expect(seen).toEqual([
      ["rate limited", 1],
      ["rate limited", 2],
    ]);
  });

  it("retries unknown error classes — resilience is the default", async () => {
    let calls = 0;
    const res = await retryLlmCall(
      "weird provider",
      async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("Cannot read properties of undefined");
        return "recovered";
      },
      { attempts: 3, delayMs: 0 },
    );
    expect(res).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("times out a hung call instead of waiting on the stale-run sweeper", async () => {
    // The shipped symptom: the provider accepted the request and never
    // resolved, so the run sat in RUNNING until it was killed — with the
    // scores already persisted and the report never written.
    let signal: AbortSignal | undefined;
    await expect(
      retryLlmCall(
        "hung synthesis",
        async (s) => {
          signal = s;
          await new Promise(() => {}); // never resolves, ignores the signal
        },
        { attempts: 2, delayMs: 0, timeoutMs: 20 },
      ),
    ).rejects.toThrow(/hung synthesis timed out after 20ms/);
    // The signal is still handed to the caller so a real request is cancelled.
    expect(signal?.aborted).toBe(true);
  });

  it("retries a timed-out call with a fresh, unexpired signal", async () => {
    // A signal created once and reused would already be dead on attempt 2,
    // which would fail every real retry.
    const signals: AbortSignal[] = [];
    const res = await retryLlmCall(
      "flaky synthesis",
      async (s) => {
        signals.push(s);
        if (signals.length === 1) await new Promise(() => {});
        return "ok";
      },
      { attempts: 2, delayMs: 0, timeoutMs: 20 },
    );
    expect(res).toBe("ok");
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
  });
});

describe("runAgentTurn partial text", () => {
  it("returns what the model already said when the turn dies mid-stream", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "0" });
            c.enqueue({ type: "text-delta", id: "0", delta: "RELIANCE looks cheap." });
            // Malformed part: the SDK's own transform throws on it, which is how
            // a real provider frame aborts a turn after the model has spoken.
            c.enqueue({ type: "text-delta" });
            c.close();
          },
        }),
      }),
    });
    const res = await runAgentTurn({ model, system: "s", prompt: "p", maxToolSteps: 1, streamRetries: 0 } as any);
    expect(res.text).toContain("RELIANCE looks cheap.");
    expect(res.error).toBeTruthy(); // this is the failed-turn branch, not a matched turn
  });
});
