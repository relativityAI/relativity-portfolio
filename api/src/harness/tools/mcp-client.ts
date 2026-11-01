/**
 * Minimal streamable-HTTP MCP client.
 *
 * The harness treats MCP tools as just another tool source. This client speaks
 * JSON-RPC 2.0 over HTTP POST with `Accept: application/json, text/event-stream`,
 * tracks the `Mcp-Session-Id` header, and parses both JSON and SSE responses.
 * URL comes from env (MCP_VOYAGER_URL) — the MCP is the agent's only data
 * toolbox; Voyager REST tools are not registered alongside it.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string };
}

function parseRpcPayload(text: string, contentType?: string | null): JsonRpcResponse {
  if (!text.trim()) return {};
  if (contentType?.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try {
          return JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
        } catch {
          // not a JSON data line — keep scanning
        }
      }
    }
    return {};
  }
  return JSON.parse(text) as JsonRpcResponse;
}

export class McpClient {
  private id = 0;
  private sessionId?: string;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }

  /** JSON-RPC request (expects a result). */
  private async request(method: string, params?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new Error(`MCP ${method} failed: HTTP ${res.status}`);
    const payload = parseRpcPayload(await res.text(), res.headers.get("content-type"));
    if (payload.error) throw new Error(payload.error.message || "MCP error");
    return payload.result;
  }

  /** JSON-RPC notification (no id, no result). */
  private async notify(method: string, params?: unknown): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
  }

  async initialize(clientInfo = { name: "relativity", version: "2.0.0" }): Promise<void> {
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo });
    await this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpTool[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args ?? {} });
  }
}
