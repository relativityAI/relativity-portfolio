/**
 * dbg-cohere-skill — reproduce the cohere/command-r7b-12-2024
 * Technical Analysis skill run through runSingleSkill (the real
 * path), with a raw-wire logger so we can see BOTH the analyst
 * text and the structured-extraction request/response.
 *
 * Run from api/: npx tsx dbg-cohere-skill.ts [modelId]
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.VOYAGER_URL = process.env.VOYAGER_URL || "http://localhost:8001";

const DUMP = "/tmp/cohere-dump";
mkdirSync(DUMP, { recursive: true });

const realFetch = globalThis.fetch.bind(globalThis);
let reqN = 0;
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const n = ++reqN;
  const isChat = url.includes("/chat/completions");
  if (isChat && init?.body) {
    const text = typeof init.body === "string" ? init.body : init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
    writeFileSync(join(DUMP, `req-${n}.json`), text);
    try {
      const p = JSON.parse(text);
      console.log(`[wire] #${n} REQ model=${p.model} msgs=${(p.messages || []).length} response_format=${JSON.stringify(p.response_format || null).slice(0, 120)}`);
    } catch { /* non-json */ }
  }
  const res = await realFetch(input, init);
  const ct = res.headers.get("content-type") || "";
  if (isChat && ct.includes("application/json")) {
    const clone = res.clone();
    void clone.text().then((t) => {
      writeFileSync(join(DUMP, `res-${n}.json`), t);
      console.log(`[wire] #${n} RES json status=${res.status} bytes=${t.length}`);
      try {
        const p = JSON.parse(t);
        const choices = p.choices || [];
        for (const c of choices) {
          const m = c.message || {};
          console.log(`        finish=${c.finish_reason} content=${(m.content || "").slice(0, 400).replace(/\n/g, " ")}`);
          if (m.tool_calls?.length) console.log(`        tool_calls=${m.tool_calls.map((x: any) => x.function?.name).join(",")}`);
        }
      } catch { /* non-json */ }
    }).catch(() => {});
    return res;
  }
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
      console.log(`[wire] #${n} RES sse bytes=${full.length}`);
    })().catch(() => {});
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  return res;
};

const { getDb } = await import("./src/db.js");
const { decrypt } = await import("./src/crypto.js");
const { fetchUserKeys } = await import("./src/provision.js");
const { buildModel } = await import("./src/agent.js");
const { VoyagerClient } = await import("./src/voyager.js");
const { getBuiltinSkill } = await import("./src/skills/store.js");
const { runSingleSkill } = await import("./src/skills/skillrun.js");

const MODEL_ID = process.argv[2] || "cohere/command-r7b-12-2024";
const USER_ID = "1c2085ee-9af7-4dc7-8139-1646cad35606";

const { voyagerKey, llmKeys } = await fetchUserKeys(USER_ID);
// Env fallback (as runs do when the row has no stored key).
for (const [prov, env] of [["cohere", "COHERE_API_KEYS"], ["groq", "GROQ_API_KEYS"], ["gemini", "GEMINI_API_KEYS"], ["openrouter", "OPENROUTER_API_KEYS"]] as const) {
  if (!llmKeys[prov]) {
    const v = (process.env[env] || "").split(",")[0]?.trim();
    if (v) llmKeys[prov] = v;
  }
}
console.log(`model=${MODEL_ID} voyagerKey=${voyagerKey.slice(0, 6)}…(${voyagerKey.length}) llmProviders=${Object.keys(llmKeys).filter((k) => llmKeys[k]).join(",")}`);

const voyager = new VoyagerClient(process.env.VOYAGER_URL!, voyagerKey, 60);
const toolCtx = {
  voyager,
  symbol: "GLAND",
  country: "India",
  source: "NSE",
  shareName: "Gland Pharma Limited",
  webSources: [],
};

const skill = getBuiltinSkill("technical-analysis");
if (!skill) throw new Error("technical-analysis skill not found");

const apiKey = llmKeys[MODEL_ID.split("/")[0]] || "";
const model = buildModel(MODEL_ID, llmKeys as any, apiKey);

console.log(`\n═══ runSingleSkill: ${skill.id} via ${MODEL_ID} ═══`);
const out = await runSingleSkill(
  {
    toolCtx,
    modelId: MODEL_ID,
    llmKeys: llmKeys as any,
    persona: "",
    documents: [],
    webSearch: true,
    toolCatalog: [],
    onTrace: (ev: any) => {
      if (ev.type === "tool_call") console.log(`[trace] tool_call ${ev.tool}`);
      else if (ev.type === "tool_result") console.log(`[trace] tool_result ${ev.tool} ${ev.status}`);
    },
  },
  skill,
  5,
);

console.log("\n═══ SKILL OUTPUT ═══");
console.log(JSON.stringify({
  skill_id: out.skill_id,
  error: out.error || null,
  verdicts: out.verdicts,
  tools_used: out.tools_used,
  chart_requests: out.chart_requests,
  citations: out.citations,
  findings_count: out.findings.length,
  observations: out.raw_observations.map((o: any) => ({ tool: o.tool, status: o.status, resultChars: String(o.result).length })),
}, null, 2));
console.log("\nfindings:");
for (const f of out.findings) console.log(`- ${f.title}\n  ${f.detail.slice(0, 200)}`);
console.log(`\ndumps in ${DUMP}`);
