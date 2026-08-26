/**
 * Builder agent — LLM orchestration for conversational agent creation.
 * Stateless: each request includes full context (schema, metrics, documents, history).
 * Session state lives on the client.
 */

import { generateText } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { getSchemaDescriptor, type SchemaDescriptor } from "./schema.js";
import type { MetricDef } from "./metrics.js";

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
8. Your response MUST be valid JSON: {"message": "text", "options": [...optional], "agent_draft_update": {...optional}}
9. Never use markdown fences in your response — just raw JSON.

## Conversation Flow
1. First, understand what the user wants to build (investment style, philosophy).
2. If they selected a preset or uploaded documents, acknowledge and present the draft.
3. If custom, ask about their philosophy, then generate the draft.
4. After presenting a draft, offer to refine specific sections.
5. When the user says it's good, confirm and stop generating options.`;
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

  const result = await generateText({
    model,
    system: buildSystemPrompt(schema, req.metrics),
    prompt,
    temperature: 0.4,
    maxRetries: 0,
  });

  // Parse LLM response
  const raw = (result.text || "").replace(/```(?:json)?|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      message: "I had trouble processing that. Could you try again?",
    };
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      message: parsed.message || "Let me know if you'd like to adjust anything.",
      options: Array.isArray(parsed.options) ? parsed.options : undefined,
      agent_draft_update: parsed.agent_draft_update || undefined,
      thinking: parsed.thinking || undefined,
    };
  } catch {
    return {
      message: "Let me know what you'd like to adjust, or say 'looks good' to save.",
    };
  }
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
      quantitative_rules: Array.isArray(parsed.quantitative_rules) ? parsed.quantitative_rules : [],
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
