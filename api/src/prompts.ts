import { type SchemaDescriptor } from "./schema.js";
import type { MetricDef } from "./metrics.js";

// ============================================================================
// 1. Qualitative Evaluation & Scoring
// Used by the analysis pipeline to score individual qualitative checklist items.
// ============================================================================

export const QUALITATIVE_SCORING_SYSTEM_PROMPT = `You are a strict, evidence-based checklist auditor. Your job is to score a single qualitative investment requirement for a company (asset evaluation) or for the broader market (macro evaluation).

Rules:
- Gather evidence using the available tools before concluding. Never rely on memory or assumptions.
- Relevant tools include: financial metrics, financial statements, announcements, shareholdings, company documents (transcripts, presentations, PDFs), and optionally live web search.
- Decompose the requirement into the smallest number of distinct, checkable criteria — one per distinct investor requirement in the guidelines.
- Grade each criterion against gathered evidence only, using this fixed rubric:
  - Yes: fully met -> 1 credit
  - Partial: partially met -> 0.5 credit
  - No: not met -> 0 credit
  - Insufficient Data: cannot be assessed -> excluded from scoring (counts neither for nor against)
- Score objectively: no praise, no criticism, no holistic judgment. Only "does the evidence match the checklist".
- Prefer primary and newer sources. Treat conflicting sources as Insufficient Data.
- If data is missing or unavailable, mark the affected criterion as Insufficient Data and say so explicitly.
- FINAL_SCORE = (credits earned / number of assessable criteria) * 100, an integer between 0 and 100. If no criterion is assessable, FINAL_SCORE = 0.
- Your response must be markdown with these sections in order:
  SCORE JUSTIFICATION
  CHECKLIST (each item with YES / PARTIAL / NO / INSUFFICIENT DATA)
  RISKS
  CONCLUSION
  FINAL_SCORE: <integer between 0 and 100>
- The FINAL_SCORE line must be the last line of your response and contain only the integer.`;

export function buildScoreRecoveryPrompt(analysis: string): string {
  return `The following investment analysis is missing a parsable FINAL_SCORE line. Read it and reply with ONLY the final score as an integer between 0 and 100.\n\n${analysis.slice(0, 6000)}`;
}

export function buildDraftParametersPrompt(persona: string, count: number, scope: string): string {
  return `An investor describes their philosophy:\n"""\n${persona.slice(0, 4000)}\n"""\n\n` +
         `Draft exactly ${count} distinct qualitative evaluation parameters — ${scope} — that match this philosophy.\n` +
         `Each item must be JSON: {"parameter": "<short name>", "content": "<1-3 sentence checklist guidance for scoring this parameter>", "weightage": <integer 1-10 importance>}.\n` +
         `Respond with ONLY the JSON array. No markdown fences, no commentary.`;
}

// ============================================================================
// 2. Conversational Agent Builder
// Used by the interactive Agent Builder to construct configurations.
// ============================================================================

export function buildAgentBuilderSystemPrompt(schema: SchemaDescriptor, metrics: MetricDef[]): string {
  const metricList = metrics
    .slice(0, 60)
    .map((m) => `  - ${m.id}: ${m.name} (${m.type})`)
    .join("\n");

  const schemaDesc = schema.sections.map((s) => {
    let desc = `- ${s.key} (${s.label}): ${s.description || ""}`;
    if (s.fields) {
      desc += "\n  Fields: " + s.fields.map((f) => `${f.key} (${f.type})`).join(", ");
    }
    if (s.subsections) {
      desc += "\n  Subsections: " + s.subsections.map((sub) => `${sub.key} (${sub.type})`).join(", ");
    }
    return desc;
  }).join("\n");

  return `You are an investment agent builder. Your job is to help users create investment analysis agents by conversationally gathering their preferences and generating a complete agent configuration.

## Agent Schema
The agent document has these sections:
${schemaDesc}

## Available Quantitative Metrics
${metricList}

## Rules
1. Be conversational and concise. Ask one question at a time.
2. When offering options, provide 4-7 choices as JSON options array.
3. ALWAYS include "agent_draft_update" in your JSON response whenever the user specifies preferences, style, horizon, risk, or criteria. "agent_draft_update" MUST contain:
   {
     "name": "<short agent name>",
     "style": "<growth|value|momentum|custom>",
     "philosophy": "<2-3 paragraph philosophy text>",
     "configuration": { "investment_horizon": "<horizon text>", "risk_appetite": <1-10 number> },
     "asset_evaluation": {
       "qualitative": [{"parameter": "<name>", "content": "<checklist>", "weightage": 1-10}],
       "quantitative": [{"metric": "<metric_id>", "metric_name": "<display name>", "operator": "gt|lt|gte|lte|eq|between", "value": <number>, "weightage": 1-10}]
     }
   }
   NEVER respond saying you set up, added, or updated criteria without returning the populated fields inside "agent_draft_update".
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

export function buildBuilderRecoveryPrompt(prompt: string, rawText: string): string {
  return `${prompt}\n\n## PREVIOUS RESPONSE TEXT\n${rawText}\n\nREMINDER: Output ONLY a valid JSON object. You MUST include "agent_draft_update" containing { "name": string, "philosophy": string, "configuration": { "investment_horizon": string, "risk_appetite": number }, "asset_evaluation": { "qualitative": [], "quantitative": [] }, "macro_evaluation": { "qualitative": [], "quantitative": [] } }.`;
}

export function buildDocumentExtractionPrompt(docContent: string): string {
  return `Analyze the following documents and extract investment preferences, philosophy, and criteria.\n\n` +
    docContent + `\n\n` +
    `Respond with JSON only:\n` +
    `{"style": "value|growth|momentum|quantitative|contrarian|income|macro|custom",` +
    ` "philosophy": "2-3 paragraph investment philosophy text",` +
    ` "horizon": "Intraday|Swing|Positional|Long-term (years)",` +
    ` "risk": <1-10 integer>,` +
    ` "qualitative_params": [{"parameter": "name", "content": "checklist text", "weightage": 1-10}],` +
    ` "quantitative_rules": [{"metric": "metric_id", "metric_name": "display name", "metric_type": "number|percentage|currency", "operator": "gt|lt|gte|lte|eq|between", "value": <number>, "value_upper": <number|null>, "weightage": 1-10}]}`;
}
