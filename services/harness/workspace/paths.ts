/**
 * Workspace paths — ONE source of truth for the in-memory filesystem layout:
 *
 *   /AGENTS.md               root: the agent's instructions (the one prompt doc)
 *   /workspace/              plan (todo_write), notes, the report
 *   /knowledge_base/         all data: sources/ (+ raw payloads) and tool-output/
 *
 * Every module imports from here instead of hardcoding literals — the layout
 * moved once (/control, /memory, /report, /sources) and that churn is why
 * this file exists.
 */

export const PATHS = {
  agents: "/AGENTS.md",
  soul: "/SOUL.md",
  workspace: "/workspace",
  planJson: "/workspace/plan.json",
  planMd: "/workspace/plan.md",
  reportSections: "/workspace/report/sections",
  kb: "/knowledge_base",
  sources: "/knowledge_base/sources",
  raw: "/knowledge_base/sources/raw",
  toolOutput: "/knowledge_base/tool-output",
} as const;
