/**
 * A/B test to localize the 180s hang:
 *  A) model built via buildModel (sanitizeFetch wrapper)
 *  B) model built with RAW createOpenAICompatible (no wrapper)
 * Plus: direct get_financial_metrics execute() timing.
 */
import { streamText, isStepCount } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

// Direct tool execution timing
console.log("=== direct get_financial_metrics execute() ===");
const t0 = Date.now();
try {
  const out = await (tools.get_financial_metrics as any).execute({ symbol: "GLAND", source: "nse", filing_type: "ttm" });
  console.log(`execute returned in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(out).slice(0, 200));
} catch (e: any) {
  console.log(`execute threw in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e?.message);
}

async function run(label: string, model: any) {
  console.log(`\n=== ${label} ===`);
  const t = Date.now();
  const result = streamText({
    model,
    system: SKILL_ANALYST_SYSTEM_PROMPT,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 8192,
    tools,
    stopWhen: isStepCount(4),
    abortSignal: AbortSignal.timeout(60_000),
    prepareStep: (async ({ stepNumber }: { stepNumber: number }) => {
      if (stepNumber === 0) return { toolChoice: "required" as const, activeTools: Object.keys(tools) };
      return {};
    }) as any,
  });
  let parts = 0;
  let toolCalls = 0;
  let sawFinishStep = 0;
  for await (const part of result.fullStream) {
    parts++;
    const t2 = (part as any)?.type;
    if (t2 === "tool-call") { toolCalls++; console.log(`+${((Date.now() - t) / 1000).toFixed(1)}s tool-call ${(part as any).toolName}`); }
    if (t2 === "tool-result") console.log(`+${((Date.now() - t) / 1000).toFixed(1)}s tool-result`);
    if (t2 === "finish-step") sawFinishStep++;
    if (t2 === "error") console.log(`+${((Date.now() - t) / 1000).toFixed(1)}s ERROR:`, String((part as any).error?.message ?? (part as any).error));
    if (t2 === "abort") console.log(`+${((Date.now() - t) / 1000).toFixed(1)}s ABORT:`, JSON.stringify((part as any).reason));
    if (t2 === "finish") console.log(`+${((Date.now() - t) / 1000).toFixed(1)}s FINISH`);
  }
  console.log(`${label}: parts=${parts} toolCalls=${toolCalls} finishSteps=${sawFinishStep} elapsed=${((Date.now() - t) / 1000).toFixed(1)}s`);
}

const modelA = buildModel(modelId, llmKeys, apiKey); // sanitized fetch
const modelB = createOpenAICompatible({ name: "groq", apiKey, baseURL: "https://api.groq.com/openai/v1" })(modelId.slice(modelId.indexOf("/") + 1)); // raw fetch

await run("A-sanitized", modelA);
await run("B-raw", modelB);
process.exit(0);
