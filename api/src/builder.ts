/**
 * Builder agent — LLM orchestration for conversational agent creation.
 * Stateless: each request includes full context (schema, metrics, documents, history).
 * Session state lives on the client.
 */

import { generateText, Output, isStepCount } from "ai";
import { z } from "zod";
import { buildModel, type LlmKeys } from "./agent.js";
import { getSchemaDescriptor, type SchemaDescriptor } from "./schema.js";
import type { MetricDef } from "./metrics.js";
import { normalizeQuantRules } from "./metrics.js";
import { buildAgentBuilderSystemPrompt, buildBuilderRecoveryPrompt, buildDocumentExtractionPrompt } from "./prompts.js";
import { buildWebSearchTool } from "./tools.js";
import { getDb } from "./db.js";

const qualitativeParamSchema = z.object({
  parameter: z.string().describe("Short parameter name, e.g., Market Leadership"),
  content: z.string().describe("Scoring checklist or criteria rules (1-3 sentences)"),
  weightage: z.number().describe("Weightage 1 to 10"),
});

const quantitativeRuleSchema = z.object({
  metric: z.string().describe("Metric ID from available catalog, e.g. return_on_equity"),
  metric_name: z.string().optional().describe("Human readable metric name"),
  metric_type: z.string().optional().describe("Metric type: number, percentage, currency, ratio"),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]).describe("Comparison operator"),
  value: z.any().describe("Target threshold value"),
  value_upper: z.any().optional().describe("Upper bound if operator is between"),
  weightage: z.number().describe("Weightage 1 to 10"),
});

export const agentDraftSchema = z.object({
  name: z.string().optional().describe("Short name for the agent"),
  style: z.string().optional().describe("Investment style identifier (value, growth, momentum, etc)"),
  philosophy: z.string().optional().describe("Comprehensive 2-3 paragraph investment philosophy"),
  configuration: z
    .object({
      investment_horizon: z.string().optional().describe("e.g. Long-term (years)"),
      risk_appetite: z.string().optional().describe("e.g. Aggressive (7)"),
    })
    .optional(),
  asset_evaluation: z
    .object({
      qualitative: z.array(qualitativeParamSchema).optional().describe("Qualitative asset evaluation checklist parameters"),
      quantitative: z.array(quantitativeRuleSchema).optional().describe("Quantitative asset evaluation metrics"),
    })
    .optional(),
  macro_evaluation: z
    .object({
      qualitative: z.array(qualitativeParamSchema).optional().describe("Qualitative macro evaluation checklist parameters"),
      quantitative: z.array(quantitativeRuleSchema).optional().describe("Quantitative macro evaluation metrics"),
    })
    .optional(),
});

export const builderResponseSchema = z.object({
  message: z.string().describe("Conversational response to the user"),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
      })
    )
    .optional()
    .describe("4-7 interactive option choices for the user"),
  agent_draft_update: agentDraftSchema
    .optional()
    .describe("Updates or additions to the agent draft configuration. ALWAYS include when drafting or updating the agent configuration."),
  thinking: z.string().optional().describe("Internal reasoning or evaluation notes"),
  annotations: z
    .array(
      z.object({
        what: z.string().describe("The agent setting chosen"),
        basis: z.string().describe("The exact source basis for this decision"),
      })
    )
    .optional()
    .describe("Citations mapping agent configuration choices to sources"),
});

export interface BuilderMessage {
  role: "assistant" | "user";
  content: string;
  options?: { id: string; label: string; description?: string }[];
}

export interface BuilderRequest {
  session_id?: string;
  user_id?: string;
  model_id: string;
  llm_keys: LlmKeys;
  messages: BuilderMessage[];
  agent_draft: Record<string, unknown>;
  metrics: MetricDef[];
  document_texts: { filename: string; text: string }[];
  user_response?: string;
}

export interface BuilderResponse {
  message: string;
  options?: { id: string; label: string; description?: string }[];
  agent_draft_update?: Record<string, unknown>;
  thinking?: string;
  sources?: string[];
  search_results?: { query: string; title: string; url: string }[];
  annotations?: { what: string; basis: string }[];
}

/** Audit trail persistence for builder session turns */
async function persistBuilderSessionTurn(
  req: BuilderRequest,
  res: BuilderResponse
): Promise<void> {
  if (!req.session_id || !req.user_id) return;
  try {
    const db = getDb();
    await db.from("builder_sessions").insert({
      session_id: req.session_id,
      user_id: req.user_id,
      turn_index: req.messages.length,
      user_message: req.user_response || "",
      agent_draft_snapshot: res.agent_draft_update || req.agent_draft || {},
      annotations: res.annotations || [],
      sources: res.sources || [],
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn(`[builder] failed to persist session turn: ${e?.message}`);
  }
}

// System prompt logic moved to prompts.ts

// Extract web_search tool calls into readable "query → sources" strings.
function extractWebSources(steps: any[]): string[] {
  const out: string[] = [];
  for (const step of steps || []) {
    for (const tc of step?.toolCalls || []) {
      if (tc.toolName !== "web_search") continue;
      const query = tc.input?.query;
      const res = step?.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId)?.output;
      const domains = Array.from(new Set((res?.results || []).map((r: any) => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          return r.url;
        }
      })));
      if (!domains.length) continue;
      const n = res?.results?.length || domains.length;
      out.push(query ? `${query} → ${n} results → ${domains.join(", ")}` : `${n} results → ${domains.join(", ")}`);
    }
  }
  return out;
}

// Extract the structured articles actually returned by Tavily, so the UI can
// show exactly what the model had access to (query → title → url).
export function extractSearchResults(steps: any[]): { query: string; title: string; url: string }[] {
  const out: { query: string; title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const step of steps || []) {
    for (const tc of step?.toolCalls || []) {
      if (tc.toolName !== "web_search") continue;
      const res = step?.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId)?.output;
      for (const r of res?.results || []) {
        if (!r?.url || seen.has(r.url)) continue;
        seen.add(r.url);
        let fallback = r.url;
        try {
          fallback = new URL(r.url).hostname.replace(/^www\./, "");
        } catch {}
        out.push({
          query: tc.input?.query || "",
          title: r.title || fallback,
          url: r.url,
        });
      }
    }
  }
  return out;
}

// Map display-name-only quantitative rules back to catalog metric ids and sync schema fields.
function normalizeDraft(update: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!update) return update;
  const next: Record<string, unknown> = { ...update };

  // Sync top-level philosophy and persona.philosophy_and_mindset
  const phil = (next.philosophy as string) || (next.persona as any)?.philosophy_and_mindset;
  if (phil) {
    next.philosophy = phil;
    next.persona = {
      ...(typeof next.persona === "object" && next.persona ? (next.persona as any) : {}),
      philosophy_and_mindset: phil,
    };
  }

  // Normalize risk_appetite if expressed as string like "Aggressive (7)"
  if (next.configuration && typeof next.configuration === "object") {
    const cfg = { ...(next.configuration as Record<string, unknown>) };
    if (typeof cfg.risk_appetite === "string") {
      const match = cfg.risk_appetite.match(/\d+/);
      if (match) cfg.risk_appetite = Number(match[0]);
    }
    next.configuration = cfg;
  }

  for (const key of ["asset_evaluation", "macro_evaluation"]) {
    const sec = next[key];
    if (sec && typeof sec === "object" && !Array.isArray(sec)) {
      const s = sec as Record<string, unknown>;
      if (Array.isArray(s.quantitative)) s.quantitative = normalizeQuantRules(s.quantitative);
    }
  }
  return next;
}

export function getTextFromSteps(result: any): string {
  if (result?.text && result.text.trim()) return result.text;
  if (Array.isArray(result?.steps)) {
    for (let i = result.steps.length - 1; i >= 0; i--) {
      const stepText = result.steps[i]?.text;
      if (stepText && stepText.trim()) return stepText;
    }
  }
  return "";
}

// Pull and parse the first balanced {...} JSON object out of arbitrary model text.
export function parseJsonObject(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (inString) {
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Process a builder conversation turn.
 * Returns the LLM's response with conversation text, options, and/or agent draft updates.
 */
export async function processBuilderTurn(req: BuilderRequest): Promise<BuilderResponse> {
  const schema = getSchemaDescriptor();
  const model = buildModel(req.model_id, req.llm_keys);
  console.log(`[builder] model_id=${req.model_id} keys=${Object.keys(req.llm_keys).join(",")}`);

  // Build conversation context for the LLM
  const conversationHistory = req.messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  // Build document context
  let docContext = "";
  if (req.document_texts.length > 0) {
    docContext =
      "\n\n## Uploaded Documents\n" +
      req.document_texts
        .map((d) => `### ${d.filename}\n${d.text.slice(0, 8000)}`)
        .join("\n\n");
  }

  // Build current draft context
  let draftContext = "";
  if (req.agent_draft && Object.keys(req.agent_draft).length > 0) {
    draftContext = "\n\n## Current Agent Draft\n```json\n" + JSON.stringify(req.agent_draft, null, 2) + "\n```";
  }

  const userMessage = req.user_response
    ? `\n\n## User's Latest Response\n${req.user_response}`
    : "";

  const prompt =
    (conversationHistory ? "## Conversation So Far\n" + conversationHistory + "\n\n" : "") +
    draftContext +
    docContext +
    userMessage +
    "\n\nRespond with JSON only.";

  const tools = req.llm_keys.tavily
    ? { web_search: buildWebSearchTool(req.llm_keys.tavily) }
    : undefined;

  // When the user explicitly asks to search the web, force the tool so the
  // model can't shortcut straight to memory.
  const explicitSearch = /\b(?:search\w*|research\w*|look\w*\s+up|find\w*\s+out)\b/i.test(req.user_response || "");
  if (explicitSearch && !tools) {
    return {
      message:
        "Web search needs a Tavily API key — add it in Settings, then try again.",
    };
  }
  const session = {
    model,
    instructions: buildAgentBuilderSystemPrompt(schema, req.metrics),
    prompt,
    temperature: 0.4,
    stopWhen: isStepCount(3),
    maxRetries: 0,
  };
  // Search is best-effort: forced on explicit request, but if the provider chokes
  // (free-tier models often lack tool support) fall back to answering without tools.
  const attempts: Array<Record<string, unknown>> = tools
    ? explicitSearch
      ? [{ tools, toolChoice: "required" }, { tools, toolChoice: "auto" }, {}]
      : [{ tools, toolChoice: "auto" }]
    : [{}];

  let result: Awaited<ReturnType<typeof generateText>> | undefined;
  for (const attempt of attempts) {
    try {
      result = await generateText({ ...session, ...attempt } as any);
      break;
    } catch (e: any) {
      console.warn(`[builder] attempt ${JSON.stringify(attempt)} failed: ${e?.message}`);
    }
  }

  // Fallback attempt without output constraint if structured output fails
  if (!result) {
    try {
      result = await generateText(session as any);
    } catch (e: any) {
      console.warn(`[builder] unconstrained attempt failed: ${e?.message}`);
    }
  }

  if (!result) throw new Error("All model attempts failed");

  const sources = extractWebSources(result.steps);
  const searchResults = extractSearchResults(result.steps);
  const rawText = getTextFromSteps(result);
  let parsed: any = (result as any).output || parseJsonObject(rawText);

  // If parsing failed OR agent_draft_update is missing, run a focused recovery pass
  if (!parsed || !parsed.agent_draft_update) {
    try {
      const retry = await generateText({
        model,
        instructions: buildAgentBuilderSystemPrompt(schema, req.metrics),
        prompt: buildBuilderRecoveryPrompt(prompt, rawText),
        temperature: 0.3,
      } as any);
      const retryText = getTextFromSteps(retry);
      const retryParsed = parseJsonObject(retryText);
      if (retryParsed) {
        parsed = {
          ...parsed,
          ...retryParsed,
          agent_draft_update: retryParsed.agent_draft_update || parsed?.agent_draft_update,
        };
      }
    } catch (e: any) {
      console.warn(`[builder] JSON recovery failed: ${e?.message}`);
    }
  }

  if (!parsed) {
    const fallbackRes: BuilderResponse = {
      message: "I had trouble processing that. Could you try again?",
      sources: sources.length ? sources : undefined,
      search_results: searchResults.length ? searchResults : undefined,
    };
    await persistBuilderSessionTurn(req, fallbackRes);
    return fallbackRes;
  }

  // Fallback synthesis: If agent_draft_update is still missing, build one from existing draft or prompt context
  if (!parsed.agent_draft_update) {
    const existing = req.agent_draft || {};
    const name = (existing.name as string) || (req.user_response?.slice(0, 30) ? `${req.user_response.slice(0, 30)} Agent` : "Investment Agent");
    const philosophy = (existing.philosophy as string) || (existing.persona as any)?.philosophy_and_mindset || (parsed.message ? parsed.message.slice(0, 300) : "Growth oriented investment strategy focusing on long-term compounders.");
    parsed.agent_draft_update = {
      name,
      philosophy,
      persona: { philosophy_and_mindset: philosophy },
      configuration: {
        investment_horizon: (existing.configuration as any)?.investment_horizon || "Long-term (3+ years)",
        risk_appetite: (existing.configuration as any)?.risk_appetite || 5,
      },
      asset_evaluation: existing.asset_evaluation || { qualitative: [], quantitative: [] },
      macro_evaluation: existing.macro_evaluation || { qualitative: [], quantitative: [] },
    };
  }

  // Annotations must cite only sources that actually exist in this turn:
  // a retrieved search result (title/URL), an uploaded document, or "user input".
  const docNames = (req.document_texts || []).map((d) => d.filename.toLowerCase());
  const knownUrls = new Set(searchResults.map((r) => r.url.toLowerCase().replace(/\/+$/, "")));
  const knownHosts = new Set(
    searchResults.map((r) => {
      try {
        return new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    }),
  );
  const isRealBasis = (basis: string) => {
    const b = (basis || "").toLowerCase();
    if (b.includes("user input")) return true;
    if (docNames.some((n) => n && b.includes(n))) return true;
    if (knownUrls.has(b.replace(/\/+$/, ""))) return true;
    return [...knownHosts].some((h) => h && b.includes(h));
  };

  const response: BuilderResponse = {
    message: parsed.message || "Let me know if you'd like to adjust anything.",
    options: Array.isArray(parsed.options) ? parsed.options : undefined,
    agent_draft_update: normalizeDraft(parsed.agent_draft_update || undefined),
    thinking: parsed.thinking || undefined,
    sources: sources.length ? sources : undefined,
    search_results: searchResults.length ? searchResults : undefined,
    annotations: Array.isArray(parsed.annotations)
      ? parsed.annotations.filter((a: any) => a?.what && a?.basis && isRealBasis(a.basis)).slice(0, 40)
      : undefined,
  };

  await persistBuilderSessionTurn(req, response);
  return response;
}

/**
 * Extract investment signals from uploaded document text.
 * Returns structured signals the builder can use.
 */
export async function extractDocumentSignals(
  modelId: string,
  keys: LlmKeys,
  documents: { filename: string; text: string }[],
): Promise<{
  style: string;
  philosophy: string;
  horizon: string;
  risk: number;
  qualitative_params: { parameter: string; content: string; weightage: number }[];
  quantitative_rules: { metric: string; metric_name: string; metric_type: string; operator: string; value: number; weightage: number }[];
}> {
  const model = buildModel(modelId, keys);

  const docContent = documents
    .map((d) => `### ${d.filename}\n${d.text.slice(0, 10000)}`)
    .join("\n\n");

  const result = await generateText({
    model,
    prompt: buildDocumentExtractionPrompt(docContent),
    temperature: 0.3,
    maxOutputTokens: 2000,
  });

  const raw = (result.text || "").replace(/```(?:json)?|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      style: "custom",
      philosophy: "",
      horizon: "Long-term (years)",
      risk: 5,
      qualitative_params: [],
      quantitative_rules: [],
    };
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      style: parsed.style || "custom",
      philosophy: parsed.philosophy || "",
      horizon: parsed.horizon || "Long-term (years)",
      risk: Math.min(10, Math.max(1, Number(parsed.risk) || 5)),
      qualitative_params: Array.isArray(parsed.qualitative_params) ? parsed.qualitative_params : [],
      quantitative_rules: normalizeQuantRules(Array.isArray(parsed.quantitative_rules) ? parsed.quantitative_rules : []),
    };
  } catch {
    return {
      style: "custom",
      philosophy: "",
      horizon: "Long-term (years)",
      risk: 5,
      qualitative_params: [],
      quantitative_rules: [],
    };
  }
}
