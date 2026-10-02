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
import { classifyModelError } from "./modelcheck.js";
import { keyPool } from "./keypool.js";
import { listAllSkillsForUser, loadBuiltinSkills } from "./skills/store.js";
import { log } from "./logger.js";

/**
 * The agent shape is v3: identity + philosophy + horizon/risk + a weighted
 * skill list. The v2 quantitative/qualitative rule blocks are gone — a skill
 * document owns its own method and anchors, so the builder's only job for
 * "criteria" is choosing skills and their weights.
 */
export const agentDraftSchema = z.object({
  name: z.string().optional().describe("Short name for the agent"),
  description: z.string().optional().describe("One line describing who this agent is and how it invests"),
  philosophy: z.string().optional().describe("Comprehensive 2-3 paragraph investment philosophy"),
  configuration: z
    .object({
      investment_horizon: z.string().optional().describe("e.g. Long-term (years)"),
      risk_appetite: z.number().int().min(1).max(10).optional().describe("1 (very conservative) to 10 (very aggressive)"),
    })
    .optional(),
  skills: z
    .array(
      z.object({
        skill_id: z.string().describe("Skill id from the available skill library"),
        weight: z.number().int().min(1).max(10).describe("Relative importance 1-10"),
      })
    )
    .optional()
    .describe("3-6 skills from the library, weighted by how central they are to this investor's method"),
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
  /** Skills the user can pick from (built-ins + their own). Defaults to built-ins. */
  skill_catalog?: { id: string; name: string; description: string; category: string }[];
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

/**
 * Map display-name-only quantitative rules back to catalog metric ids and sync schema fields.
 * `catalog` lets us resolve skill display names ("DCF Valuation") and near-miss
 * spellings to real library ids, so a model that writes prose instead of ids
 * still attaches the right skills instead of having them silently dropped.
 */
function normalizeDraft(
  update: Record<string, unknown> | undefined,
  catalog?: { id: string; name: string }[],
): Record<string, unknown> | undefined {
  if (!update) return update;
  const next: Record<string, unknown> = { ...update };

  // id -> skill, keyed by normalized id AND normalized display name, so both
  // "moat-analysis" and "Moat Analysis" resolve.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byIdOrName = new Map<string, { id: string; name: string }>();
  for (const s of catalog || []) {
    byIdOrName.set(norm(s.id), s);
    byIdOrName.set(norm(s.name), s);
  }
  const resolveSkill = (raw: string): { id: string; name: string } | null => {
    const n = norm(raw);
    if (!n) return null;
    const exact = byIdOrName.get(n);
    if (exact) return exact;
    // Substring fallback: "QGLP growth skill" contains "growthanalysis".
    for (const s of byIdOrName.values()) {
      if (n.includes(norm(s.id)) || n.includes(norm(s.name)) || norm(s.name).includes(n)) return s;
    }
    return null;
  };

  // v3 reads the philosophy from persona.philosophy. The builder used to write
  // persona.philosophy_and_mindset, which v3 ignores — so the philosophy was
  // silently dropped and the agent came out blank.
  const phil = (next.philosophy as string) || (next.persona as any)?.philosophy || (next.persona as any)?.philosophy_and_mindset;
  if (phil) {
    next.philosophy = phil;
    next.persona = {
      ...(typeof next.persona === "object" && next.persona ? (next.persona as any) : {}),
      philosophy: phil,
    };
  }

  // risk_appetite may arrive as "Aggressive (7)".
  if (next.configuration && typeof next.configuration === "object") {
    const cfg = { ...(next.configuration as Record<string, unknown>) };
    if (typeof cfg.risk_appetite === "string") {
      const match = cfg.risk_appetite.match(/\d+/);
      if (match) cfg.risk_appetite = Number(match[0]);
    }
    const risk = Number(cfg.risk_appetite);
    if (Number.isFinite(risk)) cfg.risk_appetite = Math.min(10, Math.max(1, Math.round(risk)));
    next.configuration = cfg;
  }

  // Skills: resolve ids, names, and near-misses to real library skills; clamp
  // weights; drop duplicates. An unknown id would fail to resolve at run time
  // and silently drop the skill.
  if (Array.isArray(next.skills)) {
    const seen = new Set<string>();
    const skills: { skill_id: string; weight: number }[] = [];
    for (const raw of next.skills as any[]) {
      const rawId = typeof raw?.skill_id === "string" ? raw.skill_id.trim() : "";
      if (!rawId) continue;
      const match = resolveSkill(rawId);
      if (!match) {
        log.warn("builder", `dropped unresolvable skill "${rawId}" from draft (no catalog match)`);
        continue;
      }
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      const w = Math.round(Number(raw?.weight));
      skills.push({ skill_id: match.id, weight: Number.isFinite(w) ? Math.min(10, Math.max(1, w)) : 5 });
    }
    if (skills.length) next.skills = skills;
    else delete next.skills;
  }

  // v2 leftovers: the agent form has no such sections, so never pass them on.
  delete next.asset_evaluation;
  delete next.macro_evaluation;
  delete next.style;

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
  const { apiKey, keyRef } = keyPool.pickKey(req.model_id, req.llm_keys as Record<string, string | undefined>);
  const provider = req.model_id.split("/")[0];
  const model = buildModel(req.model_id, req.llm_keys, apiKey);
  const toolCatalog = getToolCatalog();

  // The skill library is the source of truth for what an agent can be built
  // from — resolve it server-side so the model can only pick real skill ids.
  let catalog = req.skill_catalog;
  if (!catalog?.length) {
    try {
      const skills = req.user_id ? await listAllSkillsForUser(req.user_id) : loadBuiltinSkills();
      catalog = skills.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category }));
    } catch (e: any) {
      log.warn("builder", `skill catalog unavailable: ${e?.message}`);
      catalog = [];
    }
  }

  console.log(`[builder] model_id=${req.model_id} keys=${Object.keys(req.llm_keys).join(",")} skills=${catalog.length}`);

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

  // Web search is always on (free DuckDuckGo default; Tavily when configured).
  const tools = { web_search: buildWebSearchTool(req.llm_keys.tavily) };

  // When the user explicitly asks to search the web, force the tool so the
  // model can't shortcut straight to memory.
  const explicitSearch = /\b(?:search\w*|research\w*|look\w*\s+up|find\w*\s+out)\b/i.test(req.user_response || "");

  // Run through the shared harness so the builder streams the same trace
  // events (thinking, tool calls) as the analysis pipeline.
  const trace: HarnessTraceEvent[] = [];
  const onEvent = (ev: HarnessTraceEvent) => {
    trace.push(ev);
    onTrace?.(ev);
  };

  const turn = await runAgentTurn({
    model,
    system: buildAgentBuilderSystemPrompt(toolCatalog, catalog),
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
  // here: answer from context. Provider/network failures propagate to the route
  // classified (auth vs rate limit vs outage) so the UI can say what to do.
  if (turn.error && !/without calling any data tools/i.test(turn.error)) {
    const failure = classifyModelError(new Error(turn.error));
    throw new Error(turn.userMessage ? `${turn.userMessage} ${failure.message}` : failure.message);
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
        instructions: buildAgentBuilderSystemPrompt(toolCatalog, catalog),
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
    agent_draft_update: normalizeDraft(parsed.agent_draft_update || undefined, catalog),
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
    prompt: buildDocumentExtractionPrompt(docContent),
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
