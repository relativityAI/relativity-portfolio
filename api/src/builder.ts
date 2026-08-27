/**
 * Builder agent — LLM orchestration for conversational agent creation.
 * Stateless: each request includes full context (schema, metrics, documents, history).
 * Session state lives on the client.
 */

import { generateText } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { getSchemaDescriptor, type SchemaDescriptor } from "./schema.js";
import type { MetricDef } from "./metrics.js";
import { normalizeQuantRules } from "./metrics.js";
import { buildWebSearchTool } from "./tools.js";

export interface BuilderMessage {
  role: "assistant" | "user";
  content: string;
  options?: { id: string; label: string; description?: string }[];
}

export interface BuilderRequest {
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

function buildSystemPrompt(schema: SchemaDescriptor, metrics: MetricDef[]): string {
  const metricList = metrics
    .slice(0, 60)
    .map((m) => `  - ${m.id}: ${m.name} (${m.type})`)
    .join("\n");

  return `You are an investment agent builder. Your job is to help users create investment analysis agents by conversationally gathering their preferences and generating a complete agent configuration.

## Agent Schema
The agent document has these sections:
${schema.sections.map((s) => {
  let desc = `- ${s.key} (${s.label}): ${s.description || ""}`;
  if (s.fields) {
    desc += "\n  Fields: " + s.fields.map((f) => `${f.key} (${f.type})`).join(", ");
  }
  if (s.subsections) {
    desc += "\n  Subsections: " + s.subsections.map((sub) => `${sub.key} (${sub.type})`).join(", ");
  }
  return desc;
}).join("\n")}

## Available Quantitative Metrics
${metricList}

## Rules
1. Be conversational and concise. Ask one question at a time.
2. When offering options, provide 4-7 choices as JSON options array.
3. When the user provides enough information, generate the full agent draft.
4. For qualitative parameters: include a "parameter" (short name), "content" (1-3 sentence scoring checklist), and "weightage" (1-10).
5. For quantitative criteria: use metric IDs from the available list. Include "metric", "metric_name", "metric_type", "operator" (gt/gte/lt/lte/eq/between), "value", "value_upper" (required when operator is "between"), and "weightage" (1-10). Prefer simple operators (gt, lt, gte, lte) over "between" unless a range is clearly needed.
6. Always generate a reasonable philosophy even if the user provides minimal input.
7. When documents are provided, extract investment style, criteria, and preferences from them.
8. You have a web_search tool. Call it when the user asks you to search the web or says anything like "search online", "look it up", "research X", or "find out about X". Base your draft ONLY on the search results plus the user's own input — not on general knowledge. In your "message", say in one line what the top sources showed (e.g. "The sources emphasize CAN SLIM's C: current quarterly earnings up 20%+"). Only claim facts the sources actually state.
9. Cite EVERY decision. Your response MUST be valid JSON: {"message": "text", "options": [...optional], "agent_draft_update": {...optional}, "annotations": [{"what": "<the agent setting you chose>", "basis": "<the EXACT source it came from>"}]}. The basis must name the actual source — never a principle, paraphrase, or "known practice": use the exact article title + URL from the web search results you actually retrieved, or "File: <uploaded filename>" for uploaded documents, or "user input" when it came from the conversation. Add one annotation for every meaningful value in agent_draft_update (philosophy themes, each quantitative rule, each qualitative parameter, horizon, risk appetite). Never invent a URL, fact, or source.
10. Never use markdown fences in your response — just raw JSON.

## Conversation Flow
1. First, understand what the user wants to build (investment style, philosophy).
2. If they selected a preset or uploaded documents, acknowledge and present the draft.
3. If custom, ask about their philosophy, then generate the draft.
4. After presenting a draft, offer to refine specific sections.
5. When the user says it's good, confirm and stop generating options.`;
}

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

// Map display-name-only quantitative rules back to catalog metric ids.
function normalizeDraft(update: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!update) return update;
  const next: Record<string, unknown> = { ...update };
  for (const key of ["asset_evaluation", "macro_evaluation"]) {
    const sec = next[key];
    if (sec && typeof sec === "object" && !Array.isArray(sec)) {
      const s = sec as Record<string, unknown>;
      if (Array.isArray(s.quantitative)) s.quantitative = normalizeQuantRules(s.quantitative);
    }
  }
  return next;
}

// Pull and parse the first balanced {...} JSON object out of arbitrary model text.
export function parseJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
          return JSON.parse(text.slice(start, i + 1));
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
  const session = { model, system: buildSystemPrompt(schema, req.metrics), prompt, temperature: 0.4, maxRetries: 0 };
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
      result = await generateText({ ...session, ...attempt });
      break;
    } catch (e: any) {
      console.warn(`[builder] attempt ${JSON.stringify(attempt)} failed: ${e?.message}`);
    }
  }
  if (!result) throw new Error("All model attempts failed");

  const sources = extractWebSources(result.steps);
  const searchResults = extractSearchResults(result.steps);
  let parsed = parseJsonObject(result.text || "");

  // One focused recovery call (no tools, hard JSON-only instruction) before giving up.
  if (!parsed) {
    try {
      const retry = await generateText({
        ...session,
        prompt: `${prompt}\n\nREMINDER: your entire reply must be ONE valid JSON object: {"message": string, "options"?: string[], "agent_draft_update"?: object}. No prose, no markdown, no backticks.`,
      });
      parsed = parseJsonObject(retry.text || "");
    } catch (e: any) {
      console.warn(`[builder] JSON recovery failed: ${e?.message}`);
    }
  }

  if (!parsed) {
    return {
      message: "I had trouble processing that. Could you try again?",
      sources: sources.length ? sources : undefined,
      search_results: searchResults.length ? searchResults : undefined,
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

  return {
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
    prompt:
      `Analyze the following documents and extract investment preferences, philosophy, and criteria.\n\n` +
      docContent + `\n\n` +
      `Respond with JSON only:\n` +
      `{"style": "value|growth|momentum|quantitative|contrarian|income|macro|custom",` +
      ` "philosophy": "2-3 paragraph investment philosophy text",` +
      ` "horizon": "Intraday|Swing|Positional|Long-term (years)",` +
      ` "risk": <1-10 integer>,` +
      ` "qualitative_params": [{"parameter": "name", "content": "checklist text", "weightage": 1-10}],` +
       ` "quantitative_rules": [{"metric": "metric_id", "metric_name": "display name", "metric_type": "number|percentage|currency", "operator": "gt|lt|gte|lte|eq|between", "value": <number>, "value_upper": <number|null>, "weightage": 1-10}]}`,
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
