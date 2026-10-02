/**
 * Live repro: the Technical Analysis skill's analyst turn against
 * groq/openai/gpt-oss-20b, with a fetch wrapper installed OUTSIDE
 * sanitizeSSEFetch so we see the RAW wire traffic (request bodies +
 * raw SSE bytes) before any sanitization.
 *
 * Run from api/: npx tsx scripts/repro-tech.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Local Voyager (user runs one on :8001).
process.env.VOYAGER_URL = "http://localhost:8001";

const DUMP = "/tmp/groq-dump";
mkdirSync(DUMP, { recursive: true });

// ── Wire logger — installed before the SDK is imported so
// sanitizeSSEFetch() (whose default `base` is captured at module
// load) wraps THIS logger, not the pristine global fetch. ──────
const realFetch = globalThis.fetch.bind(globalThis);
let reqN = 0;
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const n = ++reqN;
  const isChat = url.includes("/chat/completions");

  if (isChat && init?.body) {
    const text =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : "";
    let summary = "";
    try {
      const p = JSON.parse(text);
      const msgs = p.messages || [];
      const echo = msgs.filter(
        (m: any) => m.role === "assistant" && (m.reasoning_content || m.reasoning),
      ).length;
      summary = `model=${p.model} msgs=${msgs.length} tools=${(p.tools || []).length} tool_choice=${JSON.stringify(p.tool_choice)} reasoningEcho=${echo}`;
    } catch { /* non-JSON body */ }
    console.log(`[wire] #${n} REQ POST /chat/completions ${summary}`);
    writeFileSync(join(DUMP, `req-${n}.json`), text);
  }

  const res = await realFetch(input, init);
  const ct = res.headers.get("content-type") || "";
  if (isChat && res.body && ct.includes("event-stream")) {
    const [a, b] = res.body.tee();
    const chunks: string[] = [];
    void (async () => {
      const reader = b.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(dec.decode(value, { stream: true }));
      }
      const full = chunks.join("");
      writeFileSync(join(DUMP, `res-${n}.sse`), full);
      const nulls = (full.match(/null/g) || []).length;
      const contentArrays = (full.match(/"content":\[/g) || []).length;
      const reasoningDeltas = (full.match(/"reasoning_content":/g) || []).length;
      const toolCallDeltas = (full.match(/"tool_calls":\[/g) || []).length;
      const finishReasons = [...full.matchAll(/"finish_reason":"?([a-z_]+)"?/g)].map((m) => m[1]);
      console.log(
        `[wire] #${n} RES stream bytes=${full.length} nulls=${nulls} contentArrays=${contentArrays} reasoningDeltas=${reasoningDeltas} toolCallDeltas=${toolCallDeltas} finish=${finishReasons.join(",")}`,
      );
    })().catch(() => {});
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  if (isChat && ct.includes("application/json")) {
    const clone = res.clone();
    void clone
      .text()
      .then((t) => {
        writeFileSync(join(DUMP, `res-${n}.json`), t);
        console.log(`[wire] #${n} RES json status=${res.status} bytes=${t.length}`);
      })
      .catch(() => {});
    return res;
  }
  console.log(`[wire] #${n} RES ${res.status} ${url.replace(/^https?:\/\//, "").slice(0, 70)} ct=${ct.slice(0, 40)}`);
  return res;
};

// ── Imports AFTER the fetch override ──────────────────────────
const { buildModel } = await import("../src/agent.js");
const { runAgentTurn } = await import("../src/harness.js");
const { buildTools } = await import("../src/tools.js");
const { VoyagerClient } = await import("../src/voyager.js");
const { getBuiltinSkill } = await import("../src/skills/store.js");
const { buildSkillTools } = await import("../src/skills/skillrun.js");
const { skillToPromptSection } = await import("../src/skills/types.js");
const { streamText } = await import("ai");

const MODEL_ID = "groq/openai/gpt-oss-20b";
const groqKey = (process.env.GROQ_API_KEYS || "").split(",")[0]?.trim();
if (!groqKey) throw new Error("GROQ_API_KEYS not set in api/.env");
const keys = { groq: groqKey };

const voyager = new VoyagerClient(process.env.VOYAGER_URL!, "", 60);
const toolCtx = {
  voyager,
  symbol: "GLAND",
  country: "India",
  source: "NSE",
  shareName: "Gland Pharma Limited",
};

const skill = getBuiltinSkill("technical-analysis");
if (!skill) throw new Error("technical-analysis skill not found under config/skills");

const tools = buildSkillTools(
  {
    toolCtx,
    modelId: MODEL_ID,
    llmKeys: keys,
    persona: "",
    documents: [],
    webSearch: true,
    toolCatalog: [],
  },
  skill,
);
console.log(`skill tools (${Object.keys(tools).length}): ${Object.keys(tools).join(", ")}`);

const prompt = [
  `The subject of this analysis is the company Gland Pharma Limited (GLAND) on NSE (India). Everything below refers to THIS company and no other.`,
  `${skillToPromptSection(skill)}`,
  `\n## Your task\nWork through this skill's Method now. Call the listed tools FIRST, gather evidence, then return JSON with findings, verdicts and tools_used.`,
  `Web search is enabled.`,
].join("\n");

const model = buildModel(MODEL_ID, keys, groqKey);

// ── Pass 1: RAW streamText replica (no harness) to capture the
// exact throw site of any TypeError with a full stack. ──────────
console.log("\n═══ PASS 1: raw streamText (toolChoice required, step 0) ═══");
try {
  const result = await streamText({
    model,
    system: "You are a focused equity-research analyst. Call the provided tools to gather evidence before answering.",
    prompt,
    temperature: 0.3,
    maxOutputTokens: 8192,
    tools,
    toolChoice: "required",
    stopWhen: ({ stepNumber }: any) => stepNumber >= 1,
  });
  let text = "";
  const calls: string[] = [];
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
    if (part.type === "tool-call") calls.push(part.toolName);
  }
  console.log(`PASS 1 OK: text=${text.length} chars, toolCalls=${calls.join(",") || "none"}`);
} catch (e: any) {
  console.log(`PASS 1 THREW: ${e?.name}: ${e?.message}`);
  console.log(e?.stack?.split("\n").slice(0, 12).join("\n"));
}

// ── Pass 2: the exact harness call runSingleSkill makes. ──────
console.log("\n═══ PASS 2: runAgentTurn (forceTools, prepareStep) ═══");
const turn = await runAgentTurn({
  model,
  system: "You are a focused equity-research analyst executing ONE skill of a larger investor-agent analysis. Call tools before concluding. Never answer from memory.",
  prompt,
  temperature: 0.3,
  maxOutputTokens: 8192,
  tools,
  forceTools: true,
  maxToolSteps: 10,
  deadlineMs: 180_000,
  onEvent: (ev) => {
    if (ev.type === "thought") console.log(`[event] thought: ${(ev.text || "").slice(0, 140)}`);
    else if (ev.type === "tool_call") console.log(`[event] tool_call: ${ev.tool}`);
    else if (ev.type === "tool_result") console.log(`[event] tool_result: ${ev.tool} ${ev.status}`);
  },
});
console.log(
  "PASS 2 RESULT:",
  JSON.stringify(
    {
      textChars: (turn.text || "").length,
      textHead: (turn.text || "").slice(0, 300),
      toolCalls: (turn.toolCalls || []).map((c: any) => c.tool_name),
      steps: turn.steps?.length,
      finishReason: turn.finishReason,
      error: turn.error,
      retryable: turn.retryable,
      usage: turn.usage,
    },
    null,
    2,
  ),
);
