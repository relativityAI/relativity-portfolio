/**
 * End-to-end verification of the Technical Analysis skill path.
 *
 *  - Live Groq (groq/openai/gpt-oss-20b) through buildModel → the sse.ts
 *    fetch wrapper (both fixes active: request-side reasoning-content strip
 *    + response-side null-hole strip).
 *  - Mock Voyager on 127.0.0.1:8799 serving realistic GLAND data so the
 *    tool loop can complete the way it does in production.
 *  - A wire-dumping fetch wrapper installed BELOW the sse.ts wrapper
 *    (global fetch is replaced before agent.ts loads, so sanitizeSSEFetch
 *    captures the dumper as its base). The dump shows the RAW groq stream:
 *    request bodies (reasoning echo check) and every SSE data line (null
 *    hole check) — the two bugs this file exists to validate.
 *
 * Scratch file — delete after verification.
 */
// dotenv first (env reads at module-load time), then the wire dumper —
// a side-effect module that replaces globalThis.fetch. It MUST be
// installed before any repo module evaluates: agent.ts captures
// `fetch` at module-load time for sanitizeSSEFetch(), and the static
// imports below (skillrun.js → agent.js) are hoisted above any code
// in this file's body.
import "dotenv/config";
import "./wire-dumper.mts";
import http from "node:http";
import { runAgentTurn } from "./src/harness.js";
import { keyPool } from "./src/keypool.js";
import { VoyagerClient } from "./src/voyager.js";
import { buildSkillTools, type SkillRunContext } from "./src/skills/skillrun.js";
import { skillToPromptSection, type SkillDefinition } from "./src/skills/types.js";
import { wireDumpDrain } from "./wire-dumper.mts";

const { buildModel } = await import("./src/agent.js");

// ── mock Voyager ──────────────────────────────────────────────────────────
const METRICS = {
  symbol: "GLAND", source: "nse", filing_type: "ttm", consolidated: true, data_available: true,
  as_of: "2026-09-30",
  market_cap: 148500000000,
  price_to_earnings_ratio: 27.9,
  price_to_book_ratio: 3.05,
  price_to_sales_ratio: 4.7,
  earnings_yield: 3.58,
  peg_ratio: 2.1,
  return_on_equity: 11.4,
  return_on_capital_employed: 15.2,
  return_on_assets: 8.9,
  net_profit_margin: 16.6,
  operating_margin: 22.8,
  ebitda_margin: 26.3,
  revenue_growth: 9.2,
  net_profit_growth: 13.7,
  eps: 43.1,
  book_value_per_share: 392.4,
  dividend_yield: 0.85,
  debt_to_equity_ratio: 0.07,
  current_ratio: 3.4,
  quick_ratio: 2.1,
  interest_coverage_ratio: 48.0,
  dividend_payout_ratio: 24.0,
  free_cash_flow_yield: 2.9,
  ev_to_ebitda: 18.6,
  ev_to_sales: 4.2,
  insider_ownership: 56.4,
  pledged_shares: 0.0,
};
const ANNOUNCEMENTS = [
  { heading: "Gland Pharma Q2 FY26 results: consolidated net profit up 14% YoY to ₹312 Cr", date: "2026-07-28", category: "results", attachment: "q2fy26-results.pdf" },
  { heading: "Board approves ₹200 Cr buyback proposal", date: "2026-08-12", category: "corporate-action", attachment: "" },
  { heading: "USFDA inspection closure at Sitarampur facility with no observations", date: "2026-09-02", category: "regulatory", attachment: "" },
  { heading: "Gland Pharma launches injectable oncology product in the EU", date: "2026-09-20", category: "product-launch", attachment: "" },
];
const SHAREHOLDINGS = [
  { category: "Promoters", percentage: 56.4, change: 0.0 },
  { category: "FII", percentage: 8.2, change: 0.6 },
  { category: "DII", percentage: 12.8, change: 1.1 },
  { category: "Mutual Funds", percentage: 9.4, change: 0.8 },
  { category: "Public / Others", percentage: 13.2, change: -2.5 },
];
const FINANCIALS = {
  income_statements: [
    { period: "FY25", revenue: 62100000000, operating_income: 14160000000, net_income: 10310000000, eps: 31.2 },
    { period: "FY24", revenue: 56800000000, operating_income: 12400000000, net_income: 9060000000, eps: 27.4 },
  ],
  balance_sheets: [
    { period: "FY25", total_assets: 108000000000, total_debt: 2100000000, total_equity: 59200000000, current_assets: 48600000000 },
    { period: "FY24", total_assets: 99700000000, total_debt: 2400000000, total_equity: 51400000000, current_assets: 43200000000 },
  ],
  cash_flows: [
    { period: "FY25", operating_cash_flow: 12900000000, investing_cash_flow: -9800000000, financing_cash_flow: -3100000000, free_cash_flow: 3100000000 },
    { period: "FY24", operating_cash_flow: 11400000000, investing_cash_flow: -8600000000, financing_cash_flow: -2800000000, free_cash_flow: 2800000000 },
  ],
};
const PULL_STATUS = {
  symbol: "GLAND", source: "nse", available: true,
  last_pull: "2026-09-30T06:00:00Z",
  total_records: 1842,
  record_counts: { income_statements: 11, balance_sheets: 11, cash_flows: 11, announcements: 210, shareholdings: 48, financial_metrics: 96 },
};
const SEARCH_RESULTS = [
  { symbol: "GLAND", name: "Gland Pharma Limited", source: "nse", record_counts: { financial_metrics: 96, announcements: 210 } },
];

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  const json = (code: number, data: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const p = u.pathname;
  if (p === "/financial-metrics") return json(200, METRICS);
  if (p === "/financial-metrics/batch") return json(200, { metrics: { GLAND: METRICS } });
  if (p === "/financials/income-statements") return json(200, { income_statements: FINANCIALS.income_statements });
  if (p === "/financials/balance-sheets") return json(200, { balance_sheets: FINANCIALS.balance_sheets });
  if (p === "/financials/cash-flows") return json(200, { cash_flows: FINANCIALS.cash_flows });
  if (p === "/financials") return json(200, FINANCIALS);
  if (p === "/announcements") return json(200, ANNOUNCEMENTS);
  if (p === "/shareholdings") return json(200, SHAREHOLDINGS);
  if (p === "/search") return json(200, SEARCH_RESULTS);
  if (p === "/pull" || p === "/status") return json(200, PULL_STATUS);
  return json(404, { detail: `no mock route for ${p}` });
});
await new Promise<void>((r) => server.listen(8799, "127.0.0.1", r));
console.log("mock voyager on 127.0.0.1:8799");

// ── the skill turn (mirrors skillrun.ts:381) ─────────────────────────────
const SKILL_ANALYST_SYSTEM_PROMPT = `You are a focused equity-research analyst executing ONE skill of a larger investor-agent analysis.

Anti-hallucination rules (HARD CONSTRAINTS — a violation voids the analysis):
- Your training data is NOT a data source. You have exactly the tools listed for this skill, and they are the ONLY permitted source of facts.
- Call tools before concluding. Answering from memory with zero tool calls is a failure of this task, not a shortcut.
- Give a verdict for EVERY anchor listed.
- The pipeline computes all scores in code from your verdicts. You do not output scores.`;

const modelId = "groq/openai/gpt-oss-20b";
const llmKeys: Record<string, string | undefined> = {
  groq: (process.env.GROQ_API_KEYS || "").split(",")[0]?.trim() || process.env.GROQ_API_KEY,
  tavily: (process.env.TAVILY_API_KEYS || "").split(",")[0]?.trim(),
};
const { apiKey } = keyPool.pickKey(modelId, llmKeys);

const toolCtx = {
  voyager: new VoyagerClient("http://127.0.0.1:8799", "", 60),
  tavilyKey: llmKeys.tavily,
  symbol: "GLAND",
  country: "India",
  source: "nse",
  shareName: "Gland Pharma Limited",
  webSources: [] as string[],
};

const skill: SkillDefinition = {
  id: "technical-analysis",
  name: "Technical Analysis",
  description: "Price action, trend and momentum",
  category: "market",
  version: 1,
  purpose: "Assesses the stock's price action, trend structure, momentum and trading context.",
  data: ["get_financial_metrics", "get_financials", "get_announcements", "get_shareholdings", "search_news", "web_search", "get_current_price"],
  method: [
    "Call get_current_price for the live last close and as-of date.",
    "Call get_financial_metrics (filing_type=ttm) for valuation ratios.",
    "Call search_news for the latest price-action commentary.",
    "Judge trend/range/momentum ONLY from figures the tools returned.",
  ],
  anchors: [
    { label: "The current price sits within its recent trading range", weight: 6 },
    { label: "Recent price action shows conviction (volume/news-backed moves)", weight: 4 },
  ],
  charts: [],
  source: "builtin",
};

const trace: string[] = [];
let reasoningChars = 0;
const ctx: SkillRunContext = {
  toolCtx,
  modelId,
  llmKeys: llmKeys as any,
  persona: "",
  documents: [],
  webSearch: true,
  toolCatalog: [],
  onTrace: (ev: any) => {
    if (ev.type === "thought") { reasoningChars += String(ev.text || "").length; trace.push(`[thought +${String(ev.text || "").length}ch] ${String(ev.text || "").slice(0, 120)}`); }
    else if (ev.type === "tool_call") trace.push(`[tool_call] ${ev.tool} ${JSON.stringify(ev.args ?? {}).slice(0, 120)}`);
    else if (ev.type === "tool_result") trace.push(`[tool_result] ${ev.tool} ${ev.status}`);
    else if (ev.type === "log") trace.push(`[log] ${String(ev.data ?? "").slice(0, 160)}`);
  },
};

const tools = buildSkillTools(ctx, skill);
console.log("skill tools:", Object.keys(tools).join(", "));

const prompt = [
  `The subject of this analysis is the company Gland Pharma Limited (GLAND) on NSE (India). Everything below refers to THIS company and no other.`,
  `\n${skillToPromptSection(skill)}`,
  `\n## Your task\nWork through this skill's Method now. Call the listed tools FIRST, gather evidence, then return JSON with findings, verdicts and tools_used.`,
  `Web search is enabled.`,
].join("\n");

console.log("\n=== runAgentTurn (production params: forceTools, 180s deadline) ===");
const t0 = Date.now();
const turn = await runAgentTurn({
  model: buildModel(modelId, llmKeys, apiKey),
  system: SKILL_ANALYST_SYSTEM_PROMPT,
  prompt,
  temperature: 0.3,
  maxOutputTokens: 8192,
  tools,
  forceTools: true,
  maxToolSteps: 10,
  deadlineMs: Number(process.env.E2E_DEADLINE_MS || 180_000),
  onEvent: (ev) => ctx.onTrace?.(ev as any),
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== RESULT (${elapsed}s) ===`);
console.log("error:", turn.error ?? "(none)");
console.log("retryable:", turn.retryable);
console.log("finishReason:", turn.finishReason);
console.log("text chars:", turn.text.length);
console.log("toolCalls:", JSON.stringify((turn.toolCalls ?? []).map((tc: any) => tc.tool_name ?? tc.name)));
console.log("steps:", turn.steps.length);
console.log("reasoning chars captured:", reasoningChars);
console.log("\n--- trace ---");
for (const line of trace) console.log(line);
if (turn.text) {
  console.log("\n--- text (first 1200) ---");
  console.log(turn.text.slice(0, 1200));
}

server.close();
// Let the dumper finish reading the response tee before the process exits.
await wireDumpDrain();
process.exit(0);
