/**
 * Wire dumper — a side-effect module. Import it BEFORE any repo module
 * (especially ./src/agent.js): agent.ts captures `globalThis.fetch` at
 * module-load time for sanitizeSSEFetch(), so the dumper must already
 * be installed when that import evaluates. ESM hoists static imports,
 * which is why an inline dumper in the importing script's module body
 * never saw a single request.
 *
 * Logs to api/wire-dump.log:
 *   >>> REQ  <iso> msgs=N assistant=N reasoningEcho=N   (outgoing chat-completions POST)
 *   <<< RES  status=… ct=… te=…                          (response head)
 *   <<< data: {…}                                       (every SSE data line)
 *   <<< ⓗⓗⓗ NULL-HOLE data: {…}                         (line whose JSON carries a null array element)
 *   <<< [stream closed]                                  (underlying body ended)
 *
 * Scratch verification tooling — delete with verify-e2e.mts.
 */
import { appendFileSync, writeFileSync } from "node:fs";

export const WIRE_LOG = new URL("./wire-dump.log", import.meta.url).pathname;
writeFileSync(WIRE_LOG, "");

const realFetch = globalThis.fetch;
const pending = new Set<Promise<void>>();

/** Resolve when every dumped response body has finished reading. */
export function wireDumpDrain(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (pending.size === 0 || Date.now() > deadline) return resolve();
      setTimeout(tick, 50);
    };
    tick();
  });
}

globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
  const isChat = url.includes("api.groq.com") && url.includes("/chat/completions");

  if (isChat && init?.body != null) {
    const body = typeof init.body === "string" ? init.body : init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
    let note = "";
    try {
      const parsed = JSON.parse(body);
      const msgs = parsed.messages || [];
      const assistant = msgs.filter((m: any) => m.role === "assistant");
      const echo = assistant.filter((m: any) => "reasoning_content" in m || "reasoning" in m).length;
      note = `msgs=${msgs.length} assistant=${assistant.length} reasoningEcho=${echo}`;
    } catch {}
    appendFileSync(WIRE_LOG, `>>> REQ ${new Date().toISOString()} ${note}\n`);
    appendFileSync(WIRE_LOG, `    ${body.slice(0, 4000)}\n`);
  }

  const res = await realFetch(input, init);
  if (!isChat || !res.body) return res;

  appendFileSync(WIRE_LOG, `<<< RES status=${res.status} ct=${res.headers.get("content-type")} te=${res.headers.get("transfer-encoding")} cl=${res.headers.get("content-length")}\n`);

  const [a, b] = res.body.tee();
  const read = (async () => {
    const reader = b.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { appendFileSync(WIRE_LOG, "<<< [stream closed]\n"); break; }
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          // Flag any JSON array element that is null (the SDK crash bug).
          const hole = /\[[^\]]*\bnull\b[^\]]*\]|,null\s*,|,null\s*\]/.test(line);
          appendFileSync(WIRE_LOG, `<<< ${hole ? "ⓗⓗⓗ NULL-HOLE " : ""}${line.slice(0, 2000)}\n`);
        }
      }
    } catch {}
  })();
  pending.add(read);
  read.finally(() => pending.delete(read));

  return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as typeof fetch;
