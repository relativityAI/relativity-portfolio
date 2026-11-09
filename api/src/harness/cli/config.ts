/**
 * CLI configuration layering — flags > HARNESS_* env > harness.config.json > built-ins.
 *
 * The CLI is a composition root: harness runs must be configurable without
 * touching code, but the harness must not silently inherit the API's .env
 * settings (DEFAULT_MODEL is the API's, not ours). So harness defaults live
 * in `harness.config.json` at the package root — one obvious file to edit —
 * with `HARNESS_*` env vars (api/.env) for one-off overrides, and command-line
 * flags always winning.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BUDGET, type Budget } from "../types.js";
import { ToolSourcesSchema, type ToolSourcesConfig } from "../tools/sources.js";
import type { Engine } from "../engine.js";

export const CONFIG_FILENAME = "harness.config.json";

/** Default engine when no flag, env, or config file says otherwise. */
export const DEFAULT_ENGINE: Engine = "v1";

// No config-file soul default: identity lives in config/prompts/AGENTS.md,
// injected by runCanvasAnalysis. --soul / harness.config.json soul still
// prepend an agent-specific persona over it.
/** Empty = the CLI picks the first builtin; set an id to choose the one skill. */
export const DEFAULT_SKILLS: string[] = [];
export const DEFAULT_MODEL = "opencode/deepseek-v4.1-flash";

/** The file's shape. `_help` is a comment field (ignored by resolution). */
export interface HarnessCliConfig {
  _help?: string;
  /** Which harness runs: "v1" = the tool loop, "v2" = the plan-parallel harness. */
  engine?: Engine;
  model?: string;
  skills?: string[];
  source?: string;
  soul?: string;
  /** @deprecated use tools.mcp[].allow; still honored for the voyager entry. */
  mcpAllow?: string[] | null;
  /** Tool sources (websearch + MCP servers) — see tools/sources.ts. */
  tools?: ToolSourcesConfig;
  budget?: Partial<Budget>;
}

export interface LoadedCliConfig {
  /** Absolute path of the file that was read, or null when none exists. */
  file: string | null;
  config: HarnessCliConfig;
}

/** First defined, non-blank candidate — the precedence primitive. */
export function firstValue<T>(...candidates: (T | undefined | null)[]): T | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    if (typeof c === "string" && c.trim() === "") continue;
    return c;
  }
  return undefined;
}

/**
 * Read `harness.config.json`: cwd first (what you're standing in wins), else
 * the package root (so a run from a subdirectory still finds it). Throws on a
 * malformed file — a typo'd config must fail loudly, not silently run defaults.
 */
export function loadCliConfig(cwd: string = process.cwd()): LoadedCliConfig {
  for (const file of candidates(cwd)) {
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (e: any) {
      throw new Error(`${CONFIG_FILENAME} at ${file} is not valid JSON: ${e?.message || e}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${CONFIG_FILENAME} at ${file} must be a JSON object`);
    }
    const config = parsed as HarnessCliConfig;
    if (config.skills !== undefined && (!Array.isArray(config.skills) || config.skills.some((s) => typeof s !== "string"))) {
      throw new Error(`${CONFIG_FILENAME}: "skills" must be an array of strings`);
    }
    if (config.budget !== undefined && (typeof config.budget !== "object" || config.budget === null || Array.isArray(config.budget))) {
      throw new Error(`${CONFIG_FILENAME}: "budget" must be an object`);
    }
    if (config.tools !== undefined) {
      const parsed = ToolSourcesSchema.safeParse(config.tools);
      if (!parsed.success) {
        throw new Error(`${CONFIG_FILENAME}: "tools" is invalid — ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
      }
      config.tools = parsed.data;
    }
    return { file, config };
  }
  return { file: null, config: {} };
}

function candidates(cwd: string): string[] {
  const out = [join(cwd, CONFIG_FILENAME)];
  // Package root fallback: walk up from this module to the nearest package.json.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (existsSync(join(dir, "package.json"))) {
      out.push(join(dir, CONFIG_FILENAME));
      break;
    }
  }
  return out;
}

/** Flag values as parsed by the CLI (undefined = not passed). */
export interface CliFlags {
  engine?: string;
  model?: string;
  skills?: string;
  source?: string;
  soul?: string;
  mcpAllow?: string;
  maxSteps?: number;
  maxTokens?: number;
}

export interface ResolvedRunConfig {
  engine: Engine;
  model: string;
  skills: string[];
  source: string;
  soul: string;
  mcpAllow: string[] | undefined;
  budget: Partial<Budget>;
}

/**
 * Layer flags, HARNESS_* env vars, and the config file into one resolved
 * config. Pure: env and file are inputs, so the precedence is testable.
 */
export function resolveRunConfig(flags: CliFlags, env: NodeJS.ProcessEnv, file: HarnessCliConfig): ResolvedRunConfig {
  const budget: Partial<Budget> = {
    ...file.budget,
    maxSteps: firstValue(flags.maxSteps, file.budget?.maxSteps, DEFAULT_BUDGET.maxSteps)!,
    maxTokens: firstValue(flags.maxTokens, file.budget?.maxTokens, DEFAULT_BUDGET.maxTokens)!,
  };
  const skillsRaw = firstValue(flags.skills, env.HARNESS_SKILLS, file.skills?.join(","));
  const mcpAllowRaw = firstValue(flags.mcpAllow, file.mcpAllow?.join(","));
  const engineRaw = firstValue(flags.engine, env.HARNESS_ENGINE, file.engine, DEFAULT_ENGINE)!;
  if (engineRaw !== "v1" && engineRaw !== "v2") {
    throw new Error(`engine must be "v1" or "v2" (got "${engineRaw}")`);
  }
  return {
    engine: engineRaw,
    model: firstValue(flags.model, env.HARNESS_MODEL, file.model, DEFAULT_MODEL)!,
    // One skill per run — a comma list keeps only its first entry.
    skills: (skillsRaw ?? DEFAULT_SKILLS.join(",")).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 1),
    source: firstValue(flags.source, env.HARNESS_SOURCE, file.source, "SEC")!.toUpperCase(),
    soul: firstValue(flags.soul, file.soul) ?? "",
    mcpAllow: mcpAllowRaw ? mcpAllowRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    budget,
  };
}
