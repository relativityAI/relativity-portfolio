// End-to-end check of the NEW verdict-recovery pass: generateText +
// tolerant parsing of both shapes the model emits ({verdicts:[...]} or
// a bare top-level array).
import "dotenv/config";
import { generateText } from "ai";
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

const evidence = `CALL get_technicals {"symbol":"GLAND","exchange":"NSE"}\nRESULT get_technicals (ok): {"symbol":"GLAND","sections":{"executive_summary":{"data":{"price":2874.3999,"regime":"trending up"}},"trend_analysis":{"data":{"trend_regime":{"regime":"trending up","adx":21.52,"sma20_slope_pct":0.26},"sma_alignment":{"sma_20":2925.83,"sma_50":2810.0477,"sma_200":2148.1503}},"momentum":{"data":{"rsi_14":48.9142,"macd_histogram":-12.7802}},"volume":{"data":{"obv":35621059,"accumulation_distribution":10459686.963,"vwap":2283.1979}},"volatility":{"data":{"atr_14":85.2066}},"support_resistance":{"data":{"supports":[{"price":1612.8815,"touches":3},{"price":2525.5862,"touches":2}],"resistances":[{"price":2919.9146,"touches":2}]}}}}}`;

const structuredSystem =
  "Convert the analyst's research into the exact JSON shape requested. " +
  'verdicts MUST be an array of OBJECTS like {"anchor": str, "verdict": "YES"|"PARTIAL"|"NO"|"INSUFFICIENT", "evidence": str, "citations": [{"source": str, "url": str?, "value": str}]} — never plain strings. ' +
  "ANTI-HALLUCINATION: use ONLY facts and figures present in the transcript or tool observations below. Copy numbers verbatim; never compute, estimate, or complete them from general knowledge. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.";

const prose = "The analyst gathered technicals for GLAND via get_technicals. Regime trending up, SMA20 slope 0.26, SMAs aligned, RSI 48.9142, MACD histogram -12.7802, OBV 35621059 rising, A/D 10459686.963 rising, VWAP 2283.1979, ATR 85.2066, stop 2703.9867, support 2525.5862, resistance 2919.9146.";

const prompt =
  `Assign one verdict for EVERY anchor below using ONLY the analyst transcript and the raw tool observations. ` +
  "Copy figures verbatim from the observations — never compute, estimate, or complete them. If the evidence does not settle an anchor, verdict INSUFFICIENT — never guess.\n\n" +
  `Return ONLY a JSON array of verdict objects, one per anchor, exactly like: [{"anchor": str, "verdict": "YES"|"PARTIAL"|"NO"|"INSUFFICIENT", "evidence": str, "citations": [{"source": str, "url": str?, "value": str}]}] — no prose around it.\n\n` +
  `Skill: Technical Analysis\nAnchors:\n${ANCHORS.map((a) => `- ${a}`).join("\n")}\n\n` +
  `Analyst transcript:\n${prose}\n\nRAW TOOL OBSERVATIONS (verbatim, from the tools actually called this session):\n${evidence.slice(0, 24000)}`;

const res = await generateText({ model, system: structuredSystem, prompt, temperature: 0, maxOutputTokens: 2000 });
const raw = res.text || "";
console.log("RAW (first 400):", raw.slice(0, 400));

// ── the exact parser from skillrun.ts (copied verbatim) ──
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(c.slice(start, i + 1)); } catch { break; } } }
    }
  }
  return null;
}
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("[");
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) { try { const v = JSON.parse(c.slice(start, i + 1)); if (Array.isArray(v)) return v; } catch { break; } } }
    }
  }
  return null;
}
function normVerdict(v) {
  const s = String(v || "").toUpperCase();
  return s === "YES" || s === "PARTIAL" || s === "NO" ? s : "INSUFFICIENT";
}
function normCitations(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const source = String(c.source ?? c.tool ?? "").slice(0, 120);
    const value = String(c.value ?? c.quote ?? c.figure ?? "").slice(0, 300);
    const url = typeof c.url === "string" && /^https?:\/\//i.test(c.url) ? c.url.slice(0, 500) : undefined;
    const label = typeof c.label === "string" ? c.label.slice(0, 200) : undefined;
    if (!source && !url) continue;
    out.push({ source, url, value, label });
    if (out.length >= 12) break;
  }
  return out;
}

const wrapped = extractJsonObject(raw);
const rawList = Array.isArray(wrapped?.verdicts) ? wrapped.verdicts : (extractJsonArray(raw) ?? []);
const verdicts = rawList
  .filter((v) => !!v && typeof v === "object")
  .map((v) => ({ anchor: String(v.anchor ?? ""), verdict: normVerdict(v.verdict), evidence: String(v.evidence ?? ""), citations: normCitations(v.citations) }))
  .filter((v) => v.anchor && v.evidence)
  .slice(0, 24);

console.log("\nPARSED verdicts:", verdicts.length);
for (const v of verdicts) console.log(`- [${v.verdict}] ${v.anchor.slice(0, 60)}… | ev: ${v.evidence.slice(0, 80)} | cites: ${v.citations.length}`);

const ok = verdicts.length >= 1 && verdicts.every((v) => ["YES", "PARTIAL", "NO", "INSUFFICIENT"].includes(v.verdict));
console.log(ok ? "\nPASS: recovery produced normalized verdicts" : "\nFAIL: no usable verdicts");
process.exit(ok ? 0 : 1);
