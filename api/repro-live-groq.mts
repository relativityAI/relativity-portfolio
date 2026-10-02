/**
 * Live repro: real Groq gpt-oss-20b, raw fetch vs sanitized fetch.
 * Prints which error parts appear and whether tool calls survive.
 */
import { streamText } from "ai";
import { createOpenAICompatible as _create } from "@ai-sdk/openai-compatible";
import { sanitizeSSEFetch } from "./src/sse.js";
import "dotenv/config";

const key = (process.env.GROQ_API_KEYS || "").split(",")[0]?.trim() || process.env.GROQ_API_KEY;
if (!key) {
  console.log("no groq key");
  process.exit(0);
}

async function run(label: string, useSanitize: boolean) {
  const fetchImpl = useSanitize ? sanitizeSSEFetch(fetch) : fetch;
  const model = _create({
    name: "groq",
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
    fetch: fetchImpl,
  })("openai/gpt-oss-20b");

  try {
    const result = streamText({
      model,
      system: "You are an analyst. Call the tool first.",
      prompt: "What is the stock symbol for Gland Pharma? Use the tool.",
      temperature: 0.3,
      maxOutputTokens: 2000,
      tools: {
        web_search: {
          description: "Search the web",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          execute: async () => ({ results: [{ title: "Gland Pharma", url: "https://example.com", snippet: "GLAND" }] }),
        },
      },
    });
    let text = "";
    const toolCalls: string[] = [];
    const errors: string[] = [];
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") toolCalls.push(part.toolName);
      if (part.type === "error") errors.push(String((part as any).error?.message ?? part.error).slice(0, 300));
    }
    console.log(`\n[${label}] textLen=${text.length} toolCalls=${toolCalls.join(",") || "NONE"}`);
    console.log(`[${label}] errorParts=${errors.length}`);
    for (const e of errors.slice(0, 3)) console.log(`   - ${e}`);
    console.log(`[${label}] textHead=${JSON.stringify(text.slice(0, 150))}`);
  } catch (e: any) {
    console.log(`\n[${label}] THREW ${e?.name}: ${String(e?.message).slice(0, 300)}`);
  }
}

await run("RAW", false);
await run("SANITIZED", true);
