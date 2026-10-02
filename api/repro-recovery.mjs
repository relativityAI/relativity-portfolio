// Reproduce skillrun's verdict-recovery pass against the REAL run shape:
// analyst final text = JSON with anchor-titled findings and NO verdicts
// (that's exactly what the stored skill_output shows), plus the real
// get_technicals evidence digest.
import "dotenv/config";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const key = process.env.COHERE_API_KEYS?.split(",")[0];
const cohere = createOpenAICompatible({ name: "cohere", baseURL: "https://api.cohere.ai/compatibility/v1", apiKey: key });
const model = cohere("command-r7b-12-2024");

const ANCHORS = [
  "Price is in a confirmed trend or regime with aligned moving averages (SMA 20/50/200 alignment and golden/death-cross state agree with the market-structure classification)",
  "Momentum is constructive on the primary timeframe (RSI in a healthy band, MACD histogram direction consistent, and the multi-timeframe signal matrix does not contradict the daily call)",
  "Recent moves are confirmed by volume (OBV/A-D trend agrees with price; breakouts carry above-average volume; VWAP and volume profile support the current price zone)",
  "The level map is actionable (defined support/resistance with touch counts, a stop grounded in ATR or structure, and R:R to TP1 at or better than 1:1)",
  "Scenario framing is honest (bull/bear/neutral triggers stated, invalidation level defined, no single-sided story)",
];

// What the analyst's final message looked like: JSON, findings per anchor,
// verdicts omitted (the stored output proves this shape won).
const analystText = JSON.stringify({
  findings: ANCHORS.map((a, i) => ({ title: a, detail: `Finding ${i + 1} detail with real figures: SMA20 slope 0.26, RSI 48.9142, OBV 35621059, ATR 85.2066, support 2525.5862, resistance 2919.9146.` })),
  verdicts: [],
  tools_used: ["get_technicals"],
});

const evidence = `CALL get_technicals {"symbol":"GLAND","exchange":"NSE"}\nRESULT get_technicals (ok): {"symbol":"GLAND","source":"nse","sections_count":60,"sections":{"executive_summary":{"status":"ok","data":{"symbol":"GLAND","price":2874.3999,"confluence":"mixed","regime":"trending up","structure_class":"range / transition (mixed pivots)"}},"trend_analysis":{"status":"ok","data":{"market_structure":"range / transition (mixed pivots)","trend_regime":{"regime":"trending up","adx":21.52,"sma20_slope_pct":0.26},"sma_alignment":{"sma_20":2925.83,"sma_50":2810.0477,"sma_200":2148.1503}}},"momentum":{"status":"ok","data":{"rsi_14":48.9142,"macd_histogram":-12.7802}},"volume":{"status":"ok","data":{"obv":35621059,"accumulation_distribution":10459686.963,"vwap":2283.1979}},"volatility":{"status":"ok","data":{"atr_14":85.2066}},"support_resistance":{"status":"ok","data":{"supports":[{"price":1612.8815,"touches":3},{"price":2525.5862,"touches":2}],"resistances":[{"price":2919.9146,"touches":2}]}}}}`;

const structuredSystem =
  "Convert the analyst's research into the exact JSON shape requested. " +
  'findings MUST be an array of OBJECTS like {"title": str, "detail": str} — never plain strings. ' +
  'verdicts MUST be an array of OBJECTS like {"anchor": str, "verdict": "YES"|"PARTIAL"|"NO"|"INSUFFICIENT", "evidence": str, "citations": [{"source": str, "url": str?, "value": str}]} — never plain strings. Every evidence line MUST include its citations. ' +
  "ANTI-HALLUCINATION: use ONLY facts and figures present in the transcript or tool observations below. Copy numbers verbatim; never compute, estimate, or complete them from general knowledge. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.";

const VerdictsOnlySchema = z.object({
  verdicts: z.array(z.object({
    anchor: z.string().max(300),
    verdict: z.enum(["YES", "PARTIAL", "NO", "INSUFFICIENT"]),
    evidence: z.string().max(500),
    citations: z.array(z.object({ source: z.string(), value: z.string() })).max(6).default([]),
  })).min(1),
});

const recoveryPrompt =
  `Assign one verdict for EVERY anchor below using ONLY the analyst transcript and the raw tool observations. ` +
  "Copy figures verbatim from the observations — never compute, estimate, or complete them. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.\n\n" +
  `Skill: Technical Analysis\nAnchors:\n${ANCHORS.map((a) => `- ${a}`).join("\n")}\n\n` +
  `Analyst transcript:\n${analystText.slice(0, 30000)}\n\nRAW TOOL OBSERVATIONS (verbatim, from the tools actually called this session):\n${evidence.slice(0, 24000)}`;

console.log("── R1: recovery as currently written (min(1) schema) ──");
try {
  const res = await generateObject({ model, schema: VerdictsOnlySchema, system: structuredSystem, prompt: recoveryPrompt, temperature: 0, maxOutputTokens: 2000 });
  console.log("OK verdicts:", res.object.verdicts.length, JSON.stringify(res.object.verdicts[0]).slice(0, 200));
} catch (e) {
  console.log("FAIL:", e?.name, "|", String(e?.message).slice(0, 400));
}

console.log("\n── R2: recovery, transcript WITHOUT the echoed JSON blob ──");
const proseTranscript = "The analyst gathered technicals for GLAND via get_technicals. Regime trending up, SMA20 slope 0.26, SMAs aligned, RSI 48.9142, MACD histogram -12.7802, OBV 35621059 rising, A/D 10459686.963 rising, VWAP 2283.1979, ATR 85.2066, stop 2703.9867, support 2525.5862, resistance 2919.9146, bull trigger sustained closes above range high, bear trigger close below support 2041.1623, invalidation 1612.8815.";
const prompt2 = recoveryPrompt.replace(analystText, proseTranscript);
try {
  const res = await generateObject({ model, schema: VerdictsOnlySchema, system: structuredSystem, prompt: prompt2, temperature: 0, maxOutputTokens: 2000 });
  console.log("OK verdicts:", res.object.verdicts.length);
  for (const v of res.object.verdicts) console.log("  ", v.verdict, "|", v.anchor.slice(0, 50), "|", v.evidence.slice(0, 70));
} catch (e) {
  console.log("FAIL:", e?.name, "|", String(e?.message).slice(0, 400));
}
