/**
 * Transient-failure resilience — how the harness survives provider flakiness.
 *
 * Three concerns that used to live in the legacy shared turn harness
 * (api/src/harness.ts), now owned by this module so nothing under harness/
 * reaches outside it:
 *
 *   - RETRYABLE_ERROR   which provider errors are worth another attempt
 *   - retryLlmCall      bounded retry + per-attempt deadline for single-shot
 *                       LLM calls (the agent loop, structured extraction)
 *   - repairNullToolArgs deterministic tool-arg repair (models emit explicit
 *                       `null` for optional args; Zod rejects it)
 *
 * The contract: ONE failed LLM call never silently downgrades a pipeline
 * stage, and a permanent error (auth, bad request) fails fast.
 */

import { log } from "./log.js";

// Transient failures worth waiting on and retrying — model refused to produce
// output (no text, no tool call), provider hiccups, rate limits, aborted
// stream, stochastic parse glitches (Groq output_parse_failed), timeouts.
// The server's key-rotation loop uses this same pattern (runs.ts) — one
// definition for "worth another attempt" across the codebase.
// NB: Gemini reports exhausted quota as 400 RESOURCE_EXHAUSTED — matched here
// because it IS transient (the free-tier window resets), unlike a real 400.
export const RETRYABLE_ERROR =
  /NoOutputGenerated|ECONNRESET|ETIMEDOUT|aborted|429|too many requests|5\d\d|overloaded|resource.?exhausted|internal error|rate.?limit|quota|exceeded|unavailable|temporarily|timeout|timed out|output_parse_failed|could not be parsed|failed to parse|parsing failed/i;

// Generous enough for a long structured output on a slow provider, short
// enough that a hung stream fails and retries inside the run's own lifetime.
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deterministic tool-call repair. Models (notably Groq's gpt-oss) emit explicit
 * `null` for optional args — `{"sections": null}` — which Zod's `.optional()`
 * rejects ("expected string, but got null") and kills the whole run. Drop
 * null-valued top-level keys so an absent optional reads as absent. Returns
 * null when nothing changed, so callers can fall back to a model re-ask.
 */
export function repairNullToolArgs(toolCall: any): any | null {
  const raw = toolCall?.input;
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) changed = true;
    else out[k] = v;
  }
  return changed ? { ...toolCall, input: JSON.stringify(out) } : null;
}

/**
 * Resilience for one-off LLM calls (generateObject / generateText) that
 * sit OUTSIDE the agent-turn loop: structured extraction, planning,
 * report synthesis. The turn loop already retries transient stream
 * failures internally; these single-shot calls used to die on the
 * first provider hiccup and silently downgrade the run (empty plan,
 * lost extraction, missing executive summary). The harness contract is
 * that ONE failed LLM call never kills a pipeline stage: retry it.
 *
 * Retries on transient provider conditions (RETRYABLE_ERROR) and on
 * empty/invalid output when a checker is supplied. Permanent errors
 * (auth, schema misuse) propagate immediately so callers fail fast.
 */
export async function retryLlmCall<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    /** Called with the error text on each failure so the key pool can rotate. */
    onError?: (message: string, attempt: number) => void;
    /** Validate the result; an invalid result is retried like an error. */
    check?: (result: T) => boolean;
    /**
     * Per-attempt wall-clock budget. Without it a provider that accepts the
     * request and then never resolves hangs the whole pipeline until the
     * stale-run sweeper kills the run — which is how we lost reports whose
     * scores were already persisted. The signal is FRESH per attempt: a
     * deadline created once would already be expired on the retry.
     */
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      log.warn("resilience", `retrying ${label} (attempt ${attempt}/${attempts}) after:`, String((lastError as any)?.message || lastError));
      await sleep(delayMs);
    }
    // Both halves matter: the signal cancels the provider request (so we are
    // not leaking sockets/containers), and the race stops us WAITING on a
    // caller that ignores the signal.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([fn(controller.signal), deadline]);
      if (opts.check && !opts.check(result)) {
        throw new Error(`${label} returned an invalid/empty result`);
      }
      return result;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e || "");
      opts.onError?.(msg, attempt);
      // Clearly permanent failures (auth, bad request, quota) fail fast;
      // everything else — transient provider conditions AND unknown error
      // classes — is retried. The harness promise is resilience: one
      // failed LLM call must never silently downgrade the pipeline.
      const permanent = /invalid api key|unauthorized|authentication|invalid request|bad request|too_many_tokens|insufficient quota/i.test(msg) && !RETRYABLE_ERROR.test(msg);
      if (permanent || attempt >= attempts) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || `${label} failed after ${attempts} attempts`));
}
