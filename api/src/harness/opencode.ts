/**
 * OpenCode Console (Go plan) provider settings.
 *
 * Go serves from /inference/go (pay-as-you-go from /inference) and REQUIRES
 * an `x-opencode-session` header — without it every request 400s with
 * MissingSessionID. The id is stable per process so routed conversations
 * keep their prompt cache.
 *
 * ponytail: one session id per process. Per-conversation ids (pass a run id
 * in) if prompt-cache reuse across a long-lived server ever matters.
 */
import { randomUUID } from "node:crypto";

const sessionId = process.env.OPENCODE_SESSION_ID || `ses_${randomUUID()}`;

export function openCodeBaseURL(): string {
  const base = (process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go").replace(/\/+$/, "");
  return `${base}/openai/v1`;
}

export function openCodeHeaders(): Record<string, string> {
  return {
    "x-opencode-session": sessionId,
    "User-Agent": "relativity-harness/1.0",
  };
}
