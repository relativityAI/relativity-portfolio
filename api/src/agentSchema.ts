/**
 * Canonical zod schema for an agent config — shared by the md parser output,
 * the API write path, and (as a base) the builder's draft partials. This is
 * the single validation point that replaced the per-module zod/domain checks.
 */

import { z } from "zod";
import type { MdIssue } from "./mdconfig.js";

export const OPERATORS = ["gt", "gte", "lt", "lte", "eq", "between"] as const;
export const METRIC_TYPES = ["number", "percentage", "currency", "date", "text"] as const;

export const qualitativeItemSchema = z.object({
  parameter: z.string().min(1, "parameter name is required"),
  content: z.string().default(""),
  weightage: z.number().int().min(1).max(10).default(5),
});

export const quantitativeItemSchema = z.object({
  metric: z.string().min(1, "metric is required"),
  metric_name: z.string().default(""),
  metric_type: z.enum(METRIC_TYPES).default("number"),
  operator: z.enum(OPERATORS).default("gt"),
  value: z.union([z.number(), z.string()]).optional(),
  value_upper: z.union([z.number(), z.string()]).optional(),
  weightage: z.number().int().min(1).max(10).default(5),
});

const evaluationSchema = z.object({
  qualitative: z.array(qualitativeItemSchema).default([]),
  quantitative: z.array(quantitativeItemSchema).default([]),
});

export const agentSchema = z.object({
  name: z.string().min(1, "agent name is required"),
  description: z.string().optional(),
  persona: z
    .object({ philosophy_and_mindset: z.string().default("") })
    .default({ philosophy_and_mindset: "" }),
  configuration: z
    .object({
      investment_horizon: z.string().default(""),
      risk_appetite: z.number().int().min(1).max(10).default(5),
    })
    .default({ investment_horizon: "", risk_appetite: 5 }),
  asset_evaluation: evaluationSchema.default({ qualitative: [], quantitative: [] }),
  macro_evaluation: evaluationSchema.default({ qualitative: [], quantitative: [] }),
});

export type AgentConfigSchema = z.infer<typeof agentSchema>;

export function isAgentConfig(v: unknown): v is AgentConfigSchema {
  return agentSchema.safeParse(v).success;
}

/** Flatten zod issues into {line?, message, severity} triples for API responses. */
export function zodIssues(result: z.SafeParseError<unknown>): MdIssue[] {
  return result.error.issues.map((i) => ({
    line: 0,
    message: `"${i.path.join(".")}": ${i.message}`,
    severity: "error" as const,
  }));
}