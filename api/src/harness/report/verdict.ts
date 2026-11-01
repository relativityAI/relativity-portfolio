/**
 * Report quality verdict — ONE call after the stitch.
 *
 * generateText + extractJson, NOT generateObject: the opencode-compatible
 * gateway rejects response_format/json_schema ("responseFormat is not
 * supported"), so structured mode silently returns prose and parse fails.
 * extractJson (fence-aware, jsonrepair) is the parse this codebase already
 * trusts; zod picks the band. A failed call yields null — never a fabricated
 * grade — and never touches the report. Outside the loop: zero steps, zero
 * budget tokens (ponytail: not counted into budgetUsed).
 */
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { retryLlmCall } from "../resilience.js";
import { log } from "../log.js";
import { extractJson } from "./builder.js";

export const VERDICTS = ["Very Poor", "Poor", "Fair", "Good", "Excellent"] as const;
export type Verdict = (typeof VERDICTS)[number];

const VerdictSchema = z.object({ verdict: z.enum(VERDICTS) });

const SYSTEM =
  "You grade REPORT QUALITY on one fixed scale: Very Poor, Poor, Fair, Good, Excellent.\n" +
  "Judge the artifact only — completeness against its stated structure, cited evidence behind claims, " +
  "figures carrying measure and source, number discipline, coherence and editing. " +
  "Do NOT judge the investment conclusion or the direction of the call.\n" +
  'Reply with ONE JSON object and nothing else: {"verdict":"<one of the five bands>"}';

export async function gradeReport(o: {
  /** Digest of the final document (dumpMarkdown with SVGs stripped). */
  text: string;
  model: LanguageModel;
  abortSignal?: AbortSignal;
}): Promise<Verdict | null> {
  if (o.abortSignal?.aborted) return null;
  try {
    return await retryLlmCall(
      "report verdict",
      async (signal) => {
        const r = await generateText({
          model: o.model,
          system: SYSTEM,
          prompt: o.text,
          temperature: 0,
          // Reasoning models burn the cap on thinking first — 100 tokens left
          // an empty text and every grade failed. Headroom, not output size.
          maxOutputTokens: 2_000,
          abortSignal: signal,
        });
        const parsed = VerdictSchema.safeParse(extractJson(r.text ?? ""));
        if (!parsed.success) throw new Error(`unparseable verdict: ${(r.text ?? "").slice(0, 120)}`);
        return parsed.data.verdict;
      },
      { attempts: 2, timeoutMs: 60_000, check: (v) => !!v },
    );
  } catch (e: any) {
    log.warn("verdict", `grading failed — ${String(e?.message || e).slice(0, 200)}`);
    return null;
  }
}
