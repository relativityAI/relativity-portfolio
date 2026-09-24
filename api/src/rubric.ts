/**
 * Rubric compiler (plan §6.3) — turns an agent's qualitative parameters into
 * atomic, answerable criteria, compiled by a strong model at temperature 0.
 *
 * Criteria are either PREDICATES (computed deterministically from the §6.2
 * feature catalog via predicates.ts) or JUDGE items (graded anchors + an
 * evidence spec for the micro-judge). The compiler never outputs scores,
 * weights, or thresholds — it only decomposes "what to check".
 *
 * Validation rejects and retries ×2, then fails with a message. Approved
 * rubrics (owner click) are pinned; an md change invalidates approval.
 */

import { z } from "zod";
import { generateObject } from "ai";
import { createHash } from "node:crypto";
import jsonLogic from "json-logic-js";
// Registers the custom ops (count_gt, slope, min_last, pct_change) globally.
import "./predicates.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { FEATURE_CATALOG } from "./units.js";
import { getDb } from "./db.js";
import { getModels } from "./models.js";
import { keyPool } from "./keypool.js";

export const anchorSchema = z.object({
  yes: z.string().min(1),
  partial: z.string().min(1),
  no: z.string().min(1),
});

export const evidenceSchema = z.object({
  features: z.array(z.string()).default([]),
  retrieval: z.array(z.string()).default([]),
  event_types: z.array(z.string()).default([]),
});

/** Predicate criteria: computed by the deterministic evaluator. */
const predicateCriterionSchema = z.object({
  kind: z.literal("predicate"),
  id: z.string().min(1),
  /** Expression in JSON-Logic form over {"var": "<featureKey>"}. */
  expr: z.record(z.unknown()),
  /** Feature keys the expression reads; any null → INSUFFICIENT. */
  requires: z.array(z.string()).min(1),
});

/** Judge criteria: answered by the micro-judge from anchors + evidence. */
const judgeCriterionSchema = z.object({
  kind: z.literal("judge"),
  id: z.string().min(1),
  anchors: anchorSchema,
  evidence: evidenceSchema,
});

export const criterionSchema = z.discriminatedUnion("kind", [predicateCriterionSchema, judgeCriterionSchema]);

/** One compiled parameter: preserves the source parameter + weightage. */
export const rubricItemSchema = z.object({
  parameter: z.string().min(1),
  section: z.enum(["asset_evaluation", "macro_evaluation"]),
  weightage: z.number().int().min(1).max(10),
  criteria: z.array(criterionSchema).min(1).max(8),
});

export const compiledRubricSchema = z.object({
  parameters: z.array(rubricItemSchema).min(1),
});

export type Criterion = z.infer<typeof criterionSchema>;
export type RubricItem = z.infer<typeof rubricItemSchema>;
export type CompiledRubric = z.infer<typeof compiledRubricSchema>;

/** Fixture feature set used to smoke-test every predicate expression. */
export const FIXTURE_FEATURES: Record<string, unknown> = (() => {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(FEATURE_CATALOG)) {
    out[key] = spec.series ? [10, 14, 18, 22, 26] : spec.unit === "count" ? 5 : 1.5;
  }
  return out;
})();

export interface CompileOptions {
  model?: string;
  apiKey?: string;
  llmKeys?: Record<string, string | undefined>;
}

/** Model override or the strongest configured — lazy so tests can set env. */
export function compilerModel(): string {
  if (config.rubricCompilerModel) return config.rubricCompilerModel;
  const all = getModels();
  // priority 1 = strongest curated.
  return all.find((m) => typeof m.priority === "number")?.id ?? "";
}

/**
 * Validate a compiled rubric. Returns issues (empty = pass). Every predicate
 * key must exist in the feature catalog and evaluate cleanly on the fixture.
 */
export function validateRubric(rubric: CompiledRubric): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const item of rubric.parameters) {
    for (const c of item.criteria) {
      if (ids.has(c.id)) {
        issues.push(`duplicate criterion id "${c.id}"`);
        continue;
      }
      ids.add(c.id);
      if (c.kind === "predicate") {
        for (const k of c.requires) {
          if (!(k in FEATURE_CATALOG)) issues.push(`criterion "${c.id}": unknown feature "${k}"`);
        }
        try {
          jsonLogic.apply(c.expr, FIXTURE_FEATURES);
        } catch {
          issues.push(`criterion "${c.id}": expression fails on fixture features`);
        }
      } else {
        const sources = [c.evidence.features.length, c.evidence.retrieval.length, c.evidence.event_types.length];
        if (sources.every((n) => n === 0)) issues.push(`criterion "${c.id}": judge needs ≥1 evidence source`);
        if (!c.anchors.yes || !c.anchors.partial || !c.anchors.no) {
          issues.push(`criterion "${c.id}": judge needs non-empty YES/PARTIAL/NO anchors`);
        }
      }
    }
  }
  for (const item of rubric.parameters) {
    const predicateCount = item.criteria.filter((c) => c.kind === "predicate").length;
    if (item.section === "macro_evaluation" && item.criteria.length > 3) {
      issues.push(`"${item.parameter}": macro params cap at 3 criteria`);
    }
    log.info("[rubric]", `${item.parameter}: ${predicateCount}/${item.criteria.length} predicate`);
  }
  return issues;
}

export function rubricHash(rubric: CompiledRubric): string {
  return createHash("sha256").update(JSON.stringify(rubric)).digest("hex").slice(0, 16);
}

interface CompileResultOk {
  ok: true;
  rubric: CompiledRubric;
  compilerVersion: string;
  issues: string[];
}
interface CompileResultErr {
  ok: false;
  error: string;
}
export type CompileResult = CompileResultOk | CompileResultErr;

// Compiler prompt/schema version — change when the compiled shape or validation changes.
const RUBRIC_SPEC_VERSION = "1";

/**
 * Compile via generateObject, validate, retry ×2 on validation failure. The
 * caller decides whether to persist (agent save) — this fn stays pure-ish.
 */
export async function compileRubric(
  prompt: string,
  opts: CompileOptions,
): Promise<CompileResult> {
  const model = opts.model || compilerModel();
  if (!model) return { ok: false, error: "no compiler model configured (set RUBRIC_COMPILER_MODEL)" };
  const { buildModel } = await import("./agent.js");
  const llmKeys = (opts.llmKeys || {}) as Record<string, string | undefined>;
  const { apiKey } = keyPool.pickKey(model, llmKeys);
  const finalModel = buildModel(model, llmKeys, apiKey || opts.apiKey);

  const lastIssues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await generateObject({
        model: finalModel,
        schema: compiledRubricSchema,
        prompt,
        temperature: 0,
        maxOutputTokens: 8000,
      });
      const issues = validateRubric(res.object);
      if (issues.length === 0) {
        return { ok: true, rubric: res.object, compilerVersion: RUBRIC_SPEC_VERSION, issues };
      }
      lastIssues.push(...issues.slice(0, 5));
      log.warn("[rubric]", `compile attempt ${attempt + 1} failed validation: ${issues.join("; ")}`);
    } catch (e: any) {
      lastIssues.push(String(e?.message || e));
      log.warn("[rubric]", `compile attempt ${attempt + 1} threw: ${String(e?.message || e)}`);
    }
  }
  return { ok: false, error: `rubric compile failed after 3 attempts: ${lastIssues.slice(0, 6).join("; ")}` };
}

// Self-check: npx tsx src/rubric.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const good: CompiledRubric = {
    parameters: [
      {
        parameter: "Return Durability",
        section: "asset_evaluation",
        weightage: 8,
        criteria: [
          {
            kind: "predicate",
            id: "durability-capital-allocation-yes",
            expr: { ">=": [{ min_last: [{ var: "roe_annual" }, 5] }, 15] },
            requires: ["roe_annual"],
          },
          {
            kind: "judge",
            id: "durability-management-evidence",
            anchors: { yes: "good", partial: "mixed", no: "bad" },
            evidence: { features: ["roe_annual"], retrieval: ["management quality"], event_types: ["mgmt_change"] },
          },
        ],
      },
    ],
  };
  const issues = validateRubric(good);
  if (issues.length) throw new Error(`validateRubric: ${issues.join("; ")}`);
  const broken = validateRubric({ parameters: [{ parameter: "x", section: "asset_evaluation", weightage: 5, criteria: [{ kind: "predicate", id: "p1", expr: { ">=": [{ var: "no_such_feature" }, 5] }, requires: ["no_such_feature"] }] }] });
  if (!broken.length) throw new Error("validateRubric should reject unknown feature");
  if (typeof rubricHash(good) !== "string") throw new Error("rubricHash failed");
  console.log("rubric OK");
}