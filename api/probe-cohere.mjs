// Reproduce the skillrun path: Cohere + forced tool choice
import "dotenv/config";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool } from "ai";
import { z } from "zod";

const key = process.env.COHERE_API_KEYS?.split(",")[0];
console.log("key prefix:", key?.slice(0, 6));
const cohere = createOpenAICompatible({
  name: "cohere",
  baseURL: "https://api.cohere.ai/compatibility/v1",
  apiKey: key,
});

const tools = {
  get_financials: tool({
    description: "Get company financial data",
    inputSchema: z.object({ symbol: z.string().describe("Stock ticker") }),
    execute: async ({ symbol }) => ({ symbol, revenue: 1234 }),
  }),
};

// Test 1: plain text call (like the validate probe that passed)
try {
  const r = await generateText({ model: cohere("command-r7b-12-2024"), prompt: "Say OK", maxOutputTokens: 16 });
  console.log("1. plain text -> OK:", JSON.stringify(r.text.slice(0, 30)));
} catch (e) {
  console.log("1. plain text -> FAIL:", e?.statusCode, e?.name, String(e?.message).slice(0, 200));
  console.log("   body:", JSON.stringify(e?.responseBody || "").slice(0, 300));
}

// Test 2: forced tool call (like skillrun step 0)
try {
  const r = await generateText({
    model: cohere("command-r7b-12-2024"),
    prompt: "Get the financials for KEI.NS",
    tools,
    toolChoice: "required",
    maxOutputTokens: 512,
  });
  console.log("2. forced tool -> OK:", JSON.stringify(r.toolCalls?.map(t => t.toolName)));
} catch (e) {
  console.log("2. forced tool -> FAIL:", e?.statusCode, e?.name, String(e?.message).slice(0, 200));
  console.log("   body:", JSON.stringify(e?.responseBody || "").slice(0, 400));
}
