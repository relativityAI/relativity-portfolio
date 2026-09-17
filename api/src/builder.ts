/**
 * Builder agent — LLM orchestration for conversational agent creation.
 * Stateless: each request includes full context (schema, metrics, documents, history).
 * Session state lives on the client.
 */

import { generateText } from "ai";
import { z } from "zod";
import { buildModel, type LlmKeys } from "./agent.js";
import { getSchemaDescriptor, type SchemaDescriptor } from "./schema.js";
import type { MetricDef } from "./metrics.js";
import { normalizeQuantRules } from "./metrics.js";
import { buildAgentBuilderSystemPrompt, buildBuilderRecoveryPrompt, buildDocumentExtractionPrompt } from "./prompts.js";
import { buildWebSearchTool, getToolCatalog } from "./tools.js";
import { getDb } from "./db.js";
import { runAgentTurn, type HarnessTraceEvent } from "./harness.js";
import { keyPool } from "./keypool.js";

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
    .describe("PARTIAL PATCH of the agent draft: only the top-level sections that changed. Omit untouched sections. First build includes the complete draft."),
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
  /** Live trace of this turn's model operations (thinking, tool calls). */
  trace?: HarnessTraceEvent[];
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
export async function processBuilderTurn(
  req: BuilderRequest,
  opts: { onTrace?: (ev: HarnessTraceEvent) => void } = {},
): Promise<BuilderResponse> {
  const { onTrace } = opts;
  const schema = getSchemaDescriptor();
  const { apiKey, keyRef } = keyPool.pickKey(req.model_id, req.llm_keys as Record<string, string | undefined>);
  const provider = req.model_id.split("/")[0];
  const model = buildModel(req.model_id, req.llm_keys, apiKey);
  const toolCatalog = getToolCatalog();
  console.log(`[builder] model_id=${req.model_id} keys=${Object.keys(req.llm_keys).join(",")}`);

  // Build conversation context for the LLM
  const conversationHistory = req.messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  // Build document context (extracted text only — never present filenames as readable input)
  let docContext = "";
  if (req.document_texts.length > 0) {
    docContext =
      "\n\n## Uploaded Documents (extracted text only — you cannot read the original PDF/file)\n" +
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

  // Run through the shared harness so the builder streams the same trace
  // events (thinking, tool calls) as the analysis pipeline.
  const trace: HarnessTraceEvent[] = [];
  const onEvent = (ev: HarnessTraceEvent) => {
    trace.push(ev);
    onTrace?.(ev);
  };

  const turn = await runAgentTurn({
    model,
    system: buildAgentBuilderSystemPrompt(schema, req.metrics, toolCatalog),
    prompt,
    temperature: 0.4,
    maxOutputTokens: 4096,
    tools,
    forceTools: !!tools && explicitSearch,
    maxToolSteps: 3,
    onEvent,
  });

  if (turn.retryable) keyPool.markFailure(provider, keyRef);
  keyPool.recordUsage({
    provider,
    keyRef,
    modelId: req.model_id,
    requests: 1,
    tokensIn: turn.usage?.input,
    tokensOut: turn.usage?.output,
  });

  // A forced-tool refusal (model answered with zero tool calls) is best-effort
  // here: answer from context. Provider/network failures propagate to the route.
  if (turn.error && !/without calling any data tools/i.test(turn.error)) {
    throw new Error(turn.userMessage ? `${turn.userMessage} ${turn.error}` : turn.error);
  }
  if (turn.error) {
    console.warn(`[builder] forced tool use not honored: ${turn.error}`);
  }

  const sources = extractWebSources(turn.steps);
  const searchResults = extractSearchResults(turn.steps);
  const rawText = turn.text || "";
  let parsed: any = parseJsonObject(rawText);

  // Only recover when JSON parsing failed outright. A valid response without
  // agent_draft_update means the model decided nothing changed (e.g. a question);
  // forcing or fabricating one marks the draft dirty with junk values.
  if (!parsed) {
    try {
      const retry = await generateText({
        model,
        instructions: buildAgentBuilderSystemPrompt(schema, req.metrics, toolCatalog),
        prompt: buildBuilderRecoveryPrompt(prompt, rawText),
        temperature: 0.3,
      } as any);
      const retryText = getTextFromSteps(retry);
      const retryParsed = parseJsonObject(retryText);
      if (retryParsed) parsed = retryParsed;
    } catch (e: any) {
      console.warn(`[builder] JSON recovery failed: ${e?.message}`);
    }
  }

  if (!parsed) {
    const fallbackRes: BuilderResponse = {
      message: "I had trouble processing that. Could you try again?",
      sources: sources.length ? sources : undefined,
      search_results: searchResults.length ? searchResults : undefined,
      trace: trace.length ? trace : undefined,
    };
    await persistBuilderSessionTurn(req, fallbackRes);
    return fallbackRes;
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

  // Drop junk options (blank labels, duplicate ids) at the trust boundary; only
  // meaningful choices render as option cards.
  const seenOpts = new Set<string>();
  const options = Array.isArray(parsed.options)
    ? parsed.options
        .filter((o: any) => o && typeof o.label === "string" && o.label.trim())
        .map((o: any, i: number) => ({
          id: o && typeof o.id === "string" && o.id.trim() ? o.id.trim() : `opt-${i}`,
          label: o.label.trim(),
          description: o && typeof o.description === "string" && o.description.trim() ? o.description.trim() : undefined,
        }))
        .filter((o: { id: string }) => {
          if (seenOpts.has(o.id)) return false;
          seenOpts.add(o.id);
          return true;
        })
        .slice(0, 7)
    : undefined;

  const response: BuilderResponse = {
    message: parsed.message || "Let me know if you'd like to adjust anything.",
    options: options?.length ? options : undefined,
    agent_draft_update: normalizeDraft(parsed.agent_draft_update || undefined),
    thinking: parsed.thinking || undefined,
    sources: sources.length ? sources : undefined,
    search_results: searchResults.length ? searchResults : undefined,
    annotations: Array.isArray(parsed.annotations)
      ? parsed.annotations.filter((a: any) => a?.what && a?.basis && isRealBasis(a.basis)).slice(0, 40)
      : undefined,
    trace: trace.length ? trace : undefined,
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
  const { apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>);
  const provider = modelId.split("/")[0];
  const model = buildModel(modelId, keys, apiKey);

  const docContent = documents
    .map((d) => `### ${d.filename}\n${d.text.slice(0, 10000)}`)
    .join("\n\n");

  const result = await generateText({
    model,
    prompt: buildDocumentExtractionPrompt(docContent, getToolCatalog()),
    temperature: 0.3,
    maxOutputTokens: 2000,
  });
  keyPool.recordUsage({
    provider,
    keyRef,
    modelId,
    requests: 1,
    tokensIn: result.usage?.inputTokens,
    tokensOut: result.usage?.outputTokens,
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
