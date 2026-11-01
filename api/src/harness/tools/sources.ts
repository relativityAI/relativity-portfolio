/**
 * Tool sources — declarative config for what the agent's toolbox contains.
 *
 * `harness.config.json`'s `tools` section names the sources (websearch builtin,
 * N MCP servers); this module turns them into a ToolRegistry. Both composition
 * roots (CLI + API) call buildToolRegistry, so the wiring lives in one place.
 * URL secrets stay in env: the config holds the env var NAME (urlEnv), not the
 * url. Per-agent allowedTools filtering still applies downstream on top.
 */

import { z } from "zod";
import { log } from "../log.js";
import { McpClient } from "./mcp-client.js";
import { mcpTools } from "./mcp-adapter.js";
import { websearchTools } from "./builtins/websearch.js";
import { ToolRegistry, type ToolDefinition } from "./registry.js";

export const McpSourceSchema = z
  .object({
    /** Label for logs/errors — also the collision-prefix hint. */
    name: z.string().min(1),
    /** Literal url (tests/CLI). Production should use urlEnv. */
    url: z.string().min(1).optional(),
    /** Env var that holds the url (e.g. "MCP_VOYAGER_URL"). */
    urlEnv: z.string().min(1).optional(),
    /** Server tool names to expose (null/absent = all). */
    allow: z.array(z.string()).nullable().optional(),
    /** Prefix for exposed names (calls still use the raw server name). */
    prefix: z.string().optional(),
    /** true (default) → the run fails if this server can't be reached. */
    required: z.boolean().optional(),
  })
  .refine((s) => s.url || s.urlEnv, { message: `needs "url" or "urlEnv"` });

export const ToolSourcesSchema = z.object({
  /** `false` disables websearch; `{}` (or absent) = local SearXNG, free/keyless. */
  websearch: z.union([z.object({}), z.literal(false)]).optional(),
  mcp: z.array(McpSourceSchema).optional(),
});

export type McpSourceConfig = z.infer<typeof McpSourceSchema>;
export type ToolSourcesConfig = z.infer<typeof ToolSourcesSchema>;

export interface BuildToolsOptions {
  /** CLI --mcp: overrides the first entry's url. */
  mcpUrlOverride?: string;
  /** CLI --mcp-allow / legacy file mcpAllow: overrides the first entry's allow. */
  mcpAllow?: string[];
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/** Default when the file has no `tools` section: today's behavior exactly. */
const DEFAULT_MCP: McpSourceConfig[] = [{ name: "voyager", urlEnv: "MCP_VOYAGER_URL" }];

export interface BuiltTools {
  registry: ToolRegistry;
  /** Resolved MCP servers (empty when none configured/reachable). */
  mcp: { name: string; url: string; toolCount: number }[];
}

/**
 * Build the registry from config. Throws when a `required` source is missing
 * or unreachable (message names the entry + env var); optional sources just
 * warn and the run continues without them.
 */
export async function buildToolRegistry(
  sources: ToolSourcesConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: BuildToolsOptions = {},
): Promise<BuiltTools> {
  const cfg = ToolSourcesSchema.parse(sources ?? {});
  const mcp = cfg.mcp ?? DEFAULT_MCP;
  const registry = new ToolRegistry();
  const resolved: BuiltTools["mcp"] = [];

  if (cfg.websearch !== false) {
    registry.registerAll(websearchTools());
  }

  for (const [i, entry] of mcp.entries()) {
    const url = (i === 0 ? opts.mcpUrlOverride : undefined) ?? entry.url ?? env[entry.urlEnv ?? ""];
    const allow = (i === 0 ? opts.mcpAllow : undefined) ?? entry.allow ?? undefined;
    const required = entry.required ?? true;
    if (!url) {
      failOrSkip(required, `MCP source "${entry.name}" has no url — set ${entry.urlEnv ?? '"url"'} (in harness.config.json or the environment)`);
      continue;
    }
    let tools: ToolDefinition[];
    try {
      tools = await mcpTools(new McpClient(url, opts.fetchImpl), { allow, prefix: entry.prefix });
    } catch (e: any) {
      failOrSkip(required, `MCP source "${entry.name}" unreachable at ${url} — start the server or fix the url\n  ${e?.message || e}`);
      continue;
    }
    for (const t of tools) {
      if (registry.list().some((r) => r.name === t.name)) {
        // Silent last-wins here would hide a real toolbox bug at 3am.
        log.warn("tools", `name collision: MCP source "${entry.name}" tool "${t.name}" overrides an existing tool — set a prefix on the entry`);
      }
    }
    registry.registerAll(tools);
    resolved.push({ name: entry.name, url, toolCount: tools.length });
  }
  return { registry, mcp: resolved };
}

function failOrSkip(required: boolean, message: string): void {
  if (required) throw new Error(message);
  log.warn("tools", `skipping — ${message}`);
}
