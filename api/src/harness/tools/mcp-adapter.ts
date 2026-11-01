/**
 * Adapter: expose MCP tools as harness ToolDefinitions.
 *
 * MCP tools declare a JSON Schema (not Zod), so we wrap it with the AI SDK's
 * `jsonSchema()` helper — the SDK accepts either a Zod schema or a wrapped JSON
 * schema as a tool's inputSchema. Execution is delegated to `client.callTool`.
 */

import { jsonSchema } from "ai";
import type { z } from "zod";
import type { JSONSchema7 } from "ai";
import type { McpClient } from "./mcp-client.js";
import type { ToolDefinition } from "./registry.js";

export interface McpToolsOptions {
  /** Only expose these MCP tool names (undefined = all). */
  allow?: string[];
  /** Prefix applied to exposed names, to avoid collisions with built-ins. */
  prefix?: string;
}

export async function mcpTools(client: McpClient, opts: McpToolsOptions = {}): Promise<ToolDefinition[]> {
  await client.initialize();
  const listed = await client.listTools();
  const allow = opts.allow?.length ? new Set(opts.allow) : null;
  return listed
    .filter((t) => !allow || allow.has(t.name))
    .map((t) => {
      const schema = (t.inputSchema as JSONSchema7) ?? ({ type: "object", properties: {} } as JSONSchema7);
      return {
        name: `${opts.prefix ?? ""}${t.name}`,
        description: t.description ?? `MCP tool ${t.name}`,
        parameters: jsonSchema(schema) as unknown as z.ZodTypeAny,
        execute: (args: unknown) => callUnwrapped(client, t.name, args, t.outputSchema),
      };
    });
}

interface McpCallResult {
  content?: { type?: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Call an MCP tool and hand the loop a plain observation:
 * - `isError` → throw, so the trace records status "error" and the model can recover;
 * - prefer `structuredContent` when present (content[0].text usually duplicates it),
 *   halving the tokens a series payload costs;
 * - else the text payload (JSON or prose) as a string;
 * - when the tool declares an `outputSchema` (MCP spec: clients SHOULD validate):
 *   no structured content and no text → throw; structured content of the wrong
 *   JSON-Schema type → throw. Either way the trace records an error the model
 *   can recover from instead of ingesting garbage evidence.
 */
async function callUnwrapped(client: McpClient, name: string, args: unknown, outputSchema?: unknown): Promise<unknown> {
  const res = (await client.callTool(name, args)) as McpCallResult | undefined;
  if (res?.isError) {
    const text = res.content?.map((c) => c?.text ?? "").join("\n").trim();
    throw new Error(text || `MCP tool ${name} failed`);
  }
  if (res?.structuredContent !== undefined) {
    const bad = typeMismatch(outputSchema, res.structuredContent);
    if (bad) throw new Error(`MCP tool ${name} returned ${bad} but its output schema expects ${expectedType(outputSchema)}`);
    return res.structuredContent;
  }
  const text = res?.content?.[0]?.text;
  if (typeof text === "string") return text;
  if (outputSchema != null) throw new Error(`MCP tool ${name} declares an output schema but returned nothing`);
  return res ?? null;
}

// ponytail: JSON-Schema `type` check only (scalar/object/array) — add ajv when
// Voyager tools publish required/properties worth enforcing.
const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
};

function typeMismatch(schema: unknown, value: unknown): string | null {
  const want = (schema as any)?.type;
  if (typeof want !== "string" || !TYPE_CHECKS[want]) return null; // union types (["object","null"]) skipped
  return TYPE_CHECKS[want](value) ? null : value === null ? "null" : Array.isArray(value) ? "an array" : `type ${typeof value}`;
}

function expectedType(schema: unknown): string {
  const want = (schema as any)?.type;
  return typeof want === "string" ? `a ${want}` : "its schema";
}
