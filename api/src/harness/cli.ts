/**
 * Harness CLI — the pretty way to run the harness standalone.
 *
 *   npx tsx src/harness/cli.ts --help
 *   npx tsx src/harness/cli.ts --real --symbol AAPL [--skills a,b] [--model id] \
 *       [--source SEC] [--soul text] [--mcp url] [--mcp-allow a,b] \
 *       [--max-steps n] [--max-tokens n] [--verbose] [--plain] [--quiet] \
 *       [--json] [--out file]
 *
 * --real    a REAL canvas run: one ToolLoopAgent core loop (research +
 *           write, ReAct over native tool calls) then assemble
 *           from env keys, Voyager MCP data tools, web search, all builtin
 *           skills. The final report is dumped as plain markdown (no ANSI
 *           fitting).
 *
 * The CLI is the harness's composition root: it wires env keys → model,
 * MCP_VOYAGER_URL → data tools; web search is free local SearXNG (keyless).
 * api/ package root (builtin skills resolve from config/skills).
 *
 * Config precedence (per option): flag > HARNESS_* env > harness.config.json
 * > built-in default. Prompts live in src/harness/config/prompts/ (AGENTS,
 * COMPACTION…) — mapped by config/agent.yaml; report structure comes
 * from the selected skills.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  runCanvasAnalysis,
  clampBudget,
  loadBuiltinSkills,
  buildToolRegistry,
} from "./index.js";
import { promptNames } from "./config.js";
import { buildModelFromEnv } from "./cli/model.js";
import { loadCliConfig, resolveRunConfig, CONFIG_FILENAME, type LoadedCliConfig } from "./cli/config.js";
import { dumpMarkdown } from "./cli/dump.js";
import { createRenderer, errorBox, reportBox, renderMarkdown, dimLine, accent, bold, kbTree } from "./ui/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function numArg(name: string): number | undefined {
  const raw = arg(name);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function die(msg: string, code = 2): never {
  console.error(errorBox(msg.split("\n")[0], msg.split("\n").slice(1)));
  process.exit(code);
}

// ── real mode (real model + MCP + skills, canvas pipeline) ──────────────────

interface RealFlags {
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  outFile?: string;
  plain: boolean;
  saveWorkspace: boolean;
}

async function runReal(flags: RealFlags): Promise<void> {
  const { verbose, quiet, json, outFile, plain } = flags;
  await import("dotenv/config");

  let loaded: LoadedCliConfig;
  try {
    loaded = loadCliConfig();
  } catch (e: any) {
    die(e?.message || String(e));
  }
  const cfg = resolveRunConfig(
    {
      model: arg("--model"),
      skills: arg("--skills"),
      source: arg("--source"),
      soul: arg("--soul"),
      mcpAllow: arg("--mcp-allow"),
      maxSteps: numArg("--max-steps"),
      maxTokens: numArg("--max-tokens"),
    },
    process.env,
    loaded.config,
  );

  const symbol = arg("--symbol");
  if (!symbol) die("--real requires --symbol <TICKER>");
  // Named system prompt (agent.yaml prompts.<name>) — a typo must not silently
  // run the default prompt.
  const systemPrompt = arg("--system-prompt");
  if (systemPrompt && !promptNames().includes(systemPrompt)) {
    die(`unknown system prompt "${systemPrompt}" — configured in agent.yaml prompts: ${promptNames().join(", ")}`);
  }
  const source = cfg.source;
  const modelId = cfg.model;
  const soul = cfg.soul;
  // All builtin skills by default; --skills/config narrows the set.
  const allSkills = loadBuiltinSkills();
  if (!allSkills.length) die("no builtin skills found (run from the api/ package root)");
  const skills = cfg.skills.length ? allSkills.filter((s) => cfg.skills.includes(s.id)) : allSkills;
  if (!skills.length) die(`no skills matched: ${cfg.skills.join(", ")}`);

  // Output format is skill-determined (each skill's SKILL.md + references/);
  // the chosen system prompt (config/prompts/*.md) supplies identity + its
  // frontmatter rules. The CLI reads no format record — getSystemPrompt is
  // the API server's path; --system-prompt picks the doc by name.
  const template = null;

  const model = buildModelFromEnv(modelId);

  // Cheap compaction model: summarize trips past 90% of the context budget.
  const summarizerId = arg("--summarizer") ?? (process.env.HARNESS_SUMMARIZER_MODEL?.trim() || undefined);
  let summarizerModel;
  if (summarizerId) {
    try {
      summarizerModel = buildModelFromEnv(summarizerId);
    } catch (e: any) {
      console.error(dimLine(`summarizer unavailable (${e?.message || e}) — compaction will only clear`));
    }
  }
  const contextBudget = numArg("--context-tokens");

  let built;
  try {
    built = await buildToolRegistry(loaded.config.tools ?? {}, process.env, {
      mcpUrlOverride: arg("--mcp"),
      mcpAllow: cfg.mcpAllow,
    });
  } catch (e: any) {
    die(e?.message || String(e), 1);
  }
  const { registry } = built;

  const allowedTools = [...new Set(skills.flatMap((s) => s.allowedTools))];
  const budget = clampBudget(cfg.budget);
  const websearch = "searxng";
  const resolvedSkills = skills.map((s) => s.id).join(", ");

  // Presentation only — the run itself is wired identically in every mode.
  const renderer = createRenderer({ plain, verbose });
  if (!quiet) {
    renderer.header({
      name: symbol,
      source,
      model: modelId.split("/").pop() ?? modelId,
      skills: skills.map((s) => s.id),
      maxSteps: budget.maxSteps,
      maxTokens: budget.maxTokens,
      configLine: [
        `config: ${loaded.file ? CONFIG_FILENAME : "defaults"}`,
        `web: ${websearch}`,
        built.mcp.length ? `mcp: ${built.mcp.map((m) => m.name).join(", ")}` : null,
        "compaction: clear + summarize",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    // --verbose restores the full config detail the old banner showed.
    if (verbose) {
      const soulLine = soul.length > 72 ? `${soul.slice(0, 72)}…` : soul;
      const details = [
        `run      ${symbol} (${source})`,
        `model    ${modelId}`,
        `skills   ${resolvedSkills}${cfg.skills.length ? "" : " (all builtins)"} — report structure from the skill`,
        `soul     "${soulLine}"`,
        `prompt   skill-determined (${resolvedSkills})`,
        `tools    ${registry.list().length} registered · ${allowedTools.length ? `${allowedTools.length} allowed by skills` : "all allowed"}`,
        `data     ${built.mcp.map((m) => `${m.name}(${m.toolCount})`).join(", ") || "no MCP"} + web search (${websearch})`,
        `budget   ${budget.maxSteps} steps · ${budget.maxTokens.toLocaleString()} tokens · ${budget.cbSessions} research sessions × ${budget.cbSessionSteps} steps`,
        `pipeline one autonomous ToolLoopAgent: research + write the report`,
        `compact  clear past 3 tool results · summarize >90% of ${contextBudget?.toLocaleString() ?? "budget"} input tokens (${summarizerId ?? "main model"})`,
        `config   ${loaded.file ? `${CONFIG_FILENAME} loaded` : `no ${CONFIG_FILENAME} (built-ins)`} · flags > HARNESS_* env > file > built-ins`,
        `mcp      ${built.mcp.map((m) => `${m.name} ${m.url}`).join(", ") || "none"} → ${built.mcp.reduce((n, m) => n + m.toolCount, 0)} tools`,
      ];
      for (const d of details) console.log(dimLine(d));
    }
  } else {
    console.error(dimLine(`running ${symbol} (${source}) on ${modelId}…`));
  }

  const started = Date.now();
  const controller = new AbortController();
  renderer.onInterrupt = () => controller.abort();
  // Live step counter: a pure read of the SDK StepResult's usage — providers
  // that omit it simply leave the footer's token segment off. usage.outputTokens
  // is PER STEP (the run summary sums it), so accumulate — the footer's bar
  // must land on exactly the summary's "out" number.
  let stepsSeen = 0;
  let outTokens = 0;
  let sawUsage = false;
  let result;
  try {
    result = await runCanvasAnalysis({
      model,
      soul,
      skills,
      prompt: `Analyze ${symbol} (${source}). Follow the ${resolvedSkills} skill(s) end to end — their workflows and report structure govern this run. Use the tools to gather the evidence each workflow needs for ${symbol}.`,
      tools: registry.list(),
      allowedTools: allowedTools.length ? allowedTools : undefined,
      ctx: { symbol, source },
      budget,
      contextBudget,
      summarizerModel,
      systemPrompt,
      template,
      abortSignal: controller.signal,
      // flag only ever enables; absent → fall through to agent.yaml
      saveWorkspace: flags.saveWorkspace || undefined,
      onEvent: quiet ? undefined : (e) => renderer.event(e),
      onStepFinish: quiet
        ? undefined
        : (step) => {
            stepsSeen++;
            const out = step?.usage?.outputTokens;
            if (typeof out === "number" && Number.isFinite(out) && out >= 0) {
              outTokens += out;
              sawUsage = true;
            }
            renderer.progress({ step: stepsSeen, outputTokens: sawUsage ? outTokens : undefined });
          },
    });
  } finally {
    renderer.dispose();
  }
  const elapsedMs = Date.now() - started;
  const seconds = (elapsedMs / 1000).toFixed(1);

  const markdown = dumpMarkdown(result.document);
  const s = result.budgetUsed;
  // KB stats: last live event (full volume incl. raw), else the compact snapshot.
  const lastKb = [...result.trace].reverse().find((e) => e.type === "kb");
  const wsSnap = result.workspace;
  const kbFiles = lastKb && lastKb.type === "kb" ? lastKb.files : Object.keys(wsSnap).length;
  const kbBytes = lastKb && lastKb.type === "kb" ? lastKb.bytes : Object.values(wsSnap).reduce((n, c) => n + c.length, 0);
  const toolErrors = result.trace.filter((e) => e.type === "tool_result" && e.status === "error").length;
  const interrupted = controller.signal.aborted;

  const runFile = saveRun({
    symbol,
    source,
    elapsedSec: Number(seconds),
    status: result.status,
    verdict: result.verdict,
    budgetUsed: result.budgetUsed,
    errors: result.errors,
    document: result.document,
    workspace: result.workspace,
    // resolved config + the lines the CLI prints this run
    config: {
      model: modelId,
      soul,
      skills: skills.map((x) => x.id),
      template: null,
      budget,
      mcp: built.mcp,
      tools: registry.list().length,
      allowedTools,
      configFile: loaded.file ?? null,
    },
    printed: {
      markdown,
      summary: {
        steps: s.steps,
        outputTokens: s.tokens,
        inputTokens: s.inputTokens,
        toolCalls: s.toolCalls,
        toolErrors,
        kbFiles,
        kbBytes,
        sections: result.document.sections.length,
        sources: result.document.sources.length,
      },
      trace: result.trace,
    },
  });
  // Auto-saved report: same folder as the run JSON, plain markdown.
  const mdFile = runFile.replace(/\.json$/, ".md");
  writeFileSync(mdFile, markdown);
  // --save-workspace (or agent.yaml run.saveWorkspace): full memfs as a real
  // directory in the same folder — raw payloads included, nothing compacted away.
  if (result.workspaceFull) {
    writeWorkspaceRun(runFile, result.workspaceFull);
  }

  if (!quiet) {
    renderer.summary({
      status: result.status,
      interrupted,
      elapsedMs,
      steps: s.steps,
      maxSteps: budget.maxSteps,
      outputTokens: s.tokens,
      maxTokens: budget.maxTokens,
      inputTokens: s.inputTokens,
      toolCalls: s.toolCalls,
      toolErrors,
      kbFiles,
      kbBytes,
      sections: result.document.sections.length,
      sources: result.document.sources.length,
      verdict: result.verdict,
      outputPath: mdFile,
      errors: result.errors,
    });
    // KB overview: the persisted workspace (raw payloads excluded) as a tree.
    const kbPaths = Object.keys(result.workspace);
    if (kbPaths.length) {
      const rule = "─".repeat(Math.min(process.stdout.columns || 80, 72));
      console.log(`\n${rule}\n${kbTree(result.workspace)}\n${rule}`);
    }
    console.error(dimLine(`report saved ${mdFile}`));
    console.error(dimLine(`run saved ${runFile}`));
    // Progressive disclosure: the full report only on request — the default
    // run fits one screen; --verbose restores the boxed report.
    if (verbose) console.log(`\n${reportBox(renderMarkdown(markdown))}`);
  } else {
    if (result.verdict) console.error(dimLine(`verdict  ${result.verdict}`));
    console.error(dimLine(`report saved ${mdFile}`));
    console.error(dimLine(`run saved ${runFile}`));
  }

  if (json || outFile) {
    const serialized = JSON.stringify(result.document, null, 2);
    if (outFile) {
      writeFileSync(outFile, serialized);
      console.error(dimLine(`wrote ${outFile}`));
    }
    if (json) console.log(`\n--- report (document JSON) ---\n${serialized}`);
  }

  if (interrupted) process.exit(130);
  if (result.status === "failed") process.exit(1);
}

/** Run flag (agent.yaml run.saveWorkspace): the complete in-memory filesystem at runs/<id>/workspace/. */
export function writeWorkspaceRun(runFile: string, files: Record<string, string>): void {
  const root = `${runFile.replace(/\.json$/, "")}/workspace`;
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path.replace(/^\//, ""));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** Persist every --real run INSIDE its own folder: runs/<id>/<id>.json (+ .md beside it). */
export function saveRun(run: Record<string, unknown>, dir = "runs"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const symbol = String(run.symbol ?? "run").replace(/[^A-Za-z0-9_-]/g, "");
  const folder = join(dir, `${stamp}Z-${symbol}`);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${stamp}Z-${symbol}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...run }, null, 2));
  return file;
}

// ── usage & entry ───────────────────────────────────────────────────────────

function usage(code: number): never {
  const lines = [
    `  ${accent("RELATIVITY")} · HARNESS CLI`,
    "",
    `  ${bold("real")}     full research run: model + MCP data + skills`,
    "    --real --symbol <TICKER> [options]",
    "      --skills a,b        restrict builtin skills (default: all)",
    "      --model <id>        provider/model (default: opencode/deepseek-v4.1-flash)",
    "      --source <SRC>      evidence source label (default: SEC)",
    "      --soul <text>       analyst soul prompt",
    "      --system-prompt <n>  named system prompt from agent.yaml prompts (default: agents)",
    "      --mcp <url>         MCP endpoint (default: $MCP_VOYAGER_URL)",
    "      --mcp-allow a,b     restrict MCP tools",
    "      --max-steps <n>     loop step budget",
    "      --max-tokens <n>    token budget",
    "      --summarizer <id>   cheap model for context-summarize compaction",
    "      --context-tokens <n> input-token working budget (summarize at 90%)",
    "      --verbose, --full   raw data: full args, results, thoughts, report box",
    "      --plain             append-only output, no colors/spinner (also: piped, CI, NO_COLOR)",
    "      --quiet             summary only",
    "      --save-workspace     persist the complete filesystem to runs/<id>/workspace/ (enables agent.yaml run.saveWorkspace)",
    "      --json | --out f    print / write the report document JSON",
    "",
    `  ${bold("config")}   harness.config.json at the api/ root — model, skills,`,
    "            soul, template, budget. Precedence per option:",
    "            flags > HARNESS_* env > file > built-ins",
    "",
    `  ${bold("env")}      GEMINI/OPENAI/ANTHROPIC/GROQ/…_API_KEY,`,
    "            MCP_VOYAGER_URL, OLLAMA_URL, HARNESS_MODEL, HARNESS_SKILLS,",
    "            HARNESS_SOURCE, HARNESS_SUMMARIZER_MODEL",
    "",
    `  run from the api/ package root · exit 0 ok, 1 failed run, 2 usage`,
  ];
  console.log(lines.join("\n"));
  process.exit(code);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) usage(0);
  if (argv.includes("--real")) {
    return runReal({
      verbose: argv.includes("--verbose") || argv.includes("--full"),
      quiet: argv.includes("--quiet"),
      json: argv.includes("--json"),
      outFile: arg("--out"),
      plain: argv.includes("--plain"),
      saveWorkspace: argv.includes("--save-workspace"),
    });
  }
  usage(2);
}

// VITEST imports this module for writeWorkspaceRun — never start a run then.
if (!process.env.VITEST) main().catch((e) => {
  console.log("");
  console.log(errorBox(String(e?.message || e)));
  process.exit(1);
});
