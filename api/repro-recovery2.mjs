// Bisect WHY the verdicts-only recovery fails while the full-schema
// extraction succeeds: min(1), output budget, mode.
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

const evidence = `CALL get_technicals {"symbol":"GLAND","exchange":"NSE"}\nRESULT get_technicals (ok): {"symbol":"GLAND","sections":{"executive_summary":{"data":{"price":2874.3999,"regime":"trending up"}},"trend_analysis":{"data":{"trend_regime":{"regime":"trending up","adx":21.52,"sma20_slope_pct":0.26},"sma_alignment":{"sma_20":2925.83,"sma_50":2810.0477,"sma_200":2148.1503}}},"momentum":{"data":{"rsi_14":48.9142,"macd_histogram":-12.7802}},"volume":{"data":{"obv":35621059,"accumulation_distribution":10459686.963,"vwap":2283.1979}},"volatility":{"data":{"atr_14":85.2066}},"support_resistance":{"data":{"supports":[{"price":1612.8815,"touches":3},{"price":2525.5862,"touches":2}],"resistances":[{"price":2919.9146,"touches":2}]}}}}`;

const structuredSystem =
  "Convert the analyst's research into the exact JSON shape requested. " +
  'verdicts MUST be an array of OBJECTS like {"anchor": str, "verdict": "YES"|"PARTIAL"|"NO"|"INSUFFICIENT", "evidence": str, "citations": [{"source": str, "url": str?, "value": str}]} — never plain strings. ' +
  "ANTI-HALLUCINATION: use ONLY facts and figures present in the transcript or tool observations below. Copy numbers verbatim; never compute, estimate, or complete them from general knowledge. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.";

const prose = "The analyst gathered technicals for GLAND via get_technicals. Regime trending up, SMA20 slope 0.26, SMAs aligned, RSI 48.9142, MACD histogram -12.7802, OBV 35621059 rising, A/D 10459686.963 rising, VWAP 2283.1979, ATR 85.2066, stop 2703.9867, support 2525.5862, resistance 2919.9146.";

const VObj = z.object({
  anchor: z.string().max(300),
  verdict: z.enum(["YES", "PARTIAL", "NO", "INSUFFICIENT"]),
  evidence: z.string().max(500),
  citations: z.array(z.object({ source: z.string(), value: z.string() })).max(6).default([]),
});

const mkPrompt = (extra) =>
  `Assign one verdict for EVERY anchor below using ONLY the analyst transcript and the raw tool observations. ` +
  "Copy figures verbatim from the observations — never compute, estimate, or complete them. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.\n\n" +
  `Skill: Technical Analysis\nAnchors:\n${ANCHORS.map((a) => `- ${a}`).join("\n")}\n\n` +
  `Analyst transcript:\n${prose}\n\nRAW TOOL OBSERVATIONS (verbatim, from the tools actually called this session):\n${evidence.slice(0, 24000)}` + (extra || "");

async function attempt(label, schema, opts) {
  try {
    const res = await generateObject({ model, schema, system: structuredSystem, prompt: mkPrompt(opts?.promptSuffix), temperature: 0, maxOutputTokens: opts?.maxOutputTokens ?? 2000, ...(opts?.mode ? { mode: opts.mode } : {}) });
    const v = res.object.verdicts || [];
    console.log(label, "-> OK verdicts:", v.length, v[0] ? `${v[0].verdict} ${String(v[0].anchor).slice(0, 40)}` : "");
  } catch (e) {
    console.log(label, "-> FAIL:", e?.name, "|", String(e?.message).slice(0, 160));
  }
}

await attempt("R3 verdicts-only, NO min(1), 2000tok", z.object({ verdicts: z.array(VObj).default([]) }), {});
await attempt("R4 verdicts-only, NO min(1), 4096tok", z.object({ verdicts: z.array(VObj).default([]) }), { maxOutputTokens: 4096 });
await attempt("R5 verdicts-only min(1), 4096tok", z.object({ verdicts: z.array(VObj).min(1) }), { maxOutputTokens: 4096 });
await attempt("R6 verdicts-only min(1), 4096tok, mode=tool", z.object({ verdicts: z.array(VObj).min(1) }), { maxOutputTokens: 4096, mode: "tool" });
