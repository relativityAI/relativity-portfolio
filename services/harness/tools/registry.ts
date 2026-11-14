/**
 * Unified tool registry.
 *
 * Every capability the agent can call — web search and MCP tools — is a
 * ToolDefinition registered here. The loop only ever sees the tools an
 * agent's definition allows (see list()).
 */

import { z } from "zod";

export interface ToolContext {
  symbol: string;
  source: string;
  /** Per-run Tavily key (user settings) — web_search uses Tavily when set. */
  tavilyKey?: string;
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  /** Tools visible to an agent. `allowed` undefined = all. */
  list(allowed?: string[]): ToolDefinition[] {
    const all = [...this.tools.values()];
    if (!allowed) return all;
    const set = new Set(allowed);
    return all.filter((t) => set.has(t.name));
  }
}
