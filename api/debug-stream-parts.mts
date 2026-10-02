/**
 * Direct streamText probe: log EVERY fullStream part so we can see
 * exactly where the groq gpt-oss-20b tool loop terminates and
 * whether an error part fires.
 */
import { streamText, isStepCount } from "ai";
import { buildModel } from "./src/agent.js";
import { buildSkillTools, type SkillRunContext } from "./src/skills/skillrun.js";
import { keyPool } from "./src/keypool.js";
import { VoyagerClient } from "./src/voyager.js";
import { skillToPromptSection, type SkillDefinition } from "./src/skills/types.js";
import "dotenv/config";

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
const model = buildModel(modelId, llmKeys, apiKey);

const toolCtx = {
  voyager: new VoyagerClient("http://127.0.0.1:1", "", 1),
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

const ctx: SkillRunContext = { toolCtx, modelId, llmKeys: llmKeys as any, persona: "", documents: [], webSearch: true, toolCatalog: [], onTrace: () => {} };
const tools = buildSkillTools(ctx, skill);

const prompt = [
  `The subject of this analysis is the company Gland Pharma Limited (GLAND) on NSE (India). Everything below refers to THIS company and no other.`,
  `\n${skillToPromptSection(skill)}`,
  `\n## Your task\nWork through this skill's Method now. Call the listed tools FIRST, gather evidence, then return JSON with findings, verdicts and tools_used.`,
  `Web search is enabled.`,
].join("\n");

const result = streamText({
  model,
  system: SKILL_ANALYST_SYSTEM_PROMPT,
  prompt,
  temperature: 0.3,
  maxOutputTokens: 8192,
  tools,
  stopWhen: isStepCount(10),
  abortSignal: AbortSignal.timeout(180_000),
  prepareStep: (async ({ stepNumber }: { stepNumber: number }) => {
    if (stepNumber === 0) return { toolChoice: "required" as const, activeTools: Object.keys(tools) };
    return {};
  }) as any,
  repairToolCall: (async () => null) as any,
});

const t0 = Date.now();
let n = 0;
let sawFinish = false;
let textChars = 0;
let reasoningChars = 0;
for await (const part of result.fullStream) {
  n++;
  const t = (part as any)?.type;
  if (t === "text-delta") { textChars += ((part as any).text || "").length; continue; }
  if (t === "reasoning-delta") { reasoningChars += ((part as any).text || "").length; continue; }
  if (t === "finish") sawFinish = true;
  const extra =
    t === "error" ? String((part as any).error?.message ?? (part as any).error)
    : t === "tool-call" ? (part as any).toolName
    : t === "abort" ? `reason=${JSON.stringify((part as any).reason)}`
    : "";
  console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s part#${n} ${t} ${extra}`);
}
console.log(`\ntotal parts: ${n} sawFinish=${sawFinish} textChars=${textChars} reasoningChars=${reasoningChars}`);
try {
  const steps = await result.steps;
  console.log("steps:", steps.length);
  for (const [i, s] of steps.entries()) console.log(`  step${i} finishReason=${s.finishReason} toolCalls=${s.toolCalls?.length ?? 0}`);
} catch (e: any) {
  console.log("steps rejected:", e?.message);
}
try {
  console.log("usage:", JSON.stringify(await result.usage));
} catch (e: any) {
  console.log("usage rejected:", e?.message);
}
try {
  console.log("text len:", (await result.text).length);
} catch (e: any) {
  console.log("text rejected:", e?.message);
}
process.exit(0);
