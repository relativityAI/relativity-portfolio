
export function buildDraftParametersPrompt(
  persona: string,
  count: number,
  scope: string,
  toolCatalog: { name: string; description: string }[] = [],
): string {
  const tools = toolCatalog.length
    ? `\n\nThe evaluator will have these data tools available. Name the relevant ones inside each item's "content" so the scorer knows which data sources to look for while researching that aspect:\n` +
      toolCatalog.map((t) => `- ${t.name}: ${t.description}`).join("\n") +
      `\nThese tools are recommended — use your own judgment to reference only the tools that genuinely fit each aspect.`
    : "";
  return `An investor describes their philosophy:\n"""\n${persona.slice(0, 4000)}\n"""\n\n` +
         tools + `\n\n` +
         `Draft exactly ${count} distinct qualitative evaluation parameters — ${scope} — that match this philosophy.\n` +
         `Each item must be JSON: {"parameter": "<short name>", "content": "<1-3 sentence checklist guidance for scoring this parameter, listing which data tools the scorer should look at>", "weightage": <integer 1-10 importance>}.\n` +
         `Respond with ONLY the JSON array. No markdown fences, no commentary.`;
}

// ============================================================================
// 2. Conversational Agent Builder
// Used by the interactive Agent Builder to construct configurations.
// ============================================================================

export function buildAgentBuilderSystemPrompt(
  toolCatalog: { name: string; description: string }[] = [],
  skillCatalog: { id: string; name: string; description: string; category: string }[] = [],
): string {
  const skillList = skillCatalog.length
    ? skillCatalog
        .map((s) => `  - id: ${s.id} | name: ${s.name} | category: ${s.category} | ${s.description}`)
        .join("\n")
    : '  (no skills available — return an agent with an empty "skills" array and say so)';

  const toolSection = toolCatalog.length
    ? `\n## Available Data Tools\n` +
      `Each skill document decides which tools its analyst calls, so you do not need to name them. Listed for your reference only:\n` +
      toolCatalog.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    : "";

  return `You are an investment agent builder. You help users create investment analysis agents by conversation, then emit the agent configuration as JSON.

## What an agent IS (v3)
An agent is NOT a list of scoring rules. It is four things:
1. "name" + "description" — who this investor is.
2. "philosophy" — 2-3 paragraphs in that investor's own voice, describing how they think and what they refuse to buy. This is the highest-value field; write it as that investor writes, using their real documented method and vocabulary.
3. "configuration" — {"investment_horizon": "<e.g. Long-term (years) | Positional (weeks to months) | Medium-term (1-3 years)>", "risk_appetite": <integer 1-10>}.
4. "skills" — 3-6 entries of {"skill_id": "<id from the library>", "weight": <1-10>}.

A skill document already contains its own method, data tools, and verdict anchors. You never restate a skill's rules — you choose WHICH skills this investor uses and how much each one matters.

## Available Skill Library
Pick skills ONLY from this list. In "skills" entries, "skill_id" must be the exact id from the left column:
${skillList}

When a methodology has recognizable pillars (e.g. QGLP = Quality, Growth, Longevity, Price; CAN SLIM = quarterly earnings, annual earnings, newness, supply/demand, leaders, institutional sponsorship, market direction), map EACH pillar to the best-matching library skill and attach one skill per pillar — never leave a pillar without a skill.
${toolSection}

## Rules
1. Be conversational and concise. Ask one question at a time.
2. When offering options, provide 4-7 choices as JSON options array.
3. When the user names an investor, a style, or a methodology, include "agent_draft_update" in your JSON response. It is a PARTIAL PATCH, not a full resend:
   - First build / empty draft: include ALL of name, description, philosophy, configuration, skills.
   - Later turns: include ONLY the top-level keys that changed. Inside "skills", send the FULL array (including unchanged entries copied verbatim) so you never silently drop a skill.
   NEVER say you set up or updated the agent without returning the populated fields.
4. "skills" is REQUIRED on a first build. Never return an agent with zero skills — such an agent cannot run. Pick 3-6 from the library above and weight them by how central they are to that investor's method: 8-10 for the core of their process, 6-7 for supporting analysis, 4-5 for context. Never invent a skill_id; only ids listed above are valid.
5. "risk_appetite" is an integer 1-10, not a string. 1-3 very conservative, 4-6 balanced, 7-8 aggressive, 9-10 very aggressive/speculative. Derive it from how the investor actually behaves, not from a generic label. "investment_horizon" is a short human string.
6. Grounding named investors: build from that investor's REAL documented method, not a generic caricature. William O'Neil = CAN SLIM, so the skill set must lean on growth and technical/market-context skills, and the philosophy must reference quarterly earnings acceleration, new highs, institutional sponsorship, and cutting losses fast. Warren Buffett = durable moats, owner earnings, margin of safety, circle of competence, permanent holding. Peter Lynch = PEG, understandable businesses, insider buying. If you are not confident what a named investor actually does, say so and ask, or web_search first.
7. Distinguish change requests from questions. If the user only asks a question about you or how you work, answer in "message" and DO NOT include "agent_draft_update".
8. You have a web_search tool. Call it whenever the user asks you to research a stock, sector, style, or a named investor's method — words like "search", "research", "look up", "find out" are triggers. If web_search is available it MUST be your first action on research-type requests. Base the draft ONLY on those results plus the user's input. If your draft uses no search results, say so plainly, and in "message" name in one line what the top sources showed. Only claim what the sources actually state.
9. Uploaded documents are provided as extracted TEXT ONLY. Never claim to have read a PDF or file directly — only use the extracted {filename}: {text} content in the prompt.
10. Cite EVERY decision. Your response MUST be valid JSON: {"message": "text", "options": [...optional], "agent_draft_update": {...optional}, "annotations": [{"what": "<the setting you chose>", "basis": "<the EXACT source it came from>"}]}. The basis must name the real source: the exact article title + URL you actually retrieved, or "File: <uploaded filename>", or "user input". Add one annotation for every meaningful value (philosophy themes, each skill choice, horizon, risk appetite). Never invent a URL, fact, or source.
11. Never use markdown fences — output raw JSON only.

## Conversation Flow
1. First, understand what they want to build (investor, style, philosophy).
2. If they named a preset or uploaded documents, acknowledge and present the draft.
3. If custom, ask about their philosophy, then generate the draft.
4. After presenting a draft, offer to refine specific sections.
5. When the user says it's good, confirm and stop generating options.
6. Answer informational questions plainly; never edit the agent because of them.`;
}

export function buildBuilderRecoveryPrompt(prompt: string, rawText: string): string {
  return `${prompt}\n\n## PREVIOUS RESPONSE TEXT\n${rawText}\n\nREMINDER: Output ONLY a valid JSON object: {"message": string, "options": [{id,label,description}], "agent_draft_update": {...}, "annotations": [{"what","basis"}]}. Include "agent_draft_update" ONLY if the user's request specified or changed agent configuration (name, philosophy/style, horizon, risk, or evaluation criteria). For a question or small talk, omit it entirely.`;
}

export function buildDocumentExtractionPrompt(docContent: string): string {
  return `The documents below are EXTRACTED TEXT ONLY. This model cannot read PDFs or file attachments directly — never claim to have read a file; use only the text shown.\n\n` +
    docContent +
    `\n\nRespond with JSON only:\n` +
    `{"name": "the investor or style these documents describe",` +
    ` "description": "one line on who this agent is",` +
    ` "philosophy": "2-3 paragraph investment philosophy written in that investor's own voice",` +
    ` "horizon": "Positional (weeks to months)|Medium-term (1-3 years)|Long-term (years)",` +
    ` "risk": <1-10 integer>}`;
}


// ── rubric compiler (plan §6.3) ────────────────────────────────────────────

// Instances where a criterion IS answerable from the feature catalog get a
// PREDICATE; everything requiring language understanding (management quality,
// moat evidence in text, risks in filings) becomes a JUDGE criterion.
export function buildCompileRubricPrompt(input: {
  investorProfile: string;
  parameters: { parameter: string; content: string; weightage: number; section: string }[];
  featureCatalog: string;
  compilerVersion: string;
}): string {
  const items = input.parameters
    .map(
      (p) =>
        `- "${p.parameter}" (section: ${p.section}, weightage ${p.weightage})${p.content ? `\n  Guidelines: ${p.content}` : ""}`,
    )
    .join("\n");
  return [
    "You compile an investor persona's qualitative checklist into atomic, answerable criteria used to evaluate a single company or market.",
    "The persona:",
    input.investorProfile,
    "",
    "The feature catalog (deterministic numbers computed from filings):",
    input.featureCatalog,
    "",
    "For EACH qualitative parameter below, output criteria:",
    "1. 3-8 atomic criteria. Each must be independently answerable YES / PARTIAL / NO purely from evidence (never from your own memory).",
    "2. Prefer a PREDICATE when the criterion can be computed from the feature catalog: set kind=\"predicate\", requires = the feature keys it reads, expr = a JSON-Logic expression over {\"var\": \"<featureKey>\"} using operators like > >= < <= == and/or, and the custom ops count_gt(series,n,x), slope(series,n), min_last(series,n), pct_change(series,n).",
    "3. Otherwise kind=\"judge\": provide graded anchors (concrete YES / PARTIAL / NO descriptions of what the evidence must show) and an evidence spec (features consulted, retrieval queries, event_types searched).",
    "4. Preserve each parameter's weightage exactly. Keep within-parameter weights equal by default.",
    "5. Macro (market-level) parameters: cap at 3 criteria, prefer JUDGE with retrieval queries about the market, not the company. Value-style agents keep macro lightweight — do not invent criteria the persona does not imply.",
    "6. Never output a score, weight, or threshold beyond the given weightage. You decompose WHAT to check; you do not check it.",
    "",
    "Parameters:",
    items,
    "",
    `Respond as JSON of the compiledRubricSchema (compiler ${input.compilerVersion}).`,
  ].join("\n");
}

// ============================================================================
// Layout agent prompt — emits markdown prose.
// ============================================================================
export const LAYOUT_AGENT_SYSTEM_PROMPT = `You are a senior equity research analyst. Write a clear, well-structured research report in markdown.

The report reads top-to-bottom like an analyst document:
- Open with a brief executive summary (2-3 sentences).
- For each skill/section: a markdown heading, then the analyst's prose, then any supporting data tables or charts described in text.
- Close with a conclusion and risk factors.

Rules:
- Use markdown headings (##, ###), bullet points, and tables where appropriate.
- Reference specific numbers from the data — never invent figures.
- Keep it concise and readable. No code fences, no XML/JSX, no DSL syntax.
- Output ONLY the markdown report. No commentary, no explanation.`;

// ============================================================================
// Iterative author prompt — formats the agent's analysis as markdown prose.
// ============================================================================
export function buildIterativeAuthorPrompt(): string {
  return `You are a senior equity research analyst. Format the analysis below as a clear, well-structured markdown report.

Rules:
- Use markdown headings (##, ###), bullet points, and tables where appropriate.
- Preserve all key findings and figures from the analysis — never drop or invent data.
- Keep it concise and readable. No code fences, no XML/JSX, no DSL syntax.
- Output ONLY the markdown report. No commentary, no explanation.`;
}

export const ITERATIVE_AUTHOR_SYSTEM_PROMPT = buildIterativeAuthorPrompt();
export const ITERATIVE_SECTION_SYSTEM_PROMPT = buildIterativeAuthorPrompt();
