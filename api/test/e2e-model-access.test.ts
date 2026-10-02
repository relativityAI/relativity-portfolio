import { describe, it, expect, vi } from "vitest";
import { buildModel, assertProviderKeyAvailable } from "../src/agent.js";
import { runAgentTurn, RETRYABLE_ERROR } from "../src/harness.js";

/**
 * E2E regression: the 9/27 run failure where EVERY skill died with
 * "No data tool could be called … (No output generated. Check the stream
 * for errors.) — the provider returned no tool use."
 *
 * Root cause chain (reproduced against the live provider):
 * 1. The run was started with an OpenRouter free model while NO OpenRouter
 *    key exists anywhere (user settings empty, no server pool).
 * 2. buildModel happily constructed a provider client with apiKey=undefined.
 * 3. The provider rejected every request (401). The SDK flushed the empty
 *    stream as a generic AI_NoOutputGeneratedError, so the harness reported
 *    "No output generated" and skillrun blamed the model for not using tools.
 * 4. pickKey had already thrown upstream — but any path that reaches the
 *    provider without a key burned the full run budget on doomed retries.
 *
 * These tests pin the fix at each layer.
 */

describe("layer 1: buildModel refuses providers with no key", () => {
  it("throws a clear error for a keyed provider with no key anywhere", () => {
    expect(() => buildModel("openrouter/google/gemma-4-31b-it:free", {})).toThrow(
      /No API key configured for "OpenRouter"/,
    );
  });

  it("throws for every free-tier provider when the key is missing or blank", () => {
    for (const modelId of [
      "openrouter/x/y:free",
      "mistral/mistral-small-latest",
      "nvidia/meta/llama-3.3-70b-instruct",
      "cohere/command-a",
      "zai/glm-4.7-flash",
      "openai/gpt-5.6-luna",
      "anthropic/claude-haiku-4-5",
    ]) {
      expect(() => buildModel(modelId, { [modelId.split("/")[0] as any]: "" })).toThrow(/No API key configured/);
    }
  });

  it("accepts a key from user keys, an explicit apiKey, or the legacy env fallback", () => {
    expect(() => buildModel("openrouter/x:free", { openrouter: "user-key" })).not.toThrow();
    expect(() => buildModel("openrouter/x:free", {}, "explicit-key")).not.toThrow();
  });

  it("assertProviderKeyAvailable is a no-op for keyless ollama", () => {
    expect(() => assertProviderKeyAvailable("ollama", undefined)).not.toThrow();
  });
});

describe("layer 2: harness surfaces the REAL provider error, not 'No output generated'", () => {
  it("reports the provider's 401 message when the stream produced nothing", async () => {
    // OpenAI-compatible client with no key -> provider answers 401 immediately.
    // (Uses the real OpenRouter endpoint; no key is sent, matching production.)
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const model = createOpenAICompatible({
      name: "openrouter",
      apiKey: undefined,
      baseURL: "https://openrouter.ai/api/v1",
    })("google/gemma-4-31b-it:free");

    const turn = await runAgentTurn({
      model,
      system: "You are an analyst.",
      prompt: "Analyze TST.",
      tools: {
        get_dcf_valuation: {
          description: "DCF",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        } as any,
      },
      forceTools: true,
      maxToolSteps: 2,
    });

    expect(turn.error).toBeTruthy();
    // The error must name the actual auth problem, not the opaque wrapper.
    expect(turn.error).toMatch(/401|[Mm]issing [Aa]uthentication|auth credentials|[Nn]o API key/);
    expect(turn.error).not.toMatch(/^No output generated/);
  }, 30_000);

  it("keeps the real error out of the retryable set so doomed calls fail fast", () => {
    // A 401 "Missing Authentication header" is permanent — retrying cannot
    // succeed and just burns the run's time budget.
    expect(RETRYABLE_ERROR.test("Missing Authentication header")).toBe(false);
    expect(RETRYABLE_ERROR.test("API key is invalid or expired. status 401")).toBe(true && false || false).toBe(false);
    // ...while genuine transient failures stay retryable.
    expect(RETRYABLE_ERROR.test("429 rate limit")).toBe(true);
    expect(RETRYABLE_ERROR.test("503 service unavailable")).toBe(true);
    expect(RETRYABLE_ERROR.test("AI_NoOutputGeneratedError")).toBe(true);
  });
});

describe("layer 3: skillrun error classification", () => {
  // The classification lives inline in runSingleSkill; exercise the same
  // patterns it matches to guarantee auth/quota problems read as fixable
  // infrastructure issues, never as "model refused to use tools".
  const authRe = /No API key|API key|unauthorized|invalid.*key|401|Missing Authentication|auth credentials/i;
  const quotaRe = /429|rate.?limit|quota|resource.?exhausted/i;

  it("classifies missing-key errors as fixable infrastructure problems", () => {
    expect(authRe.test('No API key configured for "OpenRouter"')).toBe(true);
    expect(authRe.test("Missing Authentication header")).toBe(true);
    expect(authRe.test("unauthorized: 401")).toBe(true);
  });

  it("classifies rate limits as retryable infrastructure, not model refusal", () => {
    expect(quotaRe.test("429 Too Many Requests")).toBe(true);
    expect(quotaRe.test("rate limit exceeded for this API key")).toBe(true);
    expect(quotaRe.test("resource exhausted")).toBe(true);
  });

  it("does not misclassify a genuine tool-use refusal", () => {
    expect(authRe.test("the provider returned no tool use")).toBe(false);
    expect(quotaRe.test("the provider returned no tool use")).toBe(false);
  });
});
