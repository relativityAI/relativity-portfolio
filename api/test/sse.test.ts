import { describe, it, expect } from "vitest";
import { stripNullishArrayHoles, sanitizeRequestBody, sanitizeSSEFetch } from "../src/sse.js";

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SSE = [
  'data: {"choices":[{"delta":{"content":[{"type":"text","text":"hi"},null]}}]}',
  "data: [DONE]",
  "",
].join("\n");

const readAll = async (res: Response) => await res.text();

describe("stripNullishArrayHoles", () => {
  it("drops null holes from a streamed delta.content array", () => {
    const payload = JSON.parse('{"choices":[{"delta":{"content":[{"type":"text","text":"hi"},null]}}]}');
    stripNullishArrayHoles(payload);
    expect(payload.choices[0].delta.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("recurses into nested arrays", () => {
    const payload = { a: [1, [2, null, 3], null] };
    stripNullishArrayHoles(payload);
    expect(payload.a).toEqual([1, [2, 3]]);
  });
});

describe("sanitizeSSEFetch", () => {
  it("cleans data lines of an event-stream response", async () => {
    const fakeFetch = (async () =>
      new Response(SSE, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;

    const out = await readAll(await sanitizeSSEFetch(fakeFetch)("https://example.test"));
    expect(out).toContain('"content":[{"type":"text","text":"hi"}]');
    expect(out).not.toContain("null");
    expect(out).toContain("data: [DONE]");
  });

  it("leaves non-SSE responses untouched", async () => {
    const fakeFetch = (async () =>
      new Response("null", { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    expect(await readAll(await sanitizeSSEFetch(fakeFetch)("https://example.test"))).toBe("null");
  });

  it("reassembles data lines split across network chunks", async () => {
    const chunked = (s: string, size: number) => {
      const bytes = new TextEncoder().encode(s);
      let i = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            while (i < bytes.length) {
              c.enqueue(bytes.slice(i, i + size));
              i += size;
            }
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const fakeFetch = (async () => chunked(SSE, 7)) as unknown as typeof fetch;

    // A partial line must never leak with a stray newline mid-JSON:
    // the reassembled output is byte-identical to whole-line delivery.
    const out = await readAll(await sanitizeSSEFetch(fakeFetch)("https://example.test"));
    expect(out).toBe(
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"hi"}]}}]}\ndata: [DONE]\n',
    );
  });
});

describe("sanitizeRequestBody", () => {
  it("strips the reasoning echo from assistant messages", () => {
    const body = JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "done", reasoning_content: "thinking…" },
        { role: "assistant", content: "more", reasoning: "hmm" },
      ],
    });
    const init = sanitizeRequestBody(CHAT_URL, { method: "POST", body });
    const parsed = JSON.parse((init as RequestInit).body as string);
    // Text content survives; the echo fields Groq rejects are gone.
    expect(parsed.messages[1]).toEqual({ role: "assistant", content: "done" });
    expect(parsed.messages[2]).toEqual({ role: "assistant", content: "more" });
  });

  it("returns the init unchanged when there is no echo", () => {
    const init = {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    };
    expect(sanitizeRequestBody(CHAT_URL, init)).toBe(init);
  });

  it("ignores non chat-completions URLs and bodiless requests", () => {
    const init = {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "assistant", reasoning: "x" }] }),
    };
    expect(sanitizeRequestBody("https://api.groq.com/openai/v1/embeddings", init)).toBe(init);
    expect(sanitizeRequestBody(CHAT_URL, { method: "GET" })).toEqual({ method: "GET" });
  });
});

describe("idle stream termination", () => {
  const stalledStream = (chunk?: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          if (chunk) c.enqueue(new TextEncoder().encode(chunk));
          // Never closes: the Groq held-open-stream shape.
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

  it("force-closes a chat stream that stalls after tool-call deltas", async () => {
    process.env.SSE_IDLE_TIMEOUT_MS = "80";
    try {
      const toolDelta =
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"fc_1","type":"function","function":{"name":"get_price","arguments":"{}"}}]}}]}\n\n';
      const fakeFetch = (async () => stalledStream(toolDelta)) as unknown as typeof fetch;
      const res = await sanitizeSSEFetch(fakeFetch)(CHAT_URL, { method: "POST" });
      const out = await readAll(res);
      // The missing terminal chunk is synthesized: the SDK can end
      // the step, execute the tool, and continue the loop.
      expect(out).toContain('"finish_reason":"tool_calls"');
      expect(out).toContain("data: [DONE]");
      // The delta itself passes through sanitized.
      expect(out).toContain("get_price");
    } finally {
      delete process.env.SSE_IDLE_TIMEOUT_MS;
    }
  }, 5_000);

  it("synthesizes finish stop for a text-only stalled stream", async () => {
    process.env.SSE_IDLE_TIMEOUT_MS = "80";
    try {
      const textDelta = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
      const fakeFetch = (async () => stalledStream(textDelta)) as unknown as typeof fetch;
      const res = await sanitizeSSEFetch(fakeFetch)(CHAT_URL, { method: "POST" });
      const out = await readAll(res);
      expect(out).toContain('"finish_reason":"stop"');
      expect(out).toContain("data: [DONE]");
    } finally {
      delete process.env.SSE_IDLE_TIMEOUT_MS;
    }
  }, 5_000);

  it("appends only [DONE] when the provider already sent finish_reason", async () => {
    process.env.SSE_IDLE_TIMEOUT_MS = "80";
    try {
      const finished = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
      const fakeFetch = (async () => stalledStream(finished)) as unknown as typeof fetch;
      const res = await sanitizeSSEFetch(fakeFetch)(CHAT_URL, { method: "POST" });
      const out = await readAll(res);
      expect(out.match(/finish_reason/g)?.length).toBe(1); // provider's own, not a duplicate
      expect(out).toContain("data: [DONE]");
    } finally {
      delete process.env.SSE_IDLE_TIMEOUT_MS;
    }
  }, 5_000);

  it("leaves a pre-output stall to the turn deadline (no termination)", async () => {
    process.env.SSE_IDLE_TIMEOUT_MS = "60";
    try {
      const fakeFetch = (async () => stalledStream()) as unknown as typeof fetch;
      const res = await sanitizeSSEFetch(fakeFetch)(CHAT_URL, { method: "POST" });
      const reader = res.body!.getReader();
      let closed = false;
      await Promise.race([
        reader.read().then(() => {
          closed = true;
        }),
        sleep(350),
      ]);
      expect(closed).toBe(false);
      await reader.cancel();
    } finally {
      delete process.env.SSE_IDLE_TIMEOUT_MS;
    }
  }, 5_000);

  it("does not terminate non-chat event streams", async () => {
    process.env.SSE_IDLE_TIMEOUT_MS = "60";
    try {
      const fakeFetch = (async () =>
        stalledStream('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')) as unknown as typeof fetch;
      const res = await sanitizeSSEFetch(fakeFetch)("https://example.test/embeddings", { method: "POST" });
      const reader = res.body!.getReader();
      let closed = false;
      await Promise.race([
        reader.read().then(() => {
          closed = true;
        }),
        sleep(350),
      ]);
      expect(closed).toBe(false);
      await reader.cancel();
    } finally {
      delete process.env.SSE_IDLE_TIMEOUT_MS;
    }
  }, 5_000);
});
