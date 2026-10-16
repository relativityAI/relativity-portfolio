import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { runIterativeAgent, DONE_MARKER } from "../src/iterative-agent.js";

/** A clean text stream for the AI SDK mock. */
function textStream(text: string) {
  return () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t0" });
          c.enqueue({ type: "text-delta", id: "t0", delta: text });
          c.enqueue({ type: "text-end", id: "t0" });
          c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
          c.close();
        },
      }),
    });
}

describe("runIterativeAgent", () => {
  it("loops turns until the agent emits the done marker", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: () =>
        textStream(
          ++calls === 1
            ? "Starting research, no answer yet."
            : calls === 2
              ? `Final answer.\n${DONE_MARKER}`
              : "## Summary\nFormatted final answer.",
        )(),
    });

    const res = await runIterativeAgent({
      instruction: "Summarise the company.",
      symbol: "RELIANCE",
      model: model as any,
      tools: {},
    });

    expect(res.iterations).toBe(2);
    expect(res.status).toBe("DONE");
    // No format step — the final turn's text is the answer, marker stripped.
    expect(calls).toBe(2);
    expect(res.text).toBe("Final answer.");
    expect(res.error).toBeUndefined();
  });

  it("stops with an error when the agent never completes", async () => {
    const model = new MockLanguageModelV4({ doStream: textStream("still thinking...") });

    const res = await runIterativeAgent({
      instruction: "Summarise the company.",
      symbol: "RELIANCE",
      model: model as any,
      tools: {},
      maxIterations: 3,
    });

    expect(res.iterations).toBe(3);
    expect(res.status).toBe("PARTIAL");
    expect(res.error).toMatch(/did not complete/i);
  });

  // The reported bug: the agent emits [[DONE]] after only fetching a price,
  // having done none of the earnings work. The gate must refuse to accept it.
  describe("completion gate (regression)", () => {
    const isComplete = ({ text }: { text: string }) =>
      /\bRevenue\b/.test(text) && /\bYoY\b/i.test(text)
        ? true
        : "Missing required sections: revenue and YoY comparison.";

    it("does not accept a price-only answer as done", async () => {
      const model = new MockLanguageModelV4({
        doStream: textStream(`Price is 3,400 with positive momentum.\n${DONE_MARKER}`),
      });

      const res = await runIterativeAgent({
        instruction: "Produce a post-earnings update with revenue and YoY.",
        symbol: "RELIANCE",
        model: model as any,
        tools: {},
        maxIterations: 2,
        isComplete,
      });

      expect(res.status).toBe("PARTIAL");
      expect(res.error).toMatch(/did not satisfy the completion criteria/i);
    });

    it("accepts once the required evidence is present", async () => {
      let calls = 0;
      const model = new MockLanguageModelV4({
        doStream: () =>
          textStream(
            ++calls === 1
              ? `Price is 3,400.\n${DONE_MARKER}`
              : calls === 2
                ? `Revenue grew 9% YoY.\n${DONE_MARKER}`
                : "## Summary\nFormatted.",
          )(),
      });

      const res = await runIterativeAgent({
        instruction: "Produce a post-earnings update with revenue and YoY.",
        symbol: "RELIANCE",
        model: model as any,
        tools: {},
        maxIterations: 3,
        isComplete,
      });

      expect(res.status).toBe("DONE");
      expect(res.error).toBeUndefined();
    });
  });
});

// Live smoke test — real Gemini + real tools. Costs quota, so it only runs when
// explicitly enabled: `RUN_LIVE_AGENT=1 npx vitest run test/iterative-agent.test.ts`
describe.skipIf(process.env.RUN_LIVE_AGENT !== "1")("runIterativeAgent (live)", () => {
  it("completes an instruction using company tools", async () => {
    const res = await runIterativeAgent({
      instruction:
        "Use your price tools to fetch the latest price for this company, then report it in one sentence.",
      symbol: "RELIANCE",
      maxIterations: 2,
    });

    expect(res.toolCalls.length).toBeGreaterThan(0);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.error).toBeUndefined();
  }, 120_000);
});
