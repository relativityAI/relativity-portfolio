/**
 * Three provider-adapter bugs live behind this one fetch wrapper:
 *
 * 1. RESPONSE side — @ai-sdk/openai-compatible walks every element of a
 *    streamed `delta.content` array with `part.type` and no null guard
 *    (dist/index.js, convertOpenAICompatibleContent). Groq's gpt-oss
 *    models sometimes stream reasoning/content deltas whose content
 *    array carries null elements, so the provider transform throws
 *    "Cannot read properties of undefined (reading 'type')" before our
 *    code ever sees a part — every skill fails with "the provider
 *    returned no tool use".
 *
 * 2. REQUEST side — the SDK re-attaches the model's accumulated
 *    reasoning as `reasoning_content` on every assistant message it
 *    sends back (dist/index.js, messages.push for role assistant).
 *    Groq ACCEPTS reasoning on the response side but REJECTS
 *    `reasoning_content` in request assistant messages with a 400
 *    ("property 'reasoning_content' is unsupported"), so every
 *    multi-turn tool loop dies on its second request — the first forced
 *    tool call succeeds, the follow-up that carries the reasoning echo
 *    fails. That 400 is what killed the Technical Analysis skill.
 *
 * 3. HELD-OPEN STREAM — Groq sometimes delivers every delta of a
 *    generation (reasoning, content, complete tool calls) and then
 *    holds the connection open without the terminal finish_reason /
 *    [DONE] chunks. The SDK ends a step only when the body closes,
 *    so the tool loop hangs until the whole-turn deadline aborts it
 *    (180s of dead air, then a non-retryable timeout). The wrapper
 *    detects the silence after output has started and finishes the
 *    stream on the wire itself — synthesizing the missing terminal
 *    chunk — so the SDK completes the step normally, executes the
 *    tool, and the loop continues.
 *
 * ponytail: we re-parse and re-emit each SSE data line to drop null
 * array holes, re-serialize POST bodies to /chat/completions to drop
 * the reasoning echo, and force-close stalled chat streams. Ceiling is
 * per-line/per-request JSON cost on openai-compatible traffic only.
 * `reasoning_content` is optional for every OpenAI-compatible server,
 * so stripping it is safe everywhere (the assistant's text content is
 * preserved); for Groq it is the difference between a working tool
 * loop and a hard 400. The idle terminator only fires after real
 * output has been delivered and only for chat-completions streams —
 * a stream that has not produced anything yet is left to the turn
 * deadline, so slow time-to-first-token is never mistaken for a hang.
 * Delete this file once @ai-sdk/openai-compatible guards the array,
 * omits the echo, and tolerates missing terminal chunks itself.
 */

/** Drop null/undefined holes from every array in a parsed JSON payload. */
export function stripNullishArrayHoles(v: unknown): void {
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) if (v[i] == null) v.splice(i, 1);
    for (const el of v) stripNullishArrayHoles(el);
  } else if (v && typeof v === "object") {
    for (const el of Object.values(v as Record<string, unknown>)) stripNullishArrayHoles(el);
  }
}

/**
 * Idle silence (ms) after which a chat-completions event-stream
 * that has already delivered output is force-closed. Overridable
 * via SSE_IDLE_TIMEOUT_MS. Generators emit tokens in bursts well
 * under a second; 30s of dead air after output means the provider
 * stalled, not that the model is thinking.
 */
function idleTimeoutMs(): number {
  const n = Number(process.env.SSE_IDLE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Emit one complete SSE line, sanitizing it if it is a JSON `data:` line. */
function emitLine(line: string, ctl: TransformStreamDefaultController<string>): void {
  const m = /^data:\s*(\{[\s\S]*\})\s*$/.exec(line);
  if (!m) {
    ctl.enqueue(line + "\n");
    return;
  }
  try {
    const json = JSON.parse(m[1]);
    stripNullishArrayHoles(json);
    ctl.enqueue(`data: ${JSON.stringify(json)}\n`);
  } catch {
    ctl.enqueue(line + "\n");
  }
}

/**
 * Drop the SDK's reasoning echo (`reasoning_content` / `reasoning`) from
 * assistant messages in an outgoing chat-completions body. Returns the
 * init unchanged when there is nothing to rewrite (no body, not JSON,
 * no assistant messages carrying reasoning) — the common path stays free.
 */
export function sanitizeRequestBody(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  if (!init || init.body == null) return init;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/chat/completions")) return init;

  let text: string | undefined;
  if (typeof init.body === "string") text = init.body;
  else if (init.body instanceof Uint8Array) text = new TextDecoder().decode(init.body);
  if (!text) return init;

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return init;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) return init;

  let changed = false;
  for (const msg of parsed.messages) {
    if (!msg || typeof msg !== "object" || msg.role !== "assistant") continue;
    if ("reasoning_content" in msg || "reasoning" in msg) {
      delete msg.reasoning_content;
      delete msg.reasoning;
      changed = true;
    }
  }
  return changed ? { ...init, body: JSON.stringify(parsed) } : init;
}

/** fetch wrapper that cleans outgoing request bodies and SSE responses. */
export function sanitizeSSEFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    init = sanitizeRequestBody(input, init);
    const res = await base(input, init);
    if (!res.body || !res.headers.get("content-type")?.includes("event-stream")) return res;

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Only chat-completions streams can stall post-output (and only they
    // understand a synthesized terminal chunk), so the idle terminator is
    // gated on the endpoint; every event-stream still gets line-buffered
    // sanitization below.
    const chatCompletions = url.includes("/chat/completions");
    const idleMs = chatCompletions ? idleTimeoutMs() : 0;

    // A `data:` line can straddle network chunk boundaries, so lines must be
    // buffered across chunks: splitting each chunk in isolation emits a partial
    // line (plus a stray newline), the SDK parser then fails the JSON, and the
    // turn dies with "the provider returned no tool use".
    let buffer = "";
    // Stream state for the idle terminator (chat-completions only).
    let sawDelta = false;
    let sawFinish = false;
    let sawToolCalls = false;
    let terminated = false;
    let ctl: TransformStreamDefaultController<string> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const disarmIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    };

    const processLine = (line: string, controller: TransformStreamDefaultController<string>) => {
      const m = /^data:\s*(\{[\s\S]*\})\s*$/.exec(line);
      if (!m) {
        controller.enqueue(line + "\n");
        return;
      }
      try {
        const json = JSON.parse(m[1]);
        if (chatCompletions) {
          const choice = (json as any)?.choices?.[0];
          if (choice?.finish_reason != null) sawFinish = true;
          const d = choice?.delta;
          if (d) {
            if (
              d.content != null ||
              d.reasoning != null ||
              d.reasoning_content != null ||
              d.tool_calls != null ||
              d.role != null
            ) {
              sawDelta = true;
            }
            if (d.tool_calls != null) sawToolCalls = true;
          }
        }
        stripNullishArrayHoles(json);
        controller.enqueue(`data: ${JSON.stringify(json)}\n`);
      } catch {
        controller.enqueue(line + "\n");
      }
    };

    const armIdle = () => {
      if (!chatCompletions || terminated) return;
      disarmIdle();
      idleTimer = setTimeout(() => {
        // Silence before any output is a slow provider, not a stall —
        // the turn deadline owns that failure. Only dead air AFTER
        // output is force-closed. (A later chunk re-arms via armIdle.)
        if (terminated || !sawDelta) return;
        terminated = true;
        disarmIdle();
        try {
          // The provider delivered a whole generation but never sent the
          // terminal chunk(s). Finish the stream on the wire so the SDK's
          // step machinery ends the step, executes the pending tool call,
          // and continues the loop instead of hanging to the turn deadline.
          if (!sawFinish) {
            const finishReason = sawToolCalls ? "tool_calls" : "stop";
            ctl?.enqueue(
              `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: finishReason, delta: {} }] })}\n\n`,
            );
          }
          ctl?.enqueue("data: [DONE]\n\n");
          ctl?.terminate();
        } catch {
          // Stream already closed or errored (e.g. turn aborted) — nothing to do.
        }
      }, idleMs);
    };

    const cleaned = res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, string>({
          transform(chunk, controller) {
            ctl = controller;
            buffer += chunk;
            let idx = buffer.indexOf("\n");
            while (idx !== -1) {
              processLine(buffer.slice(0, idx), controller);
              buffer = buffer.slice(idx + 1);
              idx = buffer.indexOf("\n");
            }
            armIdle();
          },
          flush(controller) {
            ctl = controller;
            disarmIdle();
            if (buffer) processLine(buffer, controller);
            buffer = "";
          },
          cancel() {
            disarmIdle();
          },
        } as Transformer<string, string>),
      )
      .pipeThrough(new TextEncoderStream());

    return new Response(cleaned, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}
