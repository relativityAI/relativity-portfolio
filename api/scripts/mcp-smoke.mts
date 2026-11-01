/**
 * Live MCP smoke — verifies the agent's data toolbox end to end.
 *
 *   cd api && npm run smoke:mcp          # needs MCP_VOYAGER_URL (see .env)
 *
 * Steps: initialize → tools/list (count, full names, collision warning) →
 * one read-only get_price_history call with latency → exit 0/1.
 *
 * Re-listing check: add or enable a tool on the MCP server, re-run this script
 * — the new name must appear below, and on the next harness run, without an
 * API restart (tools are listed fresh per run).
 */

import "dotenv/config";
import { McpClient, mcpTools } from "../src/harness/index.js";

/** Built-in websearch names: an MCP tool with one of these silently wins. */
const COLLISIONS = ["web_search", "search_news"];
const READ_ONLY = { tool: "get_price_history", args: { symbol: "RELIANCE", exchange: "NSE", limit: 5 } };

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

const url = process.env.MCP_VOYAGER_URL;
if (!url) fail("MCP_VOYAGER_URL is not set");

const client = new McpClient(url!);
let tools;
const t0 = Date.now();
try {
  await client.initialize();
  tools = await client.listTools();
} catch (e: any) {
  fail(`initialize/listTools: ${e?.message || e}`);
}
console.log(`listTools: ${tools.length} in ${Date.now() - t0}ms`);
console.log(tools.map((t) => t.name).join("\n"));

if (!tools.length) fail("MCP listed zero tools");

for (const name of COLLISIONS) {
  if (tools.some((t) => t.name === name))
    console.warn(`WARN: MCP tool "${name}" collides with the built-in websearch tool and overrides it`);
}

const adapted = await mcpTools(client);
const read = adapted.find((t) => t.name === READ_ONLY.tool);
if (!read) fail(`read-only probe tool "${READ_ONLY.tool}" is missing from the MCP`);
const t1 = Date.now();
try {
  const result = (await read.execute(READ_ONLY.args, {} as never)) as { dates?: unknown[] } | string | null;
  const detail = typeof result === "object" && result && "dates" in result ? `${result.dates?.length ?? 0} dates` : "ok";
  console.log(`${READ_ONLY.tool}: ${detail} in ${Date.now() - t1}ms`);
} catch (e: any) {
  fail(`${READ_ONLY.tool}: ${e?.message || e}`);
}

console.log("OK");
