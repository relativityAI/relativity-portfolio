/**
 * Repro: Groq gpt-oss streams `delta.content` arrays containing null
 * holes. @ai-sdk/openai-compatible@3.0.41 does `part.type` with no
 * null guard -> TypeError "Cannot read properties of undefined
 * (reading 'type')" mid-stream.
 *
 * This script runs the REAL provider (createOpenAICompatible with the
 * app's sanitizeFetch) against a fake SSE server that:
 *  A) streams a content array with a null hole
 *  B) splits SSE lines across chunk boundaries (real network behavior)
 */
import { streamText } from "ai";
import { createOpenAICompatible as _create } from "@ai-sdk/openai-compatible";
import { sanitizeSSEFetch } from "./src/sse.js";



function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// A realistic gpt-oss stream: reasoning deltas, a null content hole,
// a tool call, then finish.
const lines = [
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "thinking..." } }] },
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: [null] } }] }, // ← the killer
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: [{ type: "text", text: "hello" }] } }] },
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: "" } }] } }] },
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"query\":\"test\"}" } }] } }] },
  { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];

const body = lines.map(sse).join("");

async function run(label: string, chunkSize: number, useSanitize: boolean) {
  // Fake fetch returning the body in fixed-size chunks to simulate
  // arbitrary network chunk boundaries.
  const fakeFetch = (async (_input: any, _init: any) => {
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= body.length) {
          controller.close();
          return;
        }
        const piece = body.slice(i, i + chunkSize);
        i += chunkSize;
        controller.enqueue(new TextEncoder().encode(piece));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  const create = useSanitize
    ? (o: any) => _create({ fetch: sanitizeSSEFetch(fakeFetch), ...o })
    : (o: any) => _create({ fetch: fakeFetch, ...o });
  const model = create({ name: "groq", apiKey: "test", baseURL: "https://api.groq.com/openai/v1" })("gpt-oss-20b");

  try {
    const result = streamText({
      model,
      prompt: "hi",
      maxOutputTokens: 100,
      tools: {
        web_search: {
          description: "search",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          execute: async () => ({ results: [] }),
        },
      },
    });
    let text = "";
    const toolCalls: string[] = [];
    let sawErrorPart = false;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") toolCalls.push(part.toolName);
      if (part.type === "error") {
        sawErrorPart = true;
        console.log(`[${label}] error part:`, String((part as any).error?.message ?? part.error));
      }
    }
    const steps = await result.steps;
    console.log(`[${label}] OK text=${JSON.stringify(text)} toolCalls=${toolCalls.join(",")} steps=${steps.length}`);
  } catch (e: any) {
    console.log(`[${label}] THREW: ${e?.name}: ${e?.message}`);
  }
}

// A: null hole, lines whole (chunkSize large enough)
await run("A1 null-hole, whole lines, sanitized", 65536, true);
await run("A2 null-hole, whole lines, RAW (no sanitize)", 65536, false);
// B: null hole, lines split across 37-byte chunks
await run("B1 null-hole, 37B chunks, sanitized", 37, true);
await run("B2 null-hole, 37B chunks, RAW", 37, false);
