/**
 * Live repro of the failing Technical Analysis skill, through the REAL
 * repo code path (buildModel + buildSkillTools + runAgentTurn), against
 * real Groq with the live key. Prints every harness attempt outcome so
 * we can see exactly where "Cannot read properties of undefined
 * (reading 'type')" fires and what the fallback attempts do.
 */
import { buildModel } from "./src/agent.js";
import { runAgentTurn } from "./src/harness.js";
import { buildSkillTools, type SkillRunContext } from "./src/skills/skillrun.js";

// Same text as skillrun.ts's SKILL_ANALYST_SYSTEM_PROMPT (not exported).
const SKILL_ANALYST_SYSTEM_PROMPT = `You are a focused equity-research analyst executing ONE skill of a larger investor-agent analysis.

Anti-hallucination rules (HARD CONSTRAINTS — a violation voids the analysis):
- Your training data is NOT a data source. You have exactly the tools listed for this skill, and they are the ONLY permitted source of facts.
- Call tools before concluding. Answering from memory with zero tool calls is a failure of this task, not a shortcut.
- Give a verdict for EVERY anchor listed.
- The pipeline computes all scores in code from your verdicts. You do not output scores.`;
import { keyPool } from "./src/keypool.js";
import { VoyagerClient } from "./src/voyager.js";
import { skillToPromptSection, type SkillDefinition } from "./src/skills/types.js";
import "dotenv/config";

const modelId = "groq/openai/gpt-oss-20b";
const llmKeys: Record<string, string | undefined> = {
  groq: (process.env.GROQ_API_KEYS || "").split(",")[0]?.trim() || process.env.GROQ_API_KEY,
  tavily: (process.env.TAVILY_API_KEYS || "").split(",")[0]?.trim(),
};
if (!llmKeys.groq) {
  console.log("no groq key in env");
  process.exit(0);
}
const { apiKey, keyRef } = keyPool.pickKey(modelId, llmKeys);
console.log("keyRef:", keyRef, "key prefix:", apiKey.slice(0, 6));

const model = buildModel(modelId, llmKeys, apiKey);

const toolCtx = {
  voyager: new VoyagerClient("http://127.0.0.1:1", "", 1), // unreachable: tool errors are part of the repro
  tavilyKey: llmKeys.tavily,
  symbol: "GLAND",
  country: "India",
  source: "nse",
  shareName: "Gland Pharma Limited",
  webSources: [] as string[],
};

// Faithful Technical Analysis skill (market category, real analyst tools).
const skill: SkillDefinition = {
  id: "technical-analysis",
  name: "Technical Analysis",
  description: "Price action, trend and momentum",
  category: "market",
  version: 1,
  purpose:
    "Assesses the stock's price action, trend structure, momentum and trading context — where the price sits relative to its recent range and what the tape says about conviction.",
  data: [
    "get_financial_metrics",
    "get_financials",
    "get_announcements",
    "get_shareholdings",
    "search_news",
    "web_search",
    "get_current_price",
  ],
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

const ctx: SkillRunContext = {
  toolCtx,
  modelId,
  llmKeys: llmKeys as any,
  persona: "",
  documents: [],
  webSearch: true,
  toolCatalog: [],
  onTrace: (ev: any) => {
    if (ev.type === "thought") console.log(`  [thought] ${String(ev.text || "").slice(0, 100)}`);
    else if (ev.type === "tool_call") console.log(`  [tool_call] ${ev.tool}`);
    else if (ev.type === "tool_result") console.log(`  [tool_result] ${ev.tool} ${ev.status}`);
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

console.log("\n=== runAgentTurn (forceTools, prepareStep) ===");
const turn = await runAgentTurn({
  model,
  system: SKILL_ANALYST_SYSTEM_PROMPT,
  prompt,
  temperature: 0.3,
  maxOutputTokens: 8192,
  tools,
  forceTools: true,
  maxToolSteps: 10,
  deadlineMs: 180_000,
  onEvent: (ev) => ctx.onTrace?.(ev as any),
});

console.log("\n=== RESULT ===");
console.log(
  JSON.stringify(
    {
      error: turn.error,
      streamError: turn.streamError,
      finishReason: turn.finishReason,
      textLen: turn.text.length,
      textHead: turn.text.slice(0, 200),
      toolCalls: turn.toolCalls.map((t: any) => t.tool_name),
      usage: turn.usage,
    },
    null,
    2,
  ),
);
process.exit(0);
