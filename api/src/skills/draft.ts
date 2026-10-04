/**
 * skills/draft — AI skill authoring (decision D7).
 *
 * The user describes what a skill should do in chat; the model (with optional
 * Tavily web search so it can research a methodology first) drafts the complete
 * skill markdown following the grammar. Every draft is validated with the real
 * parser before it is returned — the chat can only propose skills the app can
 * load. Iterative turns refine the current draft.
 */

import { generateText } from "ai";
import { buildModel, type LlmKeys } from "../agent.js";
import { buildWebSearchTool } from "../tools.js";
import { runAgentTurn } from "../harness.js";
import { classifyModelError } from "../modelcheck.js";
import { keyPool } from "../keypool.js";
import { parseSkillMarkdown } from "./parse.js";
import { getToolCatalog } from "../tools.js";
import { log } from "../logger.js";

export interface SkillDraftMessage {
  role: "assistant" | "user";
  content: string;
}

export interface SkillDraftRequest {
  user_id?: string;
  model_id: string;
  llm_keys: LlmKeys;
  messages: SkillDraftMessage[];
  /** Free-text requirements from the current turn. */
  requirements: string;
  /** The draft being refined, if any. */
  current_draft: string;
  /** Web search on/off for this turn. Default: on when a Tavily key exists. */
  web_search?: boolean;
}

export interface SkillDraftResponse {
  message: string;
  /** Complete validated skill markdown, when the model produced one. */
  skill_markdown?: string;
  /** Parser issues with the draft (warn-level are advisory). */
  issues?: { line: number; message: string; severity: string }[];
  valid: boolean;
  search_results?: { query: string; title: string; url: string }[];
}

const SKILL_AUTHOR_SYSTEM_PROMPT = `You are a skill author for an investor-agent platform. An investor agent is a set of skills; each skill is a markdown document that tells one focused analyst exactly what data to fetch, how to analyze it, what to conclude (verdict anchors), and what to plot.

Your craft, in order:
1. Capture intent before writing. If the user's request is ambiguous on WHAT to analyze, WHICH tools feed it, or what a YES verdict means, ask 2-4 focused questions instead of guessing. If the request is clear enough, draft immediately and note your interpretation in one line.
2. Design the skill around observable evidence. Every Method step must name the data it reads and what the analyst does with it; every anchor must be a claim a tool result can confirm or refute. A step or anchor that no tool can support is a defect — replace it with one the data can carry, or mark it honestly INSUFFICIENT in the Output Template.
3. Explain why, not just what. One clause of reasoning per Method step ("so a one-quarter spike isn't mistaken for a trend") makes the analyst smarter than a wall of rigid rules.

You write ONE skill markdown document per request, following the Agent Skills
specification (https://agentskills.io/specification) and this EXACT grammar:

---
name: kebab-case-name
description: One sentence on what the skill measures. Make it specific enough that a reader scanning the skill library can tell this skill apart from its neighbors.
allowed-tools: tool_one tool_two
metadata:
  title: Human Readable Name
  category: valuation|fundamentals|qualitative|market|macro|custom
  version: "1"
---

## Purpose
2-4 sentences: what this skill investigates and why it matters to an investor.

## Method
1. Ordered analysis steps, each concrete and checkable.

## Verdict Anchors
- Anchor phrased as a checkable claim — weight N     (weight 1-10, default 5)

## Charts
- type: line | title: Chart title | data: series_key   (optional; types: line, bar, candlestick, table)

## Output Template
What the analyst must state first, and what to mark INSUFFICIENT when data is missing.

Web search (when available):
- If the user names an investor, fund, or a named methodology (e.g. "Peter Lynch skill", "QGLP framework"), web_search it FIRST and base Purpose/Method/anchors on what the sources actually describe — not a caricature. In your reply, name in one line what the top source showed and carry its vocabulary into the anchors.
- Never invent a methodology's rules; if search is unavailable or unhelpful, say so and build from the user's description, asking when unclear.

Rules for good skills:
- Anchors must be checkable claims about evidence, not vague qualities ("has a durable moat evidenced by stable margins", not "is a good company").
- allowed-tools lists only tools that actually exist for this platform, space-separated on ONE line: ${"{TOOL_LIST}"}
- The name field is the slug: lowercase letters, digits and single hyphens, 1-64 chars, no leading/trailing/double hyphen. It becomes the skill's directory name, so it must be a valid identifier. Put the human-readable title in metadata.title instead.
- Method steps reference real data the tools return. No step may require data no tool provides.
- 3-6 anchors per skill. Weights reflect relative importance within the skill. Phrase each anchor so YES / PARTIAL / NO / INSUFFICIENT are all reachable outcomes.
- INSUFFICIENT is an honest outcome: the Output Template should say what to do when data is missing rather than guessing.

Charts and tables (the skill's Charts section):
- Declare 1-3 chart specs that directly support the skill's conclusions. Never chart a single scalar; every chart must compare values, show a trend, or split a whole.
- Data keys the pipeline can ground in REAL data (use these exact keys when they fit):
  • price_daily — ~120 downsampled daily candles (date, open, high, low, close, volume) → best as candlestick or line
  • rsi_series — daily RSI(14) (date, rsi) → line
  • volume_series — last quarter of daily volume (date, volume) → bar
  These are auto-assembled in code from real market data; declare them and the plot appears.
- For series the pipeline cannot ground automatically (e.g. revenue_by_quarter, margin_series, peer_comparison, shareholding_split), the analyst's tool results are the source: name the series key to match what a tool returns (e.g. get_income_statements gives quarterly revenue), and the synthesis pass converts grounded tool observations into table/chart blocks. Un-groundable specs are silently dropped — never invented.
- Prefer a precise table over a decorative chart when the reader needs exact figures.
- Respond with conversational text FIRST (what you built and why, questions if requirements are unclear), then the full skill markdown in a fenced \`\`\`markdown code block. If the user is still clarifying requirements and no draft is possible yet, just reply conversationally with 2-4 focused questions.`;

export async function skillDraftTurn(req: SkillDraftRequest): Promise<SkillDraftResponse> {
  const { apiKey, keyRef } = keyPool.pickKey(req.model_id, req.llm_keys as Record<string, string | undefined>);
  const model = buildModel(req.model_id, req.llm_keys, apiKey);
  const provider = req.model_id.split("/")[0];

  const toolList = getToolCatalog().map((t) => t.name).join(", ");
  const system = SKILL_AUTHOR_SYSTEM_PROMPT.replace("{TOOL_LIST}", toolList);

  const conversation = req.messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  const promptParts: string[] = [];
  if (conversation) promptParts.push(`## Conversation so far\n${conversation}`);
  if (req.current_draft) promptParts.push(`## Current draft (refine this; output the FULL updated skill)\n\`\`\`markdown\n${req.current_draft}\n\`\`\``);
  promptParts.push(`## User's latest requirements\n${req.requirements || "(no new input)"}`);
  promptParts.push("\nRespond now.");

  const searchRequested = req.web_search !== false; // default: on
  // Web search is always available (free DuckDuckGo default; Tavily when a
  // key is configured) — skill authoring should ground named methodologies
  // even with zero keys configured.
  const tools = searchRequested ? { web_search: buildWebSearchTool(req.llm_keys.tavily) } : undefined;

  // "Search for X and build a skill" style asks must search, not draft from
  // memory — same trigger vocabulary as the agent builder.
  const explicitSearch = /\b(?:search\w*|research\w*|look\w*\s+up|find\w*\s+out)\b/i.test(req.requirements || "");

  const searchResults: { query: string; title: string; url: string }[] = [];
  const turn = await runAgentTurn({
    model,
    system,
    prompt: promptParts.join("\n\n"),
    temperature: 0.4,
    maxOutputTokens: 4096,
    // Wall-clock budget: without this a hung provider stream leaves the HTTP
    // request dangling until the dev proxy gives up with an opaque 502.
    deadlineMs: 120_000,
    // A named methodology (QGLP, CAN SLIM, PIG…) should be grounded in the
    // investor's real documented method before the skill is authored.
    forceTools: !!tools && explicitSearch,
    tools,
    onEvent: (ev) => {
      if (ev.type === "tool_result") {
        const res = ev.result as any;
        for (const r of res?.results || []) {
          if (r?.url) searchResults.push({ query: ev.tool || "", title: r.title || "", url: r.url });
        }
      }
    },
  });

  keyPool.recordUsage({
    provider,
    keyRef,
    modelId: req.model_id,
    requests: 1,
    tokensIn: turn.usage?.input,
    tokensOut: turn.usage?.output,
  });

  const text = turn.text || "";

  // A provider failure (rate limit, dead key, empty stream) must surface as an
  // error the user can act on — not as a blank "here's your skill" reply.
  if (turn.error && !text.trim()) {
    const failure = classifyModelError(new Error(turn.error));
    throw new Error(failure.message);
  }

  // Extract the first fenced markdown block, if any.
  const fenceMatch = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
  let markdown = fenceMatch?.[1]?.trim() || "";
  let message = text.replace(/```(?:markdown|md)?[\s\S]*?```/g, "").trim();

  if (markdown) {
    // Validate only the official Agent Skills envelope. Keep its name and body
    // untouched so the skill author's instructions remain authoritative.
    const { skill, issues } = parseSkillMarkdown(markdown, "custom");
    const hard = issues.filter((i) => i.severity === "error");
    if (!skill) {
      log.warn("skilldraft", `draft failed validation: ${hard.map((i) => i.message).join("; ")}`);
      return {
        message: message || "The draft failed validation — see issues.",
        skill_markdown: markdown,
        issues,
        valid: false,
        search_results: searchResults.slice(0, 20),
      };
    }
    return {
      message: message || `Drafted skill "${skill.name}".`,
      skill_markdown: markdown,
      issues,
      valid: true,
      search_results: searchResults.slice(0, 20),
    };
  }

  return { message: message || text, valid: false, search_results: searchResults.slice(0, 20) };
}
