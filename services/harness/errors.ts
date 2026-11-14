/**
 * Provider error normalization.
 *
 * Models surface errors as raw dumps — Google quota pages, URL-laden
 * RESOURCE_EXHAUSTED blobs, stack-ish provider text. Those strings must never
 * reach a report section or a live timeline verbatim. This module maps them to
 * short human sentences, and when the provider says "retry in N seconds"
 * (Gemini does, exactly), surfaces that wait so the caller can back off
 * instead of burning the section.
 */

/**
 * Wait the provider asked for, in ms. Gemini embeds "Please retry in 44.8s"
 * in the quota message — honor it, capped so one slow window can't stall the
 * whole run.
 */
export function providerWaitMs(msg: string, capMs = 60_000): number {
  const m = msg.match(/retry in ([\d.]+)s/i);
  if (!m) return 10_000; // rate-limited without a hint — a short default
  const secs = Number(m[1]);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, capMs) : 10_000;
}

/** Short human sentence for a provider error; safe for a report or timeline. */
export function friendlyError(msg: string): string {
  const m = String(msg ?? "");
  if (/exceeded your current quota|quota exceeded|resource.?exhausted|insufficient.?quota/i.test(m)) {
    const wait = m.match(/retry in ([\d.]+)s/i);
    return wait
      ? `Model provider quota exhausted — the provider asked to retry in ${Math.ceil(Number(wait[1]))}s`
      : "Model provider quota exhausted for this key";
  }
  if (/429|rate.?limit|too many requests/i.test(m)) return "Model provider rate limit hit";
  if (/insufficient credits/i.test(m)) return "Provider reports insufficient credits for this model";
  if (/invalid api key|unauthorized|authentication/i.test(m)) return "Model API key was rejected";
  if (/timed? ?out|ETIMEDOUT|timeout/i.test(m)) return "The model call timed out";
  if (/ECONNRESET|fetch failed|network/i.test(m)) return "Network error reaching the model provider";
  if (/overloaded/i.test(m)) return "Model provider is overloaded";
  const trimmed = m.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed || "Unknown provider error";
}
