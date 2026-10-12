import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { runIterativeAgent, DONE_MARKER, buildIterativeManifest, authorLang } from "../src/iterative-agent.js";

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

  describe("manifest + authoring pass", () => {
    it("freezes tool calls into a layout manifest", () => {
      const manifest = buildIterativeManifest({
        symbol: "RELIANCE",
        shareName: "RELIANCE",
        source: "NSE",
        toolCalls: [
          {
            tool_name: "get_price_history",
            status: "OK",
            result: JSON.stringify({
              candles_recent: [
                { date: "2026-04-01", c: 4400, v: 100 },
                { date: "2026-04-02", c: 4500, v: 120 },
              ],
              fifty_two_week: { low: 4000, high: 4800 },
            }),
          },
          { tool_name: "get_current_price", status: "OK", result: JSON.stringify({ price: 4500, week52High: 4800, week52Low: 4000 }) },
          { tool_name: "get_financial_metrics", status: "OK", result: JSON.stringify({ revenue: 100, net_profit: 20, debt_to_equity: 0.5 }) },
        ],
      });

      expect(manifest.identity).toMatchObject({ symbol: "RELIANCE", agentName: "iterative-analyst", runMode: "iterative" });
      expect(manifest.price?.lastPrice).toBe(4500);
      expect(manifest.price?.week52High).toBe(4800);
      expect(manifest.datasets.map((d) => d.id)).toContain("price_candles");
      expect(manifest.metrics?.length).toBe(1);
      expect(manifest.metrics?.[0].fields.map((f) => f.key)).toEqual(["revenue", "net_profit", "debt_to_equity"]);
    });
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

describe("authorLang section pipeline", () => {
  /** v7 doGenerate receives prompt as a messages array, not a string. */
  const promptText = (options: any): string => {
    const msgs = Array.isArray(options.prompt) ? options.prompt : [{ content: options.prompt }];
    return msgs
      .map((m: any) => {
        const c = m?.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.map((p: any) => p?.text ?? "").join("");
        return "";
      })
      .join("\n");
  };

  const manifest = buildIterativeManifest({
    symbol: "RELIANCE",
    shareName: "RELIANCE",
    source: "NSE",
    toolCalls: [
      {
        tool_name: "get_price_history",
        status: "OK",
        result: JSON.stringify({
          candles_recent: [{ date: "2026-04-01", c: 4400, v: 100 }],
          fifty_two_week: { low: 4000, high: 4800 },
        }),
      },
      { tool_name: "get_financial_metrics", status: "OK", result: JSON.stringify({ revenue: 100, net_profit: 20 }) },
    ],
  });

  it("authors per-section and stitches one rooted report", async () => {
    const mtId = manifest.metrics?.[0]?.id ?? "metrics";
    const model = new MockLanguageModelV4({
      doGenerate: async (options: any) => {
        const p = promptText(options);
        const text = p.includes("YOUR SECTION (1 of 2)")
          ? 'Markdown("Sec one prose")\nBarChart("@ds:price_candles", "date", "c")'
          : p.includes("YOUR SECTION (2 of 2)")
            ? `Markdown("Sec two prose")\nMetricGrid("@mt:${mtId}", "revenue,net_profit")`
            : "## Summary\nSingle-call fallback.";
        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop" },
          usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, noCache: 1 } },
        } as any;
      },
    });

    const lang = await authorLang({
      model: model as any,
      manifest,
      text: "## Overview\nLead prose.\n\n## Financials\nRevenue prose.",
    });

    expect(lang).toContain("root = AnalysisPage(");
    expect(lang).toContain("Sec one prose");
    expect(lang).toContain("Sec two prose");
  });

  it("falls back to single-call authoring when section calls keep failing", async () => {
    let sectionCalls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (options: any) => {
        const p = promptText(options);
        if (p.includes("YOUR SECTION")) {
          sectionCalls += 1;
          throw new Error("429 rate limit");
        }
        return {
          content: [{ type: "text", text: 'root = AnalysisPage("RELIANCE", [Markdown("Fallback prose")])' }],
          finishReason: { unified: "stop" },
          usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, noCache: 1 } },
        } as any;
      },
    });

    const lang = await authorLang({
      model: model as any,
      manifest,
      text: "## Overview\nLead prose.\n\n## Financials\nRevenue prose.",
    });

    expect(sectionCalls).toBe(6); // 2 sections x 3 rate-limit retries
    expect(lang).toContain("Fallback prose");
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
