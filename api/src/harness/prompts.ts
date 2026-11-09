/**
 * Prompt assembly — everything we hand the model, in one place.
 *
 * Owns the text-only tool set (what the plot reference may promise), the
 * per-turn date prefix, and the v2 planner/drafter system prompts. v1's
 * system assembly stays in canvas/run — it is interleaved with that run's
 * slots, format gaps, and reminders — but it consumes the helpers here.
 *
 * The contract, plot reference, skill activation, and report structure are
 * NOT redefined here: they live in report/reference.ts and skills/activate.ts
 * and get composed into the prompts below.
 */

import { asSchema } from "ai";
import { activateSkill, reportStructureBlock } from "./skills/activate.js";
import type { HarnessSkill } from "./skills/loader.js";
import type { ToolDefinition } from "./tools/registry.js";
import { plotReferenceMarkdown, sectionContractMarkdown } from "./report/reference.js";
import { SECTION_TOOL } from "./plan/plan.js";

// Data tools that only return text — nothing for the harness to plot.
// ponytail: any other data tool is assumed series-capable (mcp data tools);
// add it here if a text-only data tool ships. get_price_history stays OUT —
// it is the series tool whose absence locks the plot reference.
export const TEXT_TOOLS = new Set(["web_search", "search_news", "web_fetch", "get_quote", "get_fundamentals", "search_symbol", "get_insights"]);

/** True when at least one data tool can return series for the plot reference. */
export function hasSeriesTool(tools: ToolDefinition[]): boolean {
  return tools.some((t) => !TEXT_TOOLS.has(t.name));
}

/**
 * Date lives per-turn (never in the static system prompt — second-precise
 * stamps in the prefix would bust the provider's prompt cache).
 */
export function datedPrompt(text: string): string {
  return `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n${text}`;
}

// JSON schema goes INTO the prompt (asSchema) because the opencode-compatible
// gateway rejects response_format/json_schema — the same pattern verdict.ts uses.
function toolCatalog(tools: ToolDefinition[]): string {
  return tools
    .map((t) => `- ${t.name}: ${t.description}\n  input JSON Schema: ${JSON.stringify(asSchema(t.parameters).jsonSchema)}`)
    .join("\n");
}

/** Step 1 system prompt — plans data fetches AND one draft task per section. */
export function plannerSystemPrompt(tools: ToolDefinition[], skill: HarnessSkill): string {
  return [
    "You are the PLANNING step of a report-generation pipeline. You do NOT execute anything — you emit ONE JSON plan and nothing else.",
    "Reply with exactly one JSON object:",
    '{"version":"1.0.0","planId":"<slug>","target":{"entity":"<TICKER>","domain":"<domain>"},"executionMode":"map_reduce","tasks":[{"id":"<slug>","name":"<2-6 words>","description":"<what and why>","tool":"<name>","input":{...},"dependsOn":[],"status":"pending","outputRef":null,"error":null}]}',
    "Rules:",
    `- data tasks: \`tool\` from the catalog below; \`input\` must match its JSON Schema exactly (every argument pre-decided — no placeholders)`,
    `- section tasks: \`tool\` "${SECTION_TOOL}", \`input\`: {"sectionId":"<slug>","title":"<heading>"}, \`dependsOn\` the data tasks whose evidence it needs`,
    "- one section task per section of the report structure below, in reading order",
    "- max 16 tasks total; dependencies must reference existing ids and never form a cycle",
    "- statuses start \"pending\", outputRef/error are null — the harness fills them",
    "Tools (data tasks):",
    toolCatalog(tools),
    "",
    "# Skill instructions (body only — references are drafting material, not planning)",
    `# Skill: ${skill.name} (${skill.id})\n\n${skill.body}`,
    "",
    reportStructureBlock([skill]),
  ]
    .filter((p) => p)
    .join("\n\n");
}

/** Step 3 system prompt — one section per call, score included. */
export function draftSystemPrompt(skill: HarnessSkill, hasSeries: boolean): string {
  return [
    "You draft ONE section of an investment report. All collected evidence is pre-loaded in the prompt — you should NOT need to read files at all; the fs tools exist only for a genuinely missing detail (never fs_write/fs_append, and there is NO web search; never ask for one).",
    "Your FINAL message must be the JSON object itself, nothing else — a reply that is prose, notes, or a file pointer is a failed draft.",
    "Follow the skill instructions and the report structure below. Every number gets a source highlight; cite evidence as [src:<id>].",
    "Reply with ONLY one JSON object and nothing else:",
    '{"sections":[<section per the contract>],"sources":[{"id":"s1","label":"...","tool":"...","value":"..."}],"score":<integer 1-10>}',
    "`score` = this section's quality out of 10 (completeness, evidence behind claims, figures carrying measure+source, number discipline). Be harsh: 5 = thin, 8 = solid, 10 = nothing to improve.",
    "",
    "# Report section contract",
    sectionContractMarkdown(),
    "",
    "# Plots — chart kinds and the data tokens the harness expands at assembly (never invent token names)",
    plotReferenceMarkdown(hasSeries),
    "",
    "# Skill instructions",
    activateSkill(skill),
    "",
    reportStructureBlock([skill]),
  ]
    .filter((p) => p)
    .join("\n\n");
}
