/**
 * report_write — the agent's only way onto the canvas.
 *
 * One call appends one section-group: schema-graded Sections plus the Sources
 * they cite. Invalid blocks are rejected per-section (valid ones still land),
 * so one malformed block never costs the rest of the write. `fixedSlot` pins
 * the group's document position (parallel workers) — the model never sets it.
 */
import { z } from "zod";
import type { ToolDefinition } from "../tools/registry.js";
import { ReportCanvas, validateComposed } from "./canvas.js";

export function reportWriteTool(canvas: ReportCanvas, onChange?: () => void, fixedSlot?: number): ToolDefinition {
  return {
    name: "report_write",
    description:
      "Write one section-group of the report onto the report canvas. Each section is a COMPLETE unit: { heading: {level,text}, blocks: [...] } — one heading, then any mix of text/figure blocks (see the full-section contract). Call repeatedly; each call appends. The final document is compiled from every call. The active skill's Report structure (BINDING) governs what you write — its section list, summary box, sentence-length and table rules — not a generic format.",
    parameters: z.object({
      title: z.string().describe("Short section-group label (2–5 words), e.g. 'What's new' — a label only, not a heading"),
      sections: z.array(z.any()).min(1).describe("Full sections — each { heading: {level, text}, blocks: [...] } per the output-format contract"),
      sources: z.array(z.any()).default([]).describe('Sources cited by these sections: { id, label, tool, value, url? } — set url to the document link'),
    }),
    execute: async ({ title, sections, sources }) => {
      const v = validateComposed({ sections, sources });
      if (!v.sections.length) {
        return { error: `no valid sections (${v.invalid.join(" | ") || "empty sections array"})`, rejected: v.invalid };
      }
      canvas.appendSections(title, v.sections, v.sources, fixedSlot);
      onChange?.();
      return {
        added: v.sections.length,
        rejected: v.invalid,
        sourceIds: v.sources.map((s) => s.id),
        totalSections: canvas.sectionCount(),
      };
    },
  };
}

/**
 * report_remove — opt-in retraction tool. The one-loop canvas pipeline does
 * NOT register it (the agent rewrites via report_write; the deadline keeps it
 * writing). Callers that manage their own revision flow can wire it.
 */
export function reportRemoveTool(canvas: ReportCanvas, onChange?: () => void): ToolDefinition {
  return {
    name: "report_remove",
    description:
      "Remove one section-group from the report canvas by its id (t1, t2…) or exact title. Retract a group whose numbers are not backed by sources, then rewrite it with report_write.",
    parameters: z.object({ group: z.string().describe('Section-group id or exact title, e.g. "Momentum"') }),
    execute: async ({ group }) => {
      if (!canvas.removeGroup(group)) return { error: `no section-group matches: ${group}` };
      onChange?.();
      return { removed: group, totalSections: canvas.sectionCount() };
    },
  };
}
