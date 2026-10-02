// Reproduce the REAL skillrun request: full-size system+prompt, real toolset
// size, streaming, 8192 maxOutputTokens, toolChoice required on step 0.
import "dotenv/config";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, tool } from "ai";
import { z } from "zod";

const key = process.env.COHERE_API_KEYS?.split(",")[0];
const cohere = createOpenAICompatible({ name: "cohere", baseURL: "https://api.cohere.ai/compatibility/v1", apiKey: key });

const mk = (name, desc, fields) => tool({
  description: desc,
  inputSchema: z.object(Object.fromEntries(fields.map(f => [f, z.string().describe(f)]))),
  execute: async (args) => ({ ok: true, ...args }),
});

// ~10 tools with LONG descriptions like the real analyst catalog
const tools = {
  get_company_snapshot: mk("snapshot", "Full company profile, sector, listing details, market cap, and latest price for the given symbol on its exchange. Use this first for any new company.", ["symbol", "country", "source"]),
  get_financial_metrics: mk("metrics", "Historical financial metrics (revenue growth, margins, ROE, ROIC, leverage, FCF, etc.) for a symbol over multiple fiscal periods with source citations.", ["symbol", "metrics", "periods", "source", "country"]),
  get_income_statement: mk("income", "Multi-year income statement lines: revenue, gross profit, operating income, net income, EPS, with YoY changes and citations.", ["symbol", "periods", "source"]),
  get_balance_sheet: mk("balance", "Multi-year balance sheet: cash, debt, equity, working capital, assets, liabilities with citations.", ["symbol", "periods", "source"]),
  get_cash_flow: mk("cashflow", "Multi-year cash flow statement: operating cash flow, capex, free cash flow, buybacks, dividends, with citations.", ["symbol", "periods", "source"]),
  get_analyst_estimates: mk("estimates", "Consensus analyst estimates for revenue, EPS, growth rates across future fiscal years.", ["symbol", "metrics", "periods"]),
  get_sec_filings: mk("filings", "Search recent company filings and annual reports for a symbol by form type with links.", ["symbol", "form_type", "limit"]),
  get_market_news: mk("news", "Recent market news stories for a company with sentiment tags and source links.", ["symbol", "days", "limit"]),
  web_search: mk("web", "General web search with recency filtering for qualitative evidence.", ["query", "recency_days"]),
  get_pull_job_status: mk("jobstatus", "Check the status of an asynchronous data pull job.", ["job_id"]),
};

const system = "You are a focused equity-research analyst executing ONE skill of a larger investor-agent analysis.\n\nYou MUST ground every claim in tool data. Never answer from memory. Call the listed data tools to gather evidence before producing verdicts. Each verdict must cite the specific tool result you used. If data is unavailable through tools, mark the verdict INSUFFICIENT rather than guessing.\n\nOutput contract: after gathering evidence, return JSON with findings, verdicts (one per anchor), and tools_used.\n\n";
const prompt = `The subject of this analysis is the company KEI Industries Limited (KEI.NS) on NSE (in). Everything below refers to THIS company and no other.

## Investor agent persona
Warren Buffett — durable moats, high ROIC, low leverage, honest management.

## Skill: DCF Valuation
Estimate intrinsic value via discounted cash flow. Anchors: FCF track record; Capex intensity; Debt load vs earnings power.

## Your task
Work through this skill's Method now. Call the listed tools, gather evidence, then return JSON with:
- findings: 2-6 specific, evidence-backed findings
- verdicts: one entry per anchor
- tools_used: the tool names you actually called

Web search is disabled — rely on internal data tools only.`;

try {
  const r = streamText({
    model: cohere("command-r7b-12-2024"),
    system,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 8192,
    tools,
    toolChoice: "required",
  });
  let text = "";
  for await (const chunk of r.textStream) text += chunk;
  const fin = await r.finishReason;
  console.log("5. full skillrun shape -> OK, finishReason:", fin, "textLen:", text.length);
} catch (e) {
  console.log("5. full skillrun shape -> FAIL:", e?.statusCode, e?.name, "|", String(e?.message).slice(0, 250));
  const body = e?.responseBody || e?.data || e?.value;
  if (body) console.log("   body:", JSON.stringify(body).slice(0, 600));
}
