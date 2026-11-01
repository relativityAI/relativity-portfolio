import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  describeInputError,
  RETRYABLE_ERROR,
  buildForceToolsPrepareStep,
  buildToolCallRepair,
  repairNullToolArgs,
  retryLlmCall,
} from "../src/harness.js";
import { clampMaxOutputTokensForTest, runAgentTurn } from "../src/harness.js";
import { MockLanguageModelV4 } from "ai/test";
import {
  clearOldToolResults,
  createLoopAgent,
  overBudget,
  runAgentLoop,
  serveAgentUIStream,
  summarizeOlderMessages,
  SUMMARIZE_KEEP_RECENT,
} from "../src/harness/loop/agent-loop.js";
import { ReportCanvas } from "../src/harness/canvas/canvas.js";
import { reportWriteTool, reportRemoveTool } from "../src/harness/canvas/report-tool.js";
import { runCanvasAnalysis } from "../src/harness/canvas/run.js";
import { AGENT_CONFIG_DEFAULT, loadAgentConfig, loadRunConfigDoc, promptDoc } from "../src/harness/config.js";
import { getOutputTemplate, loadOutputTemplates } from "../src/harness/index.js";
import { Workspace } from "../src/harness/workspace/fs.js";
import { readPlan, workspaceTools } from "../src/harness/workspace/tools.js";
import { PATHS } from "../src/harness/workspace/paths.js";

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
      input: JSON.stringify({ symbol: "RELIANCE", source: "nse" }),
    });
  });

  it("strips markdown fences around the repaired JSON", async () => {
    const repair = buildToolCallRepair(makeModel("```json\n{\"symbol\":\"TCS\"}```") as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c2", toolName: "get_financial_metrics", input: "{}" },
      error: new Error("bad"),
      inputSchema: async () => ({ type: "object" }),
    });
    expect(fixed?.input).toEqual(JSON.stringify({ symbol: "TCS" }));
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

  it("deterministically drops null optional args without a model round-trip", async () => {
    const neverCalled = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model must not be called for a null-strip");
      },
    });
    const repair = buildToolCallRepair(neverCalled as any);
    const fixed = await repair({
      toolCall: { toolCallId: "c5", toolName: "get_technicals", input: { sections: null } },
      error: new Error("/sections: expected string, but got null"),
      inputSchema: async () => ({ type: "object" }),
    });
    expect(fixed).toEqual({ toolCallId: "c5", toolName: "get_technicals", input: "{}" });
  });

  it("repairNullToolArgs parses JSON-string input and strips nulls", () => {
    expect(repairNullToolArgs({ toolCallId: "c6", toolName: "get_technicals", input: '{"sections":null,"days":5}' }))
      .toEqual({ toolCallId: "c6", toolName: "get_technicals", input: JSON.stringify({ days: 5 }) });
  });

  it("repairNullToolArgs returns null when there is nothing to strip", () => {
    expect(repairNullToolArgs({ input: { symbol: "KEI" } })).toBeNull();
    expect(repairNullToolArgs({ input: "not json" })).toBeNull();
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

describe("clearOldToolResults (compaction: clear)", () => {
  const pair = (i: number) => [
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: "getData", input: { i } }],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: `c${i}`,
          toolName: "getData",
          output: {
            type: "json" as const,
            value: { _source: { path: `/sources/raw/getData-${i}.json` }, fat: `payload-${i}`, n: i },
          },
        },
      ],
    },
  ];

  it("replaces results past the keep-window with a restorable stub; last 3 stay verbatim", () => {
    const messages: any[] = [{ role: "user", content: "research the company" }];
    for (let i = 0; i < 8; i++) messages.push(...pair(i));
    const out = clearOldToolResults(messages);
    const text = JSON.stringify(out);
    // 8 tool results: last 3 verbatim, first 5 cleared with restore paths
    expect(text).not.toContain("payload-0");
    expect(text).not.toContain("payload-4");
    expect(text).toContain("payload-5");
    expect(text).toContain("payload-7");
    expect(text).toContain("[cleared] full output at /sources/raw/getData-0.json");
    expect(text).toContain("[cleared] full output at /sources/raw/getData-4.json");
    // pairing survives: every tool-call id still has its tool message
    expect(out).toHaveLength(17);
    for (let i = 0; i < 8; i++) expect(text).toContain(`"c${i}"`);
    // the seed prompt is untouched
    expect(out[0]).toEqual({ role: "user", content: "research the company" });
  });

  it("keeps assistant text and tool calls; only result OUTPUT is cleared", () => {
    const messages: any[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "finding data" },
          { type: "tool-call", toolCallId: "old", toolName: "getData", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "old", toolName: "getData", output: { type: "json", value: { fat: "old-blob" } } },
        ],
      },
      ...pair(5),
      ...pair(6),
      ...pair(7),
    ];
    const out = clearOldToolResults(messages);
    const text = JSON.stringify(out);
    expect(text).toContain("finding data");
    expect(text).toContain('"old"'); // the tool-call part stays
    expect(text).not.toContain("old-blob"); // its result is cleared (no _source path → generic stub)
    expect(text).toContain("[cleared] full output archived in the research workspace");
    expect(text).toContain("payload-7"); // last of the last 3 stays
  });

  it("is a no-op when there are at most `keep` tool results", () => {
    const messages: any[] = [{ role: "user", content: "go" }, ...pair(0), ...pair(1)];
    expect(clearOldToolResults(messages)).toBe(messages);
  });
});

describe("summarizeOlderMessages (compaction: summarize)", () => {
  const pair = (i: number) => [
    { role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: "getData", input: { i } }] },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: `c${i}`,
          toolName: "getData",
          output: { type: "json" as const, value: { figure: `${100 + i}`, src: `src_00${i}` } },
        },
      ],
    },
  ];
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };

  it("replaces older messages with a continuation brief; seed + last N stay verbatim", async () => {
    const summarizer = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "- RSI 42 from [src_000]\nPLAN: write Momentum" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
      } as any),
    });
    const messages: any[] = [{ role: "user", content: "analyze TCS" }];
    for (let i = 0; i < 10; i++) messages.push(...pair(i));
    const { messages: out, summary } = await summarizeOlderMessages({ messages, model: summarizer as any });
    expect(summary).toContain("RSI 42");
    expect(out[0]).toEqual({ role: "user", content: "analyze TCS" }); // seed untouched
    expect(out[1].role).toBe("user");
    expect(JSON.stringify(out[1])).toContain("conversation summary");
    expect(JSON.stringify(out[1])).toContain("PLAN: write Momentum");
    // last SUMMARIZE_KEEP_RECENT messages kept verbatim
    expect(out).toHaveLength(1 + 1 + SUMMARIZE_KEEP_RECENT);
    expect(JSON.stringify(out)).toContain('"c9"');
    expect(JSON.stringify(out)).not.toContain('"c0"');
  }, 15_000);

  it("leaves the history alone when there is nothing meaningfully old", async () => {
    const neverCalled = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("summarizer must not be called");
      },
    });
    const messages: any[] = [{ role: "user", content: "go" }, ...pair(0)];
    const { messages: out, summary } = await summarizeOlderMessages({ messages, model: neverCalled as any });
    expect(out).toBe(messages);
    expect(summary).toBe("");
  });

  it("compacts a short-but-fat history too (threshold is tokens, not message count)", async () => {
    const summarizer = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "- fig 42 [src_000]\nPLAN: write" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
      } as any),
    });
    const messages: any[] = [{ role: "user", content: "go" }, ...pair(0), ...pair(1)];
    const { messages: out, summary } = await summarizeOlderMessages({ messages, model: summarizer as any });
    expect(summary).toContain("fig 42");
    // seed + summary + the last pair (never split across the cut)
    expect(out).toHaveLength(4);
    expect(JSON.stringify(out)).toContain('"c1"');
    expect(JSON.stringify(out)).not.toContain('"c0"');
  }, 15_000);
});

describe("loop compaction wiring (real SDK message flow)", () => {
  it("prepareStep clears old tool results in the actual prompts the model receives", async () => {
    const prompts: string[] = [];
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompts.push(JSON.stringify(opts.prompt ?? ""));
        n++;
        if (n <= 6)
          return {
            content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "probe", input: JSON.stringify({ i: n }) }],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
              inputTokens: { total: 1_000 * n, noCache: 1_000 * n, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
            rawCall: { rawPrompt: null, rawSettings: {} },
            warnings: [],
          } as any;
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    const logs: string[] = [];
    const out = await runAgentLoop({
      model: model as any,
      system: "s",
      prompt: "p",
      tools: [
        {
          name: "probe",
          description: "probe",
          parameters: z.object({ i: z.number() }),
          execute: async (a: any) => ({ fat: `payload-${a.i}` }),
        },
      ],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 10, maxTokens: 100_000, cbSessions: 3, cbSessionSteps: 8 },
      onEvent: (e) => {
        if (e.type === "log") logs.push((e as any).text);
      },
    });
    expect(out.status).toBe("completed");
    expect(out.peakInput).toBe(6_000); // largest single step, not the 21.1k sum
    // the LAST request the model saw: 6 results on record → 3 cleared, 3 verbatim
    const last = prompts.at(-1)!;
    expect(last).toContain("[cleared]");
    expect(last).not.toContain("payload-1");
    expect(last).not.toContain("payload-3");
    expect(last).toContain("payload-4");
    expect(last).toContain("payload-6");
    // the seed prompt and system instructions ride along untouched
    expect(last).toContain("p");
    expect(last).toContain('"role":"system","content":"s"'); // instructions arrive preassembled
    // one-time visibility so a run shows clearing is active
    expect(logs.filter((t) => t.startsWith("compaction: clearing active"))).toHaveLength(1);
  }, 20_000);
});

describe("loop compaction integration (runAgentLoop)", () => {
  it("trips summarize when input tokens pass 90% of the context budget, then keeps looping", async () => {
    let n = 0;
    const seenPrompts: string[] = [];
    // Main model: 3 tool calls then a final answer; input balloons each step.
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        seenPrompts.push(JSON.stringify(opts.prompt ?? ""));
        n++;
        if (n <= 3)
          return {
            content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "probe", input: JSON.stringify({ i: n }) }],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
              inputTokens: { total: 10_000 * n, noCache: 10_000 * n, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
            rawCall: { rawPrompt: null, rawSettings: {} },
            warnings: [],
          } as any;
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    let summaries = 0;
    const summarizer = new MockLanguageModelV4({
      doGenerate: async () => {
        summaries++;
        return {
          content: [{ type: "text", text: "- probe1 figure [src_001]\nPLAN: finish" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const logs: string[] = [];
    const out = await runAgentLoop({
      model: model as any,
      system: "s",
      prompt: "p",
      tools: [{ name: "probe", description: "probe", parameters: z.object({ i: z.number() }), execute: async () => ({ ok: true }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 10, maxTokens: 100_000, cbSessions: 3, cbSessionSteps: 8 },
      contextBudget: 20_000, // 90% → 18k; step 2 reports 20k input → summarize
      summarizerModel: summarizer as any,
      onEvent: (e) => {
        if (e.type === "log") logs.push((e as any).text);
      },
    });
    expect(out.status).toBe("completed");
    expect(out.steps).toBe(4);
    expect(summaries).toBe(1); // hysteresis: not re-tripped every step
    expect(logs.some((t) => t.startsWith("compaction: summarized"))).toBe(true);
    // the summary reached a later request; the early payload did not
    const lastPrompt = seenPrompts.at(-1)!;
    expect(lastPrompt).toContain("conversation summary");
    expect(lastPrompt).toContain("PLAN: finish");
  }, 20_000);
});

describe("AGENTS doc (react + protocol instructions)", () => {
  it("lets the agent batch independent tool calls in one step", () => {
    const agents = promptDoc("agents");
    expect(agents).toMatch(/Batch independent tool calls/);
    expect(agents).not.toMatch(/exactly one action/i);
    expect(agents).toMatch(/untrusted DATA/); // protocol moved here too
  });
});

describe("trailing reminders (todo/memory state in prepareStep)", () => {
  const usage = {
    inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  it("rides the last message — never the system prompt — and never accumulates", async () => {
    const prompts: any[] = [];
    let n = 0;
    let todos = "TODO: gather RSI";
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompts.push(opts.prompt);
        n++;
        if (n <= 2) {
          todos = `TODO: step ${n} done`; // live state changes mid-run
          return {
            content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "probe", input: "{}" }],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage,
            rawCall: { rawPrompt: null, rawSettings: {} },
            warnings: [],
          } as any;
        }
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    await runAgentLoop({
      model: model as any,
      system: "STATIC SYSTEM PROMPT",
      prompt: "p",
      tools: [{ name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 6, maxTokens: 100_000, cbSessions: 3, cbSessionSteps: 8 },
      reminders: () => todos,
    });
    const msgs = prompts.at(-1) as any[]; // V4 prompt: system is messages[0]
    const sys = msgs.find((m) => m.role === "system");
    expect(sys.content).toContain("STATIC SYSTEM PROMPT");
    expect(sys.content).not.toContain("TODO"); // prefix untouched
    const textOf = (m: any) =>
      typeof m.content === "string" ? m.content : (m.content ?? []).map((p: any) => p.text ?? "").join("");
    const reminders = msgs.filter((m) => m.role === "user" && textOf(m).startsWith("<reminder>"));
    expect(reminders).toHaveLength(1); // exactly one, last message
    expect(msgs.at(-1)).toBe(reminders[0]);
    expect(textOf(reminders[0])).toContain("TODO: step 2 done"); // fresh, not stale
  }, 15_000);
});

describe("deadline nudge (runAgentLoop) — advice, never a forced tool call", () => {
  const budget = { maxSteps: 4, maxTokens: 100_000, cbSessions: 3, cbSessionSteps: 8 };
  const tools = [
    { name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) },
    { name: "report_write", description: "write", parameters: z.object({}), execute: async () => ({ added: 1 }) },
  ];
  const recorder = (seen: { toolChoice?: any; prompt: string }[]) =>
    new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        seen.push({ toolChoice: opts.toolChoice, prompt: JSON.stringify(opts.prompt ?? "") });
        return {
          content: [{ type: "tool-call", toolCallId: `c${seen.length}`, toolName: "probe", input: "{}" }],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });

  it("never overrides tool choice; only injects the DEADLINE instruction", async () => {
    const seen: { toolChoice?: any; prompt: string }[] = [];
    await runAgentLoop({
      model: recorder(seen) as any,
      system: "s",
      prompt: "p",
      tools,
      ctx: { symbol: "TCS", source: "NSE" },
      budget,
      deadlineTool: "report_write",
    });
    // hard force is gone: no step pins toolChoice to a specific tool
    expect(seen.some((c) => c.toolChoice?.type === "tool")).toBe(false);
    // ...but the soft nudge still arrives in the last steps
    expect(seen.some((c) => c.prompt.includes("DEADLINE"))).toBe(true);
  });

  const attempt = async (writeLands: boolean) => {
    const seen: { toolChoice?: any; prompt: string }[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        seen.push({ toolChoice: opts.toolChoice, prompt: JSON.stringify(opts.prompt ?? "") });
        const nudged = seen.at(-1)!.prompt.includes("DEADLINE");
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `c${seen.length}`,
              // the model CHOOSES report_write when nudged — nothing forces it
              toolName: nudged ? "report_write" : "probe",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    const out = await runAgentLoop({
      model: model as any,
      system: "s",
      prompt: "p",
      tools: [
        { name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) },
        {
          name: "report_write",
          description: "write",
          parameters: z.object({}),
          // the KEI failure shape: a valid call that lands ZERO sections
          execute: async () => (writeLands ? { added: 1 } : { error: "no valid sections (type: Invalid discriminator value)" }),
        },
      ],
      ctx: { symbol: "TCS", source: "NSE" },
      budget,
      deadlineTool: "report_write",
    });
    const writes = out.trace.filter((e) => e.type === "tool_call" && e.tool === "report_write").length;
    const nudges = seen.filter((c) => c.prompt.includes("DEADLINE")).length;
    return { writes, nudges, seen };
  };

  it("keeps nudging after a REJECTED deadline write; stands down only after a landed one", async () => {
    const rejected = await attempt(false);
    expect(rejected.writes).toBe(2); // nudged again because the write failed
    expect(rejected.nudges).toBe(2);
    expect(rejected.seen.some((c) => c.toolChoice?.type === "tool")).toBe(false);

    const landed = await attempt(true);
    expect(landed.writes).toBe(1);
    expect(landed.nudges).toBe(1); // stood down after the landed write
    expect(landed.seen.some((c) => c.toolChoice?.type === "tool")).toBe(false);
  });
});

describe("report_remove / canvas groups", () => {
  it("surfaces group titles as level-2 headings in the compiled document", () => {
    const canvas = new ReportCanvas("TCS");
    canvas.appendSections("What's new", [{ type: "paragraph", text: "Beat." } as any], []);
    canvas.appendSections("Risks", [{ type: "heading", level: 3, text: "Risks" } as any], []);
    const doc = canvas.document();
    expect(doc.sections[0]).toMatchObject({ type: "heading", level: 2, text: "What's new" });
    // the write already led with its own heading — no duplicate injected
    expect(doc.sections.filter((s) => s.type === "heading" && s.text === "Risks")).toHaveLength(1);
  });


  it("retracts a section-group by id or title and lists groups", async () => {
    const canvas = new ReportCanvas("TCS");
    canvas.appendSections("Momentum", [{ type: "heading", level: 2, text: "Momentum" } as any], []);
    expect(canvas.groups()).toEqual([{ id: "t1", title: "Momentum", sections: 1 }]);
    const tool = reportRemoveTool(canvas);
    expect(await tool.execute({ group: "Momentum" }, { symbol: "TCS", source: "NSE" } as any)).toEqual({
      removed: "Momentum",
      totalSections: 0,
    });
    expect(await tool.execute({ group: "nope" }, { symbol: "TCS", source: "NSE" } as any)).toEqual({
      error: "no section-group matches: nope",
    });
  });

  it("report_write still appends after a removal", async () => {
    const canvas = new ReportCanvas("TCS");
    const write = reportWriteTool(canvas);
    await write.execute({ title: "A", sections: [{ type: "heading", level: 2, text: "A" }], sources: [] }, { symbol: "TCS", source: "NSE" } as any);
    reportRemoveTool(canvas).execute({ group: "t1" }, { symbol: "TCS", source: "NSE" } as any);
    const again = await write.execute({ title: "B", sections: [{ type: "heading", level: 2, text: "B" }], sources: [] }, { symbol: "TCS", source: "NSE" } as any);
    expect(again).toMatchObject({ added: 1, totalSections: 1 });
  });
});

describe("Workspace.hydrate", () => {
  it("restores files and source stubs from a snapshot", () => {
    const a = new Workspace();
    a.write("/workspace/notes.md", "# Notes\n- next: volume");
    a.write(
      "/knowledge_base/sources/TCS_get_rsi.json",
      JSON.stringify({ id: "src_001", callId: "src_001", derived: { scalars: { rsi: 42 } } }),
    );
    const snapshot = a.compact();

    const b = new Workspace();
    b.hydrate(snapshot);
    expect(b.read("/workspace/notes.md")).toContain("volume");
    expect(b.stubs()).toHaveLength(1);
    expect((b.stubs<any>()[0]).id).toBe("src_001");
    // resume round-trip: the restored workspace compacts back to the same files
    expect(Object.keys(b.compact())).toEqual(Object.keys(snapshot));
  });

  it("rejects junk snapshots without throwing", () => {
    const ws = new Workspace();
    ws.hydrate(undefined as any);
    // legacy snapshots carry pre-restructure paths — hydrate writes them as-is
    ws.hydrate({ "not/a/path": 1 as any, "/old-layout/ok.md": "x" });
    expect(ws.read("/old-layout/ok.md")).toBe("x");
  });
});

describe("todo_write (the plan journal)", () => {
  const ctx = { symbol: "TCS", source: "NSE" } as any;
  const items = (over: Partial<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>) => ({
    id: "1", content: "write report", status: "pending", ...over,
  });

  it("rewrites the whole typed list and derives the checklist", async () => {
    const ws = new Workspace();
    const todo = workspaceTools(ws).find((t) => t.name === "todo_write")!;
    await todo.execute({ items: [items({ status: "in_progress" }), items({ id: "2", content: "verify numbers", status: "pending" })] } as any, ctx);
    expect(readPlan(ws)).toHaveLength(2);
    expect(ws.read(PATHS.planMd)).toContain("[>] write report");
    expect(ws.read(PATHS.planMd)).toContain("[ ] verify numbers");
    // full-list replace: the omitted id is gone (journal = the whole list)
    await todo.execute({ items: [items({ status: "completed" })] } as any, ctx);
    expect(readPlan(ws)).toHaveLength(1);
    expect(readPlan(ws)![0].status).toBe("completed");
    expect(ws.read(PATHS.planMd)).toContain("[x] write report");
  });

  it("rejects more than one in_progress and duplicate ids", async () => {
    const ws = new Workspace();
    const todo = workspaceTools(ws).find((t) => t.name === "todo_write")!;
    const two = await todo.execute(
      { items: [items({ id: "a", status: "in_progress" }), items({ id: "b", status: "in_progress" })] } as any,
      ctx,
    );
    expect(two).toMatchObject({ error: expect.stringContaining("ONE") });
    const dup = await todo.execute({ items: [items({ id: "a" }), items({ id: "a" })] } as any, ctx);
    expect(dup).toMatchObject({ error: expect.stringContaining("unique") });
    expect(readPlan(ws)).toBeNull(); // nothing journaled on rejection
  });

  it("readPlan tolerates a missing or corrupt plan file", () => {
    const ws = new Workspace();
    expect(readPlan(ws)).toBeNull();
    ws.write(PATHS.planJson, "{ not json");
    expect(readPlan(ws)).toBeNull();
  });
});

describe("runCanvasAnalysis — one autonomous agent (no second stage)", () => {
  const usage = {
    inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const toolCall = (id: string, toolName: string, input: unknown) => ({
    type: "tool-call",
    toolCallId: id,
    toolName,
    input: JSON.stringify(input),
  });
  const result = (content: unknown[], unified: "tool-calls" | "stop") => ({
    content,
    finishReason: { unified, raw: unified },
    usage,
    rawCall: { rawPrompt: null, rawSettings: {} },
    warnings: [],
  } as any);
  // The post-stitch verdict call rides the same mock model — answer it (or
  // filter it out) so loop-step assertions keep counting only loop steps.
  const isGradeCall = (opts: any) => JSON.stringify(opts.prompt ?? "").includes("REPORT QUALITY");
  const gradeResult = () => result([{ type: "text", text: '{"verdict":"Good"}' }], "stop");

  it("lands the write as-is without spawning a revision loop", async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        if (isGradeCall(opts)) return gradeResult();
        n++;
        if (n === 1) return result([toolCall("a1", "get_rsi", {})], "tool-calls");
        if (n === 2)
          return result(
            [
              toolCall("a2", "report_write", {
                title: "Momentum",
                sections: [{ type: "paragraph", text: "RSI is 999999.", highlights: [{ text: "999999", kind: "number" }] }],
                sources: [],
              }),
            ],
            "tool-calls",
          );
        return result([{ type: "text", text: "done" }], "stop");
      },
    });

    const phases: string[] = [];
    const outcome = await runCanvasAnalysis({
      model: model as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [{ name: "get_rsi", description: "rsi", parameters: z.object({}), execute: async () => ({ rsi: 42 }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 10, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: null,
      onEvent: (e) => {
        if (e.type === "phase") phases.push(e.phase);
      },
    });

    // the write lands as-is: no assembly pass re-checks it, no revision loop
    expect(outcome.errors).toEqual([]);
    expect(outcome.status).toBe("completed"); // sections written
    // ONE loop only: exactly 3 model calls, no report_remove, one phase
    expect(n).toBe(3);
    expect(outcome.budgetUsed.steps).toBe(3);
    expect(outcome.budgetUsed.toolCalls).toBe(2); // rsi, bad write
    expect(JSON.stringify(outcome.trace)).not.toContain("report_remove");
    expect(phases).toEqual(["run"]);
    expect(outcome.verdict).toBe("Good"); // structured verdict, separate call
    expect(outcome.workspace["/AGENTS.md"]).toBeTruthy(); // root instructions doc seeded
  }, 30_000);

  it("saves the complete filesystem only when saveWorkspace is requested", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => result([{ type: "text", text: "done" }], "stop"),
    });
    const base = {
      model: model as any,
      soul: "",
      skills: [],
      prompt: "p",
      tools: [{ name: "get_rsi", description: "rsi", parameters: z.object({}), execute: async () => ({ rsi: 42 }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 5, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: null,
    };
    const plainRun = await runCanvasAnalysis({ ...base });
    expect(plainRun.workspaceFull).toBeUndefined(); // default (agent.yaml false)
    const fullRun = await runCanvasAnalysis({ ...base, saveWorkspace: true });
    expect(fullRun.workspaceFull?.["/AGENTS.md"]).toBeTruthy(); // full memfs incl. everything
    expect(fullRun.workspaceFull?.["/knowledge_base/sources/raw"]).toBeUndefined(); // files, not dirs
  }, 30_000);

  it("runs the whole budget in the one loop when assembly is clean", async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        n++;
        if (n === 1)
          return result(
            [
              toolCall("b1", "report_write", {
                title: "Snapshot",
                sections: [{ type: "paragraph", text: "RSI is 42.", highlights: [{ text: "42", kind: "number", sourceId: "s1" }] }],
                sources: [{ id: "s1", label: "TCS rsi", tool: "get_rsi", value: "42" }],
              }),
            ],
            "tool-calls",
          );
        if (n === 2) return result([toolCall("b2", "get_rsi", {})], "tool-calls");
        return result([{ type: "text", text: "done" }], "stop");
      },
    });

    const outcome = await runCanvasAnalysis({
      model: model as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [{ name: "get_rsi", description: "rsi", parameters: z.object({}), execute: async () => ({ rsi: 42 }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 10, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: null,
    });

    expect(outcome.errors).toEqual([]);
    expect(outcome.budgetUsed.steps).toBe(3);
    expect(JSON.stringify(outcome.trace)).not.toContain("report_remove");
  }, 30_000);

  it("does NOT rescue a run that researched to the budget without writing — it just fails", async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        n++;
        if (n === 1) return result([toolCall("r1", "get_rsi", {})], "tool-calls");
        // keeps researching through the whole (6-step) budget, even when the
        // deadline forces a write (mock ignores toolChoice)
        return result([toolCall(`r${n}`, "probe", {})], "tool-calls");
      },
    });

    const outcome = await runCanvasAnalysis({
      model: model as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [
        { name: "get_rsi", description: "rsi", parameters: z.object({}), execute: async () => ({ rsi: 42 }) },
        { name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) },
      ],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 6, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: null,
    });

    expect(outcome.status).toBe("failed");
    expect(n).toBe(6); // one loop, six steps — no seventh rescue call
    expect(outcome.budgetUsed.steps).toBe(6);
    expect(outcome.errors).toEqual(["agent stopped at the step/token budget"]);
  }, 30_000);

  it("format gaps ride the reminders each step", async () => {
    const prompts: any[] = [];
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompts.push(opts.prompt);
        n++;
        if (n === 1)
          return result(
            [
              toolCall("b1", "report_write", {
                title: "Snapshot",
                sections: [{ type: "paragraph", text: "RSI is 42." }],
                sources: [{ id: "s1", label: "TCS rsi", tool: "get_rsi", value: "42" }],
              }),
            ],
            "tool-calls",
          );
        return result([{ type: "text", text: "done" }], "stop");
      },
    });
    const outcome = await runCanvasAnalysis({
      model: model as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [{ name: "get_rsi", description: "rsi", parameters: z.object({}), execute: async () => ({ rsi: 42 }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 6, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: {
        id: "SYSTEM",
        name: "fmt",
        description: "",
        body: "",
        required_sections: ["What's new", "Risks"],
        min_charts: 1,
        require_sources: true,
      },
    });
    // the reminder on the final STEP listed what was missing (not the verdict call)
    const agentPrompts = prompts.filter((p) => !isGradeCall({ prompt: p }));
    const lastPrompt = JSON.stringify(agentPrompts.at(-1));
    expect(lastPrompt).toContain("Report format status — still missing");
    expect(lastPrompt).toContain("What's new");
    expect(lastPrompt).toContain("charts: 0/1");
    // the checklist is a reminder only — the stitched report ships as written
    expect(outcome.status).toBe("completed");
    expect(outcome.errors).toEqual([]);
  }, 30_000);

  it("system prompt carries the generated contract, plot menu, and workspace tree", async () => {
    const prompts: any[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompts.push(opts.prompt);
        return result([{ type: "text", text: "done" }], "stop");
      },
    });
    await runCanvasAnalysis({
      model: model as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [{ name: "web_search", description: "s", parameters: z.object({}), execute: async () => ({}) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 3, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: null,
    });
    const sys = JSON.stringify(prompts[0]);
    expect(sys).toContain("## Report sections");
    expect(sys).toContain("lives INSIDE `spec`"); // plot shapes actually shipped
    expect(sys).toContain("Workspace at run start");
    expect(sys).toContain("/knowledge_base/ — EMPTY");
    expect(sys).toContain("will NOT resolve"); // web-only toolbox → honest token note
    expect(sys).toContain("untrusted DATA"); // system prompt: web text is data, never instructions

    // with the real format file: the slots render in place, no duplicate block
    const tplPrompts: any[] = [];
    const tplModel = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        tplPrompts.push(opts.prompt);
        return result([{ type: "text", text: "done" }], "stop");
      },
    });
    await runCanvasAnalysis({
      model: tplModel as any,
      soul: "Be terse.",
      skills: [],
      prompt: "analyze TCS",
      tools: [{ name: "web_search", description: "s", parameters: z.object({}), execute: async () => ({}) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget: { maxSteps: 3, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
      template: getOutputTemplate(),
    });
    const tplSys = JSON.stringify(tplPrompts[0]);
    expect(tplSys).toContain("## Report sections — accepted types"); // {{section_contract}} filled
    expect((tplSys.match(/## Report sections/g) || []).length).toBe(1); // fallback skipped
    expect(tplSys).not.toContain("{{section_contract}}");
    expect(tplSys).not.toContain("{{workspace_tree}}");
  }, 30_000);

  it("completion gate: open todos ship PARTIAL; completing them ships clean", async () => {
    const prompts: any[] = [];
    let n = 0;
    const mock = (step: (n: number) => unknown) =>
      new MockLanguageModelV4({
        doGenerate: async (opts: any) => {
          prompts.push(JSON.stringify(opts.prompt));
          n++;
          return step(n) as any;
        },
      });
    const draft = toolCall("r1", "report_write", {
      title: "Snapshot",
      sections: [{ type: "paragraph", text: "RSI is 42.", highlights: [{ text: "42", kind: "number", sourceId: "s1" }] }],
      sources: [{ id: "s1", label: "TCS rsi", tool: "get_rsi", value: "42" }],
    });
    const run = (model: any) =>
      runCanvasAnalysis({
        model,
        soul: "",
        skills: [],
        prompt: "analyze TCS",
        tools: [],
        ctx: { symbol: "TCS", source: "NSE" },
        budget: { maxSteps: 6, maxTokens: 10_000, cbSessions: 3, cbSessionSteps: 8 },
        template: null,
      });

    // 1) plan opened, item still in_progress at stop → partial + gate error
    const open = await run(
      mock((i) =>
        i === 1
          ? result([toolCall("t1", "todo_write", { items: [{ id: "1", content: "write the report", status: "in_progress" }] })], "tool-calls")
          : i === 2
            ? result([draft], "tool-calls")
            : result([{ type: "text", text: "done" }], "stop"),
      ),
    );
    expect(open.status).toBe("partial");
    expect(open.errors.join(" ")).toContain("completion gate: 1 todo item(s) still open");
    expect(open.workspace[PATHS.planJson]).toContain("in_progress");
    expect(open.workspace[PATHS.planMd]).toContain("[>] write the report");
    // the live list rides the trailing reminder every step
    expect(prompts[1]).toContain("Todo list");
    expect(prompts[1]).toContain("[>] write the report");

    // 2) same flow, item completed before stop → no gate
    n = 0;
    const closed = await run(
      mock((i) =>
        i === 1
          ? result([toolCall("t1", "todo_write", { items: [{ id: "1", content: "write the report", status: "pending" }] })], "tool-calls")
          : i === 2
            ? result([draft], "tool-calls")
            : i === 3
              ? result([toolCall("t2", "todo_write", { items: [{ id: "1", content: "write the report", status: "completed" }] })], "tool-calls")
              : result([{ type: "text", text: "done" }], "stop"),
      ),
    );
    expect(closed.status).toBe("completed");
    expect(closed.errors.join(" ")).not.toContain("completion gate");
  }, 30_000);
});

describe("AGENTS.md (the one prompt + format file)", () => {
  it("loads from config/prompts — frontmatter intact, id selection ignored", () => {
    const tpl = getOutputTemplate("any-old-id");
    expect(tpl).toBeTruthy();
    expect(tpl!.id).toBe("AGENTS");
    expect(tpl!.name).toBe("Institutional equity research");
    expect(tpl!.body).toContain("# Institutional equity research");
    expect(tpl!.body).not.toMatch(/## Report structure/); // structure lives in the skill, not the prompt
    expect(tpl!.require_sources).toBe(true);
    expect(loadOutputTemplates()).toHaveLength(1);
    expect(getOutputTemplate()).toBeTruthy(); // plugged in with no id at all
  });
});

describe("loadRunConfigDoc (harness config dir)", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-config-"));

  it("strips HTML comments and caps at 200 lines", () => {
    const body = ["<!-- maintainer note -->", "# Standing rules", ...Array.from({ length: 300 }, (_, i) => `line ${i}`)];
    writeFileSync(join(dir, "STANDING.md"), body.join("\n"));
    const out = loadRunConfigDoc("STANDING.md", dir);
    expect(out).not.toContain("<!--");
    expect(out).toContain("# Standing rules");
    expect(out.split("\n").length).toBeLessThanOrEqual(200);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for a missing file (runs never depend on one)", () => {
    expect(loadRunConfigDoc("AGENTS.md", join(dir, "gone"))).toBe("");
  });
});

describe("loadAgentConfig (config/agent.yaml)", () => {
  it("merges a partial file over the defaults", () => {
    const d = mkdtempSync(join(tmpdir(), "harness-agent-cfg-"));
    writeFileSync(join(d, "agent.yaml"), "limits:\n  spillThresholdChars: 500\n");
    expect(loadAgentConfig(d).limits).toEqual({ spillThresholdChars: 500, spillHeadChars: 2_000 });
    expect(loadAgentConfig(d).run.saveWorkspace).toBe(false);
    expect(loadAgentConfig(d).prompts.agents).toBe(AGENT_CONFIG_DEFAULT.prompts.agents);
    rmSync(d, { recursive: true, force: true });
  });

  it("falls back to defaults for a missing or invalid file", () => {
    const d = mkdtempSync(join(tmpdir(), "harness-agent-cfg-"));
    expect(loadAgentConfig(d)).toEqual(AGENT_CONFIG_DEFAULT);
    writeFileSync(join(d, "agent.yaml"), ": not yaml [");
    expect(loadAgentConfig(d)).toEqual(AGENT_CONFIG_DEFAULT);
    rmSync(d, { recursive: true, force: true });
  });

  it("promptDoc maps the role to its file, stripping comments and frontmatter", () => {
    const d = mkdtempSync(join(tmpdir(), "harness-agent-cfg-"));
    mkdirSync(join(d, "prompts"), { recursive: true });
    writeFileSync(join(d, "agent.yaml"), "prompts:\n  agents: prompts/CUSTOM.md\n");
    writeFileSync(join(d, "prompts", "CUSTOM.md"), "---\nname: X\n---\n<!-- note -->\nYou are steady.\n");
    expect(promptDoc("agents", d)).toBe("You are steady.");
    expect(promptDoc("compaction", d)).toBe(""); // role maps to a missing file here
    rmSync(d, { recursive: true, force: true });
  });
});

describe("archiveResult compact view", () => {
  it("hands the model the payload head so prose sources don't need raw fs_reads", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const view: any = archiveResult(ws, {
      tool: "search_news",
      args: { query: "KEI Q2" },
      result: { count: 2, results: [{ title: "KEI tumbles 8%", url: "https://x.test", snippet: "shares fell on Q2 margins" }] },
      symbol: "KEI",
    });
    expect(view.snippet).toContain("KEI tumbles 8%");
    expect(view._source.path).toMatch(/^\/knowledge_base\/sources\//);
    expect(ws.stubs()).toHaveLength(1);
  });

  it("names search sources after the query so fs_ls reads like a table of contents", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const view: any = archiveResult(ws, {
      tool: "web_search",
      args: { query: "Apple fiscal 2026 full year results revenue EPS" },
      result: { count: 1, results: [{ title: "Apple FY2026", url: "https://x.test", content: "revenue $416B" }] },
      symbol: "AAPL",
    });
    expect(view._source.path).toBe("/knowledge_base/sources/AAPL_web_search_apple-fiscal-2026-full-year-results.json");
    expect(ws.read("/knowledge_base/sources/raw/AAPL_web_search_apple-fiscal-2026-full-year-results.json")).toContain("$416B");
  });

  it("does NOT archive a zero-result search (no empty sources to cite)", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const empty = { message: "Web search returned no results for this query.", query: "q", count: 0, results: [] };
    const out = archiveResult(ws, { tool: "web_search", args: { query: "q" }, result: empty, symbol: "AAPL" });
    expect(out).toEqual(empty); // handed through untouched, no _source pointer
    expect(ws.stubs()).toHaveLength(0);
    expect(ws.stats().files).toBe(0); // no source files written at all
  });

  it("does NOT archive a failed tool result ({error}) as a source", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const failed = { error: "status 404" };
    const out = archiveResult(ws, { tool: "web_fetch", args: { url: "https://x.test/404" }, result: failed, symbol: "AAPL" });
    expect(out).toEqual(failed);
    expect(ws.stubs()).toHaveLength(0);
    expect(ws.stats().files).toBe(0);
  });

  it("spills oversized prose results to /knowledge_base/tool-output/ with a head preview", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const prose = "line of filing text\n".repeat(500); // 10k chars > 8k threshold
    const out = archiveResult(ws, { tool: "mcp.filing_reader", args: { id: "x" }, result: prose, symbol: "AAPL" }) as any;
    expect(out.path).toMatch(/^\/knowledge_base\/tool-output\/[0-9a-f]{16}\.md$/);
    expect(out.total_chars).toBe(prose.length);
    expect(out.head.length).toBe(2_000);
    expect(out.head).toBe(prose.slice(0, 2_000));
    expect(ws.read(out.path)).toBe(prose);
    expect(ws.stubs()).toHaveLength(0); // spill ≠ citable source
    expect(String(out.message)).toContain("fs_read");
  });

  it("passes small prose through untouched", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const out = archiveResult(ws, { tool: "mcp.x", args: {}, result: "too small to spill", symbol: "AAPL" });
    expect(out).toBe("too small to spill");
    expect(ws.stats().files).toBe(0);
  });

  it("names web_fetch sources after the url, not a dedup counter", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    archiveResult(ws, { tool: "web_fetch", args: { url: "https://www.sec.gov/Archives/aapl-10k.htm" }, result: { url: "x", count: 1, results: [{ title: "t", url: "https://sec.gov" }] }, symbol: "AAPL" });
    const files = ws.ls("/knowledge_base/sources").filter((f) => f.endsWith(".json"));
    expect(files).toContain("AAPL_web_fetch_sec.gov_aapl-10k.htm.json");
    expect(files.some((f) => /-\d+\.json$/.test(f))).toBe(false); // no counter suffixes
  });

  it("spills oversized MCP text blocks (content[0].text prose)", async () => {
    const { archiveResult } = await import("../src/harness/workspace/archive.js");
    const ws = new Workspace();
    const prose = "report body ".repeat(900); // 10.8k chars
    const mcp = { content: [{ type: "text", text: prose }] };
    const out = archiveResult(ws, { tool: "mcp.reader", args: {}, result: mcp, symbol: "AAPL" }) as any;
    expect(out.path).toMatch(/^\/knowledge_base\/tool-output\//);
    expect(ws.read(out.path)).toBe(prose);
  });
});

describe("ToolLoopAgent loop (core agent loop)", () => {
  const usage = {
    inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 7, text: 7, reasoning: 0 },
  };
  const budget = { maxSteps: 10, maxTokens: 100_000, cbSessions: 3, cbSessionSteps: 8 };

  it("runs the ReAct loop: reasons, calls a tool, observes, repeats, then stops", async () => {
    const prompts: string[] = [];
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompts.push(JSON.stringify(opts.prompt ?? ""));
        n++;
        if (n <= 2)
          return {
            content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "probe", input: JSON.stringify({ i: n }) }],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage,
            rawCall: { rawPrompt: null, rawSettings: {} },
            warnings: [],
          } as any;
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    const seen: string[] = [];
    const out = await runAgentLoop({
      model: model as any,
      system: "Be terse.",
      prompt: "probe twice",
      tools: [{ name: "probe", description: "probe", parameters: z.object({ i: z.number() }), execute: async (a: any) => ({ echo: a.i }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget,
      onEvent: (e) => seen.push(e.type === "tool_result" ? `result:${JSON.stringify((e as any).result)}` : e.type),
    });
    expect(out.status).toBe("completed");
    expect(out.text).toBe("done");
    expect(out.steps).toBe(3);
    expect(out.tokens).toBe(21); // 3 steps × 7 output tokens
    expect(out.inputTokens).toBe(15);
    // tool_call → tool_result → tool_call → tool_result, all traced
    expect(out.trace.filter((e) => e.type === "tool_call")).toHaveLength(2);
    expect(seen).toContain('result:{"echo":1}');
    expect(seen).toContain('result:{"echo":2}');
    // step 2 sees the first observation in its history
    expect(prompts[1]).toContain("echo");
    expect(prompts[1]).toContain('"i":1');
  });

  it("overBudget stops the loop on the output-token budget (custom stop condition)", async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        n++;
        return {
          content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "probe", input: "{}" }],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 60, text: 60, reasoning: 0 },
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        } as any;
      },
    });
    const out = await runAgentLoop({
      model: model as any,
      system: "s",
      prompt: "p",
      tools: [{ name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      // step budget is 10, token budget dies after 2 steps (60+60 > 130)
      budget: { ...budget, maxTokens: 130 },
    });
    expect(out.steps).toBe(3); // 60, 120, 180 > 130 → stop
    expect(out.status).toBe("budget_exhausted");
    expect(n).toBe(3);
  });

  it("overBudget predicate sums output tokens from steps", async () => {
    const step = (outputTokens: number) => ({ usage: { outputTokens } });
    expect(await overBudget(100)({ steps: [step(60), step(50)] as any })).toBe(true);
    expect(await overBudget(100)({ steps: [step(60), step(40)] as any })).toBe(false);
    expect(await overBudget(100)({ steps: [] as any })).toBe(false);
  });

  it("createLoopAgent builds a serveable agent (createAgentUIStreamResponse)", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t0" });
            c.enqueue({ type: "text-delta", id: "t0", delta: "hello" });
            c.enqueue({ type: "text-end", id: "t0" });
            c.enqueue({ type: "finish", finishReason: "stop", usage, response: { id: "r1", modelId: "mock", timestamp: new Date() } });
            c.close();
          },
        }),
      }),
    });
    const agent = createLoopAgent({
      model: model as any,
      system: "Be terse.",
      tools: [{ name: "probe", description: "probe", parameters: z.object({}), execute: async () => ({ ok: true }) }],
      ctx: { symbol: "TCS", source: "NSE" },
      budget,
    });
    expect(agent.version).toBe("agent-v1");
    expect(Object.keys(agent.tools)).toEqual(["probe"]);
    const res = await serveAgentUIStream(agent, [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }]);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("hello");
  });
});
