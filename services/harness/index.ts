/**
 * Harness public entry — the module's one interface.
 *
 * Everything a consumer needs lives behind this file; nothing under harness/
 * imports anything outside harness/ (plus npm packages and node builtins).
 * Callers own the model, tools, and persistence adapters, so the same path
 * serves the API, the CLI, and tests:
 *
 *   - runAnalysis     the one run seam (engine.ts): dispatches the chosen
 *                        engine — v1 one autonomous tool loop, v2 plan-
 *                        parallel — and owns the shared run options/result
 *   - repositories    agent/skill persistence behind ports (see agents/store,
 *                     skills/catalog); the API installs Supabase adapters
 *   - tools           ToolRegistry, web search, MCP, workspace fs tools
 *   - report          the relativity report contract and its assembly
 *
 * Tests that exercise internals may still import subpaths directly; this
 * barrel is the contract everything else codes against.
 */

// ── Run entry points ────────────────────────────────────────────────────────
export { runAnalysis } from "./engine.js";
export type { Engine, RunStats, RunCanvasOptions, RunCanvasResult, CanvasRunStatus } from "./engine.js";
export {
  runAgentLoop,
  createLoopAgent,
  overBudget,
  clearOldToolResults,
  summarizeOlderMessages,
  KEEP_RECENT_TOOL_RESULTS,
  SUMMARIZE_KEEP_RECENT,
  SUMMARIZE_INPUT_RATIO,
  DEFAULT_CONTEXT_BUDGET,
} from "./loop/agent-loop.js";
export type { LoopResult, LoopConfig, LoopAgentConfig, LoopRunHooks } from "./loop/agent-loop.js";
export { runCanvasAnalysis, ReportCanvas, reportWriteTool, validateComposed, TEXT_TOOLS } from "./canvas/index.js";
export type { CanvasEntry } from "./canvas/index.js";

// ── Budgets, trace, errors, resilience ─────────────────────────────────────
export { DEFAULT_BUDGET, clampBudget } from "./types.js";
export type { Budget, TraceEvent, RunPhase } from "./types.js";
export { friendlyError, providerWaitMs } from "./errors.js";
export { RETRYABLE_ERROR, retryLlmCall, repairNullToolArgs } from "./resilience.js";
export { log } from "./log.js";
export { openCodeBaseURL, openCodeHeaders } from "./opencode.js";

// ── Agent definitions (persistence behind AgentRepository) ─────────────────
export {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  setAgentRepository,
  getAgentRepository,
  createMemoryAgentRepository,
  DEFAULT_HARNESS_AGENT,
  HARNESS_VERSION,
} from "./agents/store.js";
export type { AgentDefinition, AgentInput, AgentRepository } from "./agents/store.js";
export { compileAgent } from "./agents/compile.js";
export type { CompiledAgent, CompileOptions } from "./agents/compile.js";

// ── Skills (built-ins on disk, customs behind SkillRepository) ─────────────
export {
  loadBuiltinSkills,
  getBuiltinSkill,
  listCustomSkills,
  getCustomSkill,
  saveCustomSkill,
  deleteCustomSkill,
  resolveSkill,
  listAllSkillsForUser,
  setSkillRepository,
  getSkillRepository,
  createMemorySkillRepository,
} from "./skills/catalog.js";
export type { SkillRepository, CustomSkillRecord } from "./skills/catalog.js";
export { parseSkillMarkdown, SPEC_NAME_RE } from "./skills/loader.js";
export type { HarnessSkill, SkillIssue, SkillParseResult, SkillSource } from "./skills/loader.js";
export { activateSkill, reportStructureBlock } from "./skills/activate.js";

// ── System prompts (selectable presentation format, resolved from disk) ────
export { loadSystemPrompts, getSystemPrompt, applyVariables } from "./system-prompts/catalog.js";
export type { SystemPrompt } from "./system-prompts/catalog.js";

// ── Tools ──────────────────────────────────────────────────────────────────
export { ToolRegistry } from "./tools/registry.js";
export type { ToolContext, ToolDefinition } from "./tools/registry.js";
export { websearchTools } from "./tools/builtins/websearch.js";
export { webSearch, newsSearch, searxSearch, searxNewsSearch, toToolResult, newsToToolResult, disableSearchPacingForTests, configureSearchForTests, searchPacedForTests } from "./tools/search.js";
export type { WebSearchResult, WebSearchOutcome, NewsSearchResult, NewsSearchOutcome, WebCfg } from "./tools/search.js";
export { wrapUntrusted } from "./tools/untrusted.js";
export { McpClient } from "./tools/mcp-client.js";
export type { McpTool } from "./tools/mcp-client.js";
export { mcpTools } from "./tools/mcp-adapter.js";
export type { McpToolsOptions } from "./tools/mcp-adapter.js";
export { buildToolRegistry, ToolSourcesSchema, McpSourceSchema } from "./tools/sources.js";
export type { ToolSourcesConfig, McpSourceConfig, BuildToolsOptions } from "./tools/sources.js";
export { loadCliConfig } from "./cli/config.js";
export { describeToolCall, kbTaskFromPath } from "./tools/describe.js";

// ── Research workspace (the in-memory knowledge base) ──────────────────────
export { Workspace } from "./workspace/fs.js";
export { workspaceTools } from "./workspace/tools.js";
export { archiveResult } from "./workspace/archive.js";

// ── Report contract (relativity/report.v1) ─────────────────────────────────
export { ReportDocumentSchema, countCharts, sectionHeadings, SCHEMA_VERSION } from "./report/document.js";
export type { ReportDocument, Section, Source, ChartSpec, Highlight, DiagramSpec, Series, SeriesPoint, ArtifactRef } from "./report/document.js";
export { attachChartData, extractJson } from "./report/builder.js";
export { VERDICTS, gradeReport, reportDigest } from "./report/verdict.js";
export type { Verdict } from "./report/verdict.js";
