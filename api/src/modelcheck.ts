/**
 * modelcheck — one classifier for every LLM provider failure.
 *
 * Every surface that calls a model (analysis pipeline, agent builder, skill
 * drafting, quant judge, the /models/validate pre-flight) must report the SAME
 * machine-readable reason so the UI can say what actually happened and whether
 * retrying or switching models can help — instead of the provider's raw
 * message or an opaque "No output generated".
 *
 * Ground truth from live probes (AI SDK v5 / @ai-sdk/* 3.x):
 *  - The SDK throws AI_APICallError with the HTTP status on `statusCode`
 *    (`status` is undefined). The message is provider-specific prose.
 *  - Gemini reports exhausted free-tier quota as **400 RESOURCE_EXHAUSTED**,
 *    not 429 — the status alone mislabels it as a bad request.
 *  - OpenAI-compatible providers called with no key 401 ("Missing
 *    Authentication header" / "No cookie auth credentials found").
 *  - An empty stream (provider answered nothing) flushes as a generic
 *    AI_NoOutputGeneratedError whose message hides the real cause; the harness
 *    unwraps that upstream (see harness.ts) and passes the real error here.
 */

export type ModelFailureReason =
  | "no_key" // no API key configured for the provider
  | "auth" // 401: key invalid/expired
  | "forbidden" // 403: key valid but lacks access to the model
  | "rate_limit" // 429 / RESOURCE_EXHAUSTED: quota or rate limit hit
  | "not_found" // 404: model id unknown to the provider
  | "deprecated" // 410: model reached end of life at the provider
  | "timeout" // caller/deadline abort or network timeout
  | "server_error" // 5xx: provider outage
  | "no_output" // stream completed but produced nothing usable
  | "request_invalid" // request exceeded model limits (max tokens, context length)
  | "unknown";

export interface ModelFailure {
  reason: ModelFailureReason;
  /** Human-facing message, safe to show verbatim in the UI. */
  message: string;
  /**
   * True when the same model/key can plausibly succeed on a later attempt
   * (rate limit, outage, timeout). False for key/model problems where
   * retrying is pointless — the user must change something.
   */
  retryable: boolean;
  /** True when adding/fixing an API key resolves it. */
  needsKey: boolean;
}

const REASONS: Record<ModelFailureReason, Omit<ModelFailure, "reason">> = {
  no_key: {
    message: "No API key is configured for this provider. Add one in Settings, or pick a model from a provider that has a key.",
    retryable: false,
    needsKey: true,
  },
  auth: {
    message: "The API key was rejected (invalid or expired). Update it in Settings.",
    retryable: false,
    needsKey: true,
  },
  forbidden: {
    message: "The API key doesn't have access to this model. Check the provider plan or permissions.",
    retryable: false,
    needsKey: true,
  },
  rate_limit: {
    message: "Rate limit or quota exhausted for this key. Retry in a bit, or pick a model on another provider.",
    retryable: true,
    needsKey: false,
  },
  not_found: {
    message: "The provider doesn't know this model — it may be deprecated or unavailable on your plan.",
    retryable: false,
    needsKey: false,
  },
  deprecated: {
    message: "This model has been retired by the provider and is no longer available — pick another model.",
    retryable: false,
    needsKey: false,
  },
  timeout: {
    message: "The model didn't respond in time. The provider may be slow or overloaded — retry, or pick another model.",
    retryable: true,
    needsKey: false,
  },
  server_error: {
    message: "The provider had a server error (temporary outage). Retry shortly, or pick another model.",
    retryable: true,
    needsKey: false,
  },
  no_output: {
    message: "The model returned no output. It may be overloaded or incompatible with tool use — retry once, or pick another model.",
    retryable: true,
    needsKey: false,
  },
  request_invalid: {
    message: "The request exceeded what this model accepts (e.g. its max output or context size) — it is a model limitation, not your key. Pick another model.",
    retryable: false,
    needsKey: false,
  },
  unknown: {
    message: "The model call failed for an unexpected reason.",
    retryable: true,
    needsKey: false,
  },
};

/**
 * Classify any thrown error from an LLM call into a ModelFailure.
 * Checks structured status fields first (most accurate), then message text.
 */
export function classifyModelError(e: unknown): ModelFailure {
  const err = e as { name?: string; message?: string; statusCode?: unknown; status?: unknown } | null | undefined;
  const msg = String(err?.message || err || "");
  // The AI SDK puts the HTTP status on statusCode (probed live: `status` is
  // undefined). Accept both plus numeric codes embedded in provider data.
  const status =
    typeof err?.statusCode === "number" ? err.statusCode :
    typeof err?.status === "number" ? err.status :
    undefined;

  const reason = classifyReason(msg, status, err?.name);
  return { reason, ...REASONS[reason], ...(reason === "unknown" ? { message: `${REASONS.unknown.message} (${msg.slice(0, 200)})` } : {}) };
}

export function classifyReason(msg: string, status: number | undefined, errName?: string): ModelFailureReason {
  const name = String(errName || "");
  // Structured FIRST — a definitive HTTP status beats any prose guesswork:
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  if (status === 410) return "deprecated";
  if (status !== undefined && status >= 500) return "server_error";
  // Gemini reports exhausted quota as 400 RESOURCE_EXHAUSTED; real bad-request
  // 400s say "INVALID_ARGUMENT". RESOURCE_EXHAUSTED wins over the 400.
  if (/RESOURCE_EXHAUSTED/i.test(msg)) return "rate_limit";
  // Then message text for errors that carry no usable status:
  if (/401|unauthorized|invalid.*api.*key|missing authentication|auth credentials|api key not valid/i.test(msg)) return "auth";
  if (/403|forbidden|not authorized to access/i.test(msg)) return "forbidden";
  if (/429|rate.?limit|quota exceeded|too many requests/i.test(msg)) return "rate_limit";
  if (/404|model.*not found|does not exist/i.test(msg)) return "not_found";
  if (/decommissioned|end of life|no longer available/i.test(msg)) return "deprecated";
  // errName covers AI SDK AbortError-shaped rejections; "time budget" is the
  // harness deadline message ("Model turn exceeded its Ns time budget"), which
  // previously fell through to the generic no-tools branch and told users to
  // switch models when the real cause was a slow turn.
  if (errName === "TimeoutError" || /timeout|timed out|time budget|ETIMEDOUT|aborted|socket hang up/i.test(msg)) return "timeout";
  if (/overloaded|internal error|bad gateway|service unavailable|5\d\d/i.test(msg)) return "server_error";
  if (/No API key/i.test(msg)) return "no_key";
  if (/NoOutputGenerated|No output generated|no output/i.test(msg) || name === "AI_NoOutputGeneratedError") return "no_output";
  // Cohere-style hard request rejection (live-probed: "TOO_MANY_TOKENS — max
  // tokens must be less than or equal to 4096 … received 8192"). Permanent,
  // not transient — retrying the same request can never succeed.
  if (/TOO_MANY_TOKENS|max tokens must be|maximum output length|context length|too many tokens/i.test(msg)) return "request_invalid";
  return "unknown";
}

/** True when this error text/class means the whole request can succeed on retry. */
export function isRetryableModelFailure(e: unknown): boolean {
  return classifyModelError(e).retryable;
}
