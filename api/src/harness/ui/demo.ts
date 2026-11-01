/**
 * UI demo — plays a fake run through the real renderer so the layout can be
 * eyeballed (and diffed against the old UI) without a model or API keys.
 *
 *   npm run ui:demo                  # live TTY layout at the current width
 *   COLUMNS=60 npm run ui:demo       # narrow
 *   npm run ui:demo -- --plain       # piped/CI fallback
 *   npm run ui:demo -- --verbose     # raw-data mode
 *
 * Piping the demo (| cat) auto-falls back to plain mode, like the real CLI.
 */

import { createRenderer } from "./renderer.js";
import type { TraceEvent } from "../types.js";

const plain = process.argv.includes("--plain");
const verbose = process.argv.includes("--verbose");
const width = Number(process.env.COLUMNS) || 0;

// Deterministic width without touching the real terminal size.
if (width && width !== process.stdout.columns) {
  Object.defineProperty(process.stdout, "columns", { value: width, configurable: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const renderer = createRenderer({ plain, verbose, stdin: undefined });
const emit = (e: TraceEvent) => renderer.event(e);

renderer.header({
  name: "AAPL",
  source: "SEC",
  model: "deepseek-v4.1-flash",
  skills: ["dcf-valuation"],
  maxSteps: 20,
  maxTokens: 30_000,
  configLine: "config: harness.config.json · web: searxng · compaction: clear + summarize",
});

emit({ type: "phase", phase: "run", label: "Agent", detail: "One autonomous loop: gather evidence, write the report" });
await sleep(150);

// ── Step 1 ──
emit({ type: "tool_call", tool: "web_search", toolCallId: "t1", args: { query: "AAPL Q4 FY2026 results" } });
await sleep(400);
emit({
  type: "tool_result",
  tool: "web_search",
  toolCallId: "t1",
  status: "ok",
  durationMs: 822,
  result: { count: 5, results: [{ title: "Apple Q4 2026" }] },
});
emit({ type: "tool_call", tool: "fs_ls", toolCallId: "t2", args: { path: "/knowledge_base/sources" } });
await sleep(120);
emit({ type: "tool_result", tool: "fs_ls", toolCallId: "t2", status: "ok", durationMs: 3, result: { path: "/knowledge_base/sources", entries: ["AAPL_statistics.json"] } });
emit({ type: "kb", files: 1, bytes: 8_900 });
renderer.progress({ step: 1, outputTokens: 1_800 });
await sleep(150);

// ── Step 2 — parallel calls + thinking ──
emit({ type: "thought", text: "Need FY21–22 FCF and market cap for the multiples cross-check." });
await sleep(150);
emit({ type: "tool_call", tool: "web_search", toolCallId: "t3", args: { query: "AAPL statistics market cap PE ratio" } });
emit({ type: "tool_call", tool: "web_search", toolCallId: "t4", args: { query: "Microsoft Alphabet Meta forward PE" } });
await sleep(500);
emit({
  type: "tool_result",
  tool: "web_search",
  toolCallId: "t3",
  status: "ok",
  durationMs: 714,
  result: { count: 5, results: [1, 2, 3, 4, 5] },
});
emit({
  type: "tool_result",
  tool: "web_search",
  toolCallId: "t4",
  status: "ok",
  durationMs: 822,
  result: { count: 5, results: [1, 2, 3, 4, 5] },
});
emit({ type: "tool_call", tool: "fs_read", toolCallId: "t5", args: { path: "/knowledge_base/sources/AAPL_capex_fiscal_2025.json" } });
await sleep(120);
emit({
  type: "tool_result",
  tool: "fs_read",
  toolCallId: "t5",
  status: "ok",
  durationMs: 5,
  result: { path: "/knowledge_base/sources/AAPL_capex_fiscal_2025.json", content: "x".repeat(2_765), total: 2_765, nextOffset: null },
});
emit({ type: "kb", files: 29, bytes: 92_037 });
emit({ type: "log", text: "compaction: clearing active — 3 old tool result(s) replaced with workspace pointers (kept last 3)" });
renderer.progress({ step: 2, outputTokens: 6_400 });
await sleep(150);

// ── Step 3 — one failure, then the write ──
emit({ type: "tool_call", tool: "fs_read", toolCallId: "t6", args: { path: "/knowledge_base/sources/missing.json" } });
await sleep(120);
emit({
  type: "tool_result",
  tool: "fs_read",
  toolCallId: "t6",
  status: "error",
  durationMs: 2,
  result: { error: "no such file: /knowledge_base/sources/missing.json" },
  summary: "no such file: /knowledge_base/sources/missing.json",
});
emit({ type: "tool_call", tool: "report_write", toolCallId: "t7", args: { title: "DCF & comps", sections: [{}, {}, {}], sources: [] } });
await sleep(450);
emit({
  type: "tool_result",
  tool: "report_write",
  toolCallId: "t7",
  status: "ok",
  durationMs: 4_100,
  result: { added: 3, rejected: [], sourceIds: ["s1"], totalSections: 3 },
});
renderer.progress({ step: 3, outputTokens: 9_200 });
await sleep(200);

renderer.summary({
  status: "completed",
  elapsedMs: 134_200,
  steps: 9,
  maxSteps: 20,
  outputTokens: 21_300,
  maxTokens: 30_000,
  inputTokens: 17_900,
  toolCalls: 14,
  toolErrors: 1,
  kbFiles: 29,
  kbBytes: 92_037,
  sections: 9,
  sources: 29,
  outputPath: "./runs/2026-10-31T12-00-00-000Z-AAPL/2026-10-31T12-00-00-000Z-AAPL.md",
  errors: [],
});
renderer.dispose();
