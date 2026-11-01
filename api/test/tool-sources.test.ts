import { describe, expect, it } from "vitest";
import { buildToolRegistry, ToolSourcesSchema } from "../src/harness/tools/sources.js";

const TOOLS = [
  { name: "get_price_history", description: "ohlcv", inputSchema: { type: "object", properties: { symbol: { type: "string" } } } },
  { name: "get_fundamentals", description: "fundamentals", inputSchema: { type: "object", properties: {} } },
];

/** Minimal MCP streamable-HTTP server stand-in: answers initialize/list/call. */
function fakeMcpFetch(tools = TOOLS, methods: string[] = []): typeof fetch {
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body as string);
    methods.push(body.method);
    const result =
      body.method === "tools/list" ? { tools }
      : body.method === "tools/call" ? { content: [{ type: "text", text: '{"ok":true}' }] }
      : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const ENV = { MCP_VOYAGER_URL: "http://voyager.test/mcp" };

describe("buildToolRegistry", () => {
  it("defaults to websearch + yahoo + voyager-from-env (today's behavior) when config is empty", async () => {
    const { registry } = await buildToolRegistry({}, ENV, { fetchImpl: fakeMcpFetch() });
    const names = registry.list().map((t) => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain("get_quote");
    expect(names).toContain("get_price_history");
  });

  it("websearch: false disables the builtin", async () => {
    const { registry } = await buildToolRegistry({ websearch: false }, ENV, { fetchImpl: fakeMcpFetch() });
    expect(registry.list().map((t) => t.name)).not.toContain("web_search");
  });

  it("required source with no url throws naming the env var", async () => {
    await expect(buildToolRegistry({ mcp: [{ name: "voyager", urlEnv: "MCP_VOYAGER_URL" }] }, {}, {})).rejects.toThrow(
      /voyager.*MCP_VOYAGER_URL/,
    );
  });

  it("optional unreachable source warns and the run continues", async () => {
    const { registry } = await buildToolRegistry(
      { yahoo: false, mcp: [{ name: "flaky", urlEnv: "MCP_FLAKY_URL", required: false }] },
      { MCP_FLAKY_URL: "http://flaky.test/mcp" },
      { fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch },
    );
    expect(registry.list().map((t) => t.name)).toEqual(["web_search", "search_news"]);
  });

  it("allow filters server tools; CLI mcpAllow override wins over the entry", async () => {
    const { registry: byEntry } = await buildToolRegistry(
      { yahoo: false, mcp: [{ name: "v", urlEnv: "MCP_VOYAGER_URL", allow: ["get_price_history"] }] },
      ENV,
      { fetchImpl: fakeMcpFetch() },
    );
    expect(byEntry.list().map((t) => t.name)).toContain("get_price_history");
    expect(byEntry.list().map((t) => t.name)).not.toContain("get_fundamentals");

    const { registry: byFlag } = await buildToolRegistry(
      { yahoo: false, mcp: [{ name: "v", urlEnv: "MCP_VOYAGER_URL", allow: ["get_price_history"] }] },
      ENV,
      { fetchImpl: fakeMcpFetch(), mcpAllow: ["get_fundamentals"] },
    );
    expect(byFlag.list().map((t) => t.name)).toEqual(["web_search", "search_news", "get_fundamentals"]);
  });

  it("--mcp url override wins over env", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      urls.push(String(url));
      return fakeMcpFetch()(url, init);
    }) as typeof fetch;
    await buildToolRegistry({}, ENV, { fetchImpl, mcpUrlOverride: "http://override.test/mcp" });
    expect(urls[0]).toBe("http://override.test/mcp");
  });

  it("multiple servers register together; a collision with web_search is last-wins", async () => {
    const built = await buildToolRegistry(
      {
        mcp: [
          { name: "voyager", urlEnv: "MCP_VOYAGER_URL" },
          { name: "extra", url: "http://extra.test/mcp", allow: ["web_search"] },
        ],
      },
      ENV,
      { fetchImpl: fakeMcpFetch() },
    );
    const names = built.registry.list().map((t) => t.name);
    expect(names).toContain("get_price_history");
    expect(names).toContain("web_search");
    expect(new Set(names).size).toBe(names.length); // no duplicate keys
    expect(built.mcp.map((m) => m.name)).toEqual(["voyager", "extra"]);
    expect(built.mcp[0]).toMatchObject({ url: "http://voyager.test/mcp", toolCount: 2 });
  });

  it("rejects a schema-invalid source (no url/urlEnv)", () => {
    expect(() => ToolSourcesSchema.parse({ mcp: [{ name: "x" }] })).toThrow(/url.*urlEnv|urlEnv.*url/);
  });
});
