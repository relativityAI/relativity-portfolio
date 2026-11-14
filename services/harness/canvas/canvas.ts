/**
 * ReportCanvas — the in-memory report the agent writes onto.
 *
 * The canvas is an ordered list of section-groups; each lands through the
 * agent's `report_write` tool as full Sections (one heading + inner blocks).
 * `document()` compiles the canvas into a ReportDocument — the same schema the
 * UI already renders — so the canvas IS the report at every moment. The canvas
 * lives in process memory; the caller decides what to persist.
 *
 * Compilation is pass-through: sections and sources land exactly as the agent
 * wrote them (on id collision the first source wins). Nothing is synthesized —
 * no title, no timestamp, no citation tails, no token rewriting.
 */

import {
  SCHEMA_VERSION,
  SectionSchema,
  SourceSchema,
  type ReportDocument,
  type Section,
  type Source,
} from "../report/document.js";
import { barTime } from "../report/builder.js";

export interface CanvasEntry {
  id: string;
  title: string;
  sections: Section[];
  /** Plan position (parallel runs) — document() orders by slot, write order breaks ties. */
  slot?: number;
}

const HIGHLIGHT_KINDS = new Set(["number", "positive", "negative", "citation", "neutral"]);

/** Coerce invented highlight kinds back into the enum before schema grading. */
function repairSection(raw: any, sources?: Source[]): any {
  if (raw && typeof raw === "object" && Array.isArray(raw.blocks)) {
    for (const b of raw.blocks) {
      if (!b || typeof b !== "object") continue;
      if ((b.type === "text" || b.type === "callout") && Array.isArray(b.highlights)) {
        for (const h of b.highlights) {
          if (h && typeof h === "object" && !HIGHLIGHT_KINDS.has(h.kind)) h.kind = "number";
        }
      }
      // Missing `type` inferred from shape — deterministic, never guesses content.
      if (b.type == null) {
        if (Array.isArray(b.columns) && Array.isArray(b.rows)) b.type = "table";
        else if (b.spec) b.type = "chart";
        else if (Array.isArray(b.items)) b.type = "metrics";
        else if (typeof b.text === "string" && b.variant) b.type = "callout";
        else if (typeof b.text === "string") {
          b.type = "text";
          if (b.level == null) b.level = 1;
        }
      }
      // Figure forgot sourceId: attach the call's ONLY source — with 2+ sources
      // it's ambiguous, so the write stays rejected (never invent a citation).
      const figure = b.type === "chart" || b.type === "table" || b.type === "diagram" || b.type === "compare";
      if (figure && !b.sourceId && sources?.length === 1 && sources[0]?.id) b.sourceId = sources[0].id;
      // Data token in `series` (a string) — tokens belong in `data`. Coerce
      // instead of rejecting the whole section over a field mixup.
      if (b.type === "chart" && b.spec && typeof b.spec.series === "string" && b.spec.data == null) {
        b.spec.data = b.spec.series;
        delete b.spec.series;
      }
      // Same mixup as a list of tokens: ["price","sma200"] → data.
      if (
        b.type === "chart" &&
        b.spec &&
        Array.isArray(b.spec.series) &&
        b.spec.series.length > 0 &&
        b.spec.series.every((x: unknown) => typeof x === "string") &&
        b.spec.data == null
      ) {
        b.spec.data = (b.spec.series as string[]).join(", ");
        delete b.spec.series;
      }
      // Series inlined with raw row shapes ({date, close} / missing label) —
      // coerce to the point contract ({t, v}) and label them. Rows that stay
      // unrecognisable are still rejected (never invent data).
      if (b.type === "chart" && b.spec && Array.isArray(b.spec.series)) {
        const names = b.spec.names;
        b.spec.series = b.spec.series.map((s: any, i: number) => {
          if (!s || typeof s !== "object" || !Array.isArray(s.points)) return s;
          const raw = s.points.some((p: any) => p && typeof p === "object" && typeof p.t !== "number" && (p.date != null || p.time != null));
          if (raw) {
            s.points = s.points.map((p: any) => {
              if (!p || typeof p !== "object") return p;
              if (typeof p.t !== "number") {
                const t = barTime(p);
                if (t != null) p.t = t;
              }
              // date-shaped rows: close beats volume (yahoo rows carry both)
              const v = [p.close, p.c, p.value, p.v].find((x: any) => typeof x === "number");
              if (v != null) p.v = v;
              return p;
            });
          }
          if (typeof s.label !== "string" || !s.label) {
            s.label = (Array.isArray(names) && typeof names[i] === "string" && names[i]) || `series${i + 1}`;
          }
          return s;
        });
      }
    }
  }
  if (raw?.heading && typeof raw.heading === "object" && raw.heading.level == null && typeof raw.heading.text === "string") {
    raw.heading.level = 2;
  }
  return raw;
}

/** Validate + lenient-repair a report_write payload; keeps only schema-valid sections. */
export function validateComposed(raw: { sections: unknown[]; sources?: Source[] }): {
  sections: Section[];
  sources: Source[];
  invalid: string[];
} {
  // Sources first — repair may attach the call's single source to a figure
  // that forgot its sourceId, so the list must already be schema-clean.
  const sources: Source[] = [];
  for (const src of raw.sources ?? []) {
    const parsed = SourceSchema.safeParse(src);
    if (parsed.success) sources.push(parsed.data);
  }
  const sections: Section[] = [];
  const invalid: string[] = [];
  for (const [i, s] of (raw.sections ?? []).entries()) {
    const parsed = SectionSchema.safeParse(repairSection(s, sources));
    if (parsed.success) sections.push(parsed.data);
    // Index + heading so the agent can map the failure to the section it just sent
    // (anonymous "spec: Required" had it re-writing already-accepted sections).
    else {
      const label = (s as any)?.heading?.text ?? (s as any)?.title ?? "?";
      invalid.push(`sections[${i}] ("${label}"): ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ")}`);
    }
  }
  return { sections, sources, invalid };
}

export class ReportCanvas {
  readonly symbol: string;
  title?: string;
  subtitle?: string;
  private readonly entries: CanvasEntry[] = [];
  private readonly sourceMap = new Map<string, Source>();

  constructor(symbol: string, title?: string, subtitle?: string) {
    this.symbol = symbol;
    this.title = title?.trim() || undefined;
    this.subtitle = subtitle;
  }

  /** Append one report_write call: merge its sources (first id wins) and land
   *  its sections unchanged. `slot` fixes the section-group's position in the
   *  compiled document (parallel workers write concurrently; order must follow
   *  the plan, not completion order). Stable sort keeps write order within
   *  equal slots. */
  appendSections(title: string, sections: Section[], sources: Source[], slot?: number): void {
    for (const s of sources) {
      if (!s?.id || this.sourceMap.has(s.id)) continue; // identical or conflicting — first wins
      this.sourceMap.set(s.id, s);
    }
    const n = this.entries.length + 1;
    const entry: CanvasEntry = {
      id: `t${n}`,
      title: title?.trim() || `Section ${n}`,
      sections,
    };
    if (slot != null) entry.slot = slot;
    this.entries.push(entry);
  }

  sources(): Source[] {
    return [...this.sourceMap.values()];
  }

  /** Section-groups (id → title) — what report_remove may target. */
  groups(): { id: string; title: string; sections: number }[] {
    return this.entries.map((e) => ({ id: e.id, title: e.title, sections: e.sections.length }));
  }

  /** Drop a section-group by id or exact title (report_remove). False when absent. */
  removeGroup(idOrTitle: string): boolean {
    const i = this.entries.findIndex((e) => e.id === idOrTitle || e.title === idOrTitle);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    return true;
  }

  sectionCount(): number {
    return this.entries.reduce((n, e) => n + e.sections.length, 0);
  }

  /**
   * Compile the canvas into a ReportDocument. Section order is slot order
   * (plan position in parallel runs), write order breaking ties — so the
   * document is deterministic regardless of which worker finished first.
   * Pass-through: nothing is injected (no title, no timestamp, no citations).
   */
  document(): ReportDocument {
    const ordered = [...this.entries].sort(
      (a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER),
    );
    const sections: Section[] = ordered.flatMap((e) => e.sections);
    const doc: ReportDocument = {
      schema: SCHEMA_VERSION,
      symbol: this.symbol,
      sections,
      sources: this.sources(),
    };
    if (this.title) doc.title = this.title;
    if (this.subtitle) doc.subtitle = this.subtitle;
    return doc;
  }
}
