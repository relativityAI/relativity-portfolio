// Escalate toward the real skillrun request shape: many tools, streaming,
// parallel tool calls, system prompt — find what trips Cohere's 400.
import "dotenv/config";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";

const key = process.env.COHERE_API_KEYS?.split(",")[0];
const cohere = createOpenAICompatible({ name: "cohere", baseURL: "https://api.cohere.ai/compatibility/v1", apiKey: key });

const mk = (name, fields) => tool({
  description: `Tool ${name}: ` + "x".repeat(80),
  inputSchema: z.object(Object.fromEntries(fields.map(f => [f, z.string().describe(f)]))),
  execute: async (args) => ({ ok: true, ...args }),
});

const tools = {
  get_company_snapshot: mk("get_company_snapshot", ["symbol", "country"]),
  get_financial_metrics: mk("get_financial_metrics", ["symbol", "metric", "period"]),
  get_cash_flow: mk("get_cash_flow", ["symbol", "period"]),
  get_balance_sheet: mk("get_balance_sheet", ["symbol", "period"]),
  get_income_statement: mk("get_income_statement", ["symbol", "period"]),
  search_web: mk("search_web", ["query", "recency"]),
  get_filings: mk("get_filings", ["symbol", "form_type"]),
};

const system = "You are an equity analyst. You MUST call a data tool before scoring. ".repeat(6);

async function attempt(label, fn) {
  try { await fn(); console.log(label, "-> OK"); }
  catch (e) {
    console.log(label, "-> FAIL:", e?.statusCode, e?.name, "|", String(e?.message).slice(0, 150));
    const body = e?.responseBody || e?.data;
    if (body) console.log("   body:", JSON.stringify(body).slice(0, 400));
  }
}

await attempt("3. many tools, non-stream", () => generateText({
  model: cohere("command-r7b-12-2024"),
  system,
  prompt: "Analyze KEI Industries (KEI.NS). Call get_company_snapshot first.",
  tools, toolChoice: "required", maxOutputTokens: 512,
}));

await attempt("4. streaming (skillrun uses streamText)", () => {
  const r = streamText({
    model: cohere("command-r7b-12-2024"),
    system,
    prompt: "Analyze KEI Industries (KEI.NS). Call get_company_snapshot first.",
    tools, toolChoice: "required", maxOutputTokens: 512,
  });
  return r.text;
});
