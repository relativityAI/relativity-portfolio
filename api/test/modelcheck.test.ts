import { describe, it, expect } from "vitest";
import { classifyModelError, classifyReason } from "../src/modelcheck.js";
import { extractJsonObject } from "../src/skills/skillrun.js";

/**
 * The classifier is the single source of truth for model-failure reporting
 * across /models/validate, the skills pipeline, the agent builder, and skill
 * drafting. Ground truth comes from live provider probes:
 *  - AI SDK v5 puts the HTTP status on `statusCode` (`status` is undefined).
 *  - Gemini reports exhausted free-tier quota as 400 RESOURCE_EXHAUSTED.
 *  - OpenAI-compatible providers without a key 401 with provider-specific text.
 */

function sdkError(message: string, statusCode?: number, name = "AI_APICallError") {
  const e = new Error(message) as any;
  e.name = name;
  if (statusCode !== undefined) e.statusCode = statusCode;
  return e;
}

describe("classifyModelError — structured status first", () => {
  it("classifies a 401 from any provider as an auth failure", () => {
    const f = classifyModelError(sdkError("Missing Authentication header", 401));
    expect(f.reason).toBe("auth");
    expect(f.retryable).toBe(false);
    expect(f.needsKey).toBe(true);
  });

  it("classifies a 429 as a retryable rate limit", () => {
    const f = classifyModelError(sdkError("Too many requests", 429));
    expect(f.reason).toBe("rate_limit");
    expect(f.retryable).toBe(true);
    expect(f.needsKey).toBe(false);
  });

  it("classifies a 403 as plan/permission (key problem, not rate limit)", () => {
    const f = classifyModelError(sdkError("Forbidden", 403));
    expect(f.reason).toBe("forbidden");
    expect(f.retryable).toBe(false);
    expect(f.needsKey).toBe(true);
  });

  it("classifies a 404 as an unknown/deprecated model", () => {
    const f = classifyModelError(sdkError("model not found", 404));
    expect(f.reason).toBe("not_found");
    expect(f.retryable).toBe(false);
  });

  it("classifies 5xx as a retryable provider outage", () => {
    const f = classifyModelError(sdkError("upstream error", 503));
    expect(f.reason).toBe("server_error");
    expect(f.retryable).toBe(true);
  });
});

describe("classifyModelError — 410 Gone (model EOL)", () => {
  it("maps HTTP 410 to deprecated", () => {
    // Live-probed NVIDIA NIM response when llama-3.3-70b hit end of life.
    const f = classifyModelError({
      name: "AI_APICallError",
      message: "Gone",
      statusCode: 410,
      responseBody: JSON.stringify({
        title: "Gone",
        status: 410,
        detail: "The model 'meta/llama-3.3-70b-instruct' has reached its end of life and is no longer available.",
      }),
    });
    expect(f.reason).toBe("deprecated");
    expect(f.retryable).toBe(false);
    expect(f.needsKey).toBe(false);
    expect(f.message).toMatch(/retired|no longer available/i);
  });

  it("maps end-of-life message text to deprecated when no status is present", () => {
    expect(classifyReason("The model has reached its end of life and is no longer available.", undefined)).toBe("deprecated");
  });

  it("keeps 404 as not_found (model unknown, not retired)", () => {
    expect(classifyReason("model not found", 404)).toBe("not_found");
    expect(classifyReason("The model does not exist for your plan.", undefined)).toBe("not_found");
  });
});

describe("extractJsonObject — salvage path for schema-drifted analyst output", () => {
  it("parses fenced JSON that the strict schema rejected (live-probed Cohere reply)", () => {
    // Live-probed: Cohere command-r7b emitted string findings, strict schema
    // rejected, whole skill died. The salvage path needs the raw object back.
    const text = '```json\n{"findings": ["No free cash flow data available."], "verdicts": ["Intrinsic value cannot be calculated."], "tools_used": ["get_dcf_valuation"]}\n```';
    const obj = extractJsonObject(text);
    expect(obj).toBeTruthy();
    expect(Array.isArray(obj!.findings)).toBe(true);
    expect(obj!.findings![0]).toBe("No free cash flow data available.");
  });

  it("returns null for non-JSON text", () => {
    expect(extractJsonObject("I'm sorry, I could not analyze.")).toBeNull();
  });
});

describe("classifyModelError — hard request rejections (TOO_MANY_TOKENS)", () => {
  it("maps Cohere's max-tokens rejection to request_invalid, not no_output", () => {
    // Live-probed: skillrun asked for 8192 output tokens; Cohere's command-r7b
    // caps at 4096 and rejects the whole request with 400 TOO_MANY_TOKENS.
    const f = classifyModelError({
      name: "AI_APICallError",
      message: 'Bad Request: {"error_type":"TOO_MANY_TOKENS","message":"too many tokens: max tokens must be less than or equal to 4096, the maximum output length for this model - received 8192."}',
      statusCode: 400,
    });
    expect(f.reason).toBe("request_invalid");
    expect(f.retryable).toBe(false);
    expect(f.message).toMatch(/model limitation|Pick another model/i);
  });

  it("maps context-length overflows to request_invalid", () => {
    expect(classifyReason("This model's maximum context length is 32768 tokens", undefined)).toBe("request_invalid");
  });
});

describe("classifyModelError — provider message quirks", () => {
  it("catches Gemini's 400 RESOURCE_EXHAUSTED as a rate limit, NOT a bad request", () => {
    const f = classifyModelError(sdkError("400 RESOURCE_EXHAUSTED - quota exceeded for this model", 400));
    expect(f.reason).toBe("rate_limit");
    expect(f.retryable).toBe(true);
  });

  it("catches keyless OpenAI-compatible calls (no Authorization header)", () => {
    expect(classifyReason("Missing Authentication header", undefined)).toBe("auth");
    expect(classifyReason("No cookie auth credentials found", undefined)).toBe("auth");
  });

  it("catches Gemini's 'API key not valid' text", () => {
    expect(classifyReason("API key not valid. Please pass a valid API key.", 400)).toBe("auth");
  });

  it("does not misclassify a genuine 400 INVALID_ARGUMENT as a rate limit", () => {
    expect(classifyReason("400 INVALID_ARGUMENT - thinkingBudget 0 not supported", 400)).not.toBe("rate_limit");
  });

  it("classifies the empty-stream wrapper as no_output", () => {
    const f = classifyModelError(sdkError("No output generated. Check the stream for errors.", undefined, "AI_NoOutputGeneratedError"));
    expect(f.reason).toBe("no_output");
    expect(f.retryable).toBe(true);
  });

  it("keeps our own buildModel no-key error distinct from a rejected key", () => {
    const f = classifyModelError(new Error('No API key configured for "OpenRouter" — add one in Settings.'));
    expect(f.reason).toBe("no_key");
    expect(f.needsKey).toBe(true);
  });

  it("classifies timeouts as retryable", () => {
    expect(classifyReason("Request timed out after 15s", undefined, "TimeoutError")).toBe("timeout");
  });

  it("unknown errors stay unknown but carry the original text", () => {
    const f = classifyModelError(new Error("something bizarre happened"));
    expect(f.reason).toBe("unknown");
    expect(f.message).toContain("something bizarre happened");
  });
});

describe("status beats prose (no contradictory classification)", () => {
  it("a 429 whose message says 'forbidden' is still a rate limit", () => {
    expect(classifyReason("forbidden-ish wording", 429)).toBe("rate_limit");
  });
  it("a 401 whose message mentions quota is still an auth failure", () => {
    expect(classifyReason("quota check failed", 401)).toBe("auth");
  });
});
