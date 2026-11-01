/**
 * Workspace file tools — the Context Builder's fs_* tool set plus todo_write
 * (the run's plan).
 *
 * Whole-file operations only (no line-based edits): a session writes its own
 * note files, reads/greps anything (including archived raw payloads). Results
 * stay small so the run trace stays lean — fs_write/fs_append return bytes,
 * fs_read paginates. todo_write is the only writer of the plan files: it
 * rewrites the whole typed list each call (that rewrite is the journal that
 * makes crash resume and the completion gate work).
 */

import { z } from "zod";
import type { ToolDefinition } from "../tools/registry.js";
import type { Workspace } from "./fs.js";
import { PATHS } from "./paths.js";

const PAGE_CAP = 4_000;

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Current plan from the workspace; null when missing/corrupt (fresh run). */
export function readPlan(ws: Workspace): TodoItem[] | null {
  const raw = ws.read(PATHS.planJson);
  if (raw == null) return null;
  try {
    const items = (JSON.parse(raw) as { items?: unknown }).items;
    return Array.isArray(items) ? (items as TodoItem[]) : null;
  } catch {
    return null;
  }
}

function renderPlanMd(items: TodoItem[]): string {
  const glyph = (s: TodoItem["status"]) => (s === "completed" ? "[x]" : s === "in_progress" ? "[>]" : "[ ]");
  return `# Plan\n\n${items.map((i) => `- ${glyph(i.status)} ${i.content}`).join("\n")}\n`;
}

export function workspaceTools(ws: Workspace): ToolDefinition[] {
  return [
    {
      name: "fs_ls",
      description: "List entries in a workspace directory. Directories end with '/'.",
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => ({ path, entries: ws.ls(path) }),
    },
    {
      name: "fs_read",
      description: `Read a workspace file. Paginated: at most ${PAGE_CAP} chars per call; pass offset to continue. Avoid reading /knowledge_base/sources/ files — tool results already arrive with the rows, dates and numbers you need; source files only hold full chart series (which the harness attaches at assembly).`,
      parameters: z.object({ path: z.string(), offset: z.number().int().min(0).optional() }),
      execute: async ({ path, offset }) => {
        const text = ws.read(path);
        if (text == null) return { error: `no such file: ${path}` };
        const start = offset ?? 0;
        const page = text.slice(start, start + PAGE_CAP);
        return { path, offset: start, total: text.length, content: page, nextOffset: start + page.length < text.length ? start + page.length : null };
      },
    },
    {
      name: "fs_write",
      description: "Create or overwrite a whole workspace file (parent dirs are created).",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const r = ws.write(path, content);
        return r ?? { error: `invalid path: ${path}` };
      },
    },
    {
      name: "fs_append",
      description: "Append text to a workspace file (created if missing).",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const r = ws.append(path, content);
        return r ?? { error: `invalid path: ${path}` };
      },
    },
    {
      name: "fs_grep",
      description: "Search workspace files for a regular expression; returns matching lines with paths.",
      parameters: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path }) => ({ matches: ws.grep(pattern, path ?? "/") }),
    },
    {
      name: "todo_write",
      description:
        "Replace the run's entire todo plan. Pass the COMPLETE list of {id, content, status} items every time — " +
        "an item you omit is dropped. Exactly ONE item may be in_progress. Statuses: pending | in_progress | completed. " +
        `Writes ${PATHS.planJson} (machine) and ${PATHS.planMd} (checklist); re-send after every meaningful step so progress survives a crash and the end-of-run completion gate can pass.`,
      parameters: z.object({
        items: z.array(
          z.object({
            id: z.string().min(1).max(64),
            content: z.string().min(1).max(300),
            status: z.enum(["pending", "in_progress", "completed"]),
          }),
        ),
      }),
      execute: async ({ items }: { items: TodoItem[] }) => {
        const active = items.filter((i) => i.status === "in_progress").length;
        if (active > 1) return { error: `only ONE todo may be in_progress (you sent ${active}) — set the rest to pending` };
        const ids = new Set(items.map((i) => i.id));
        if (ids.size !== items.length) return { error: "todo ids must be unique" };
        ws.write(PATHS.planJson, JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 1));
        ws.write(PATHS.planMd, renderPlanMd(items));
        const done = items.filter((i) => i.status === "completed").length;
        return {
          saved: items.length,
          completed: done,
          pending: items.length - done,
          path: PATHS.planMd,
        };
      },
    },
  ];
}
