// Reproduce skillrun's structured extraction against Cohere compat:
// generateObject with the real schema — default mode vs mode:"tool".
import "dotenv/config";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const key = process.env.COHERE_API_KEYS?.split(",")[0];
const cohere = createOpenAICompatible({
  name: "cohere",
  baseURL: "https://api.cohere.ai/compatibility/v1",
  apiKey: key,
});
const model = cohere("command-r7b-12-2024");

const Schema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().max(200),
        detail: z.string().max(2000),
        citations: z.array(z.object({ source: z.string(), value: z.string() })).max(6).default([]),
      }),
    )
    .max(8)
    .default([]),
  verdicts: z
    .array(
      z.object({
        anchor: z.string().max(300),
        verdict: z.enum(["YES", "PARTIAL", "NO", "INSUFFICIENT"]),
        evidence: z.string().max(500),
        citations: z.array(z.object({ source: z.string(), value: z.string() })).max(6).default([]),
      }),
    )
    .default([]),
  chart_requests: z.array(z.object({ spec_index: z.number() })).default([]),
  tools_used: z.array(z.string()).default([]),
});

const system =
  "Convert the analyst's research into the exact JSON shape requested. " +
  'findings MUST be an array of OBJECTS like {"title": str, "detail": str} — never plain strings. ' +
  'verdicts MUST be an array of OBJECTS like {"anchor": str, "verdict": "YES"|"PARTIAL"|"NO"|"INSUFFICIENT", "evidence": str, "citations": [{"source": str, "value": str}]} — never plain strings. ' +
  "ANTI-HALLUCINATION: use ONLY facts and figures present in the transcript below.";

const prompt = `Analyst research transcript:
GLAND Pharma (GLAND.NS). SMA20 slope 0.26, SMA 20/50/200 aligned bullish, golden cross in effect. RSI 48.91, MACD histogram -12.78. OBV 35621059 rising, A/D 10459686.96 rising, VWAP 2283.20. ATR 85.21, stop 2703.99, support 2525.59, resistance 2919.91.

Skill: Technical Analysis
Anchors:
- Price is in a confirmed trend or regime with aligned moving averages
- Momentum is constructive on the primary timeframe
- Recent moves are confirmed by volume
- The level map is actionable
- Scenario framing is honest

Return findings (2-6) and verdicts (one per anchor).`;

async function attempt(label, opts) {
  try {
    const res = await generateObject({ model, schema: Schema, system, prompt, temperature: 0, maxOutputTokens: 2000, ...opts });
    console.log(label, "-> OK. verdicts:", res.object.verdicts?.length, "findings:", res.object.findings?.length);
    console.log("   first verdict:", JSON.stringify(res.object.verdicts?.[0]).slice(0, 220));
    console.log("   usage:", JSON.stringify(res.usage));
  } catch (e) {
    console.log(label, "-> FAIL:", e?.statusCode, e?.name, "|", String(e?.message).slice(0, 300));
    const body = e?.responseBody || e?.data || e?.value;
    if (body) console.log("   body:", JSON.stringify(body).slice(0, 500));
  }
}

await attempt("A. default (auto) mode", {});
await attempt("B. mode=json", { mode: "json" });
await attempt("C. mode=tool", { mode: "tool" });
