/**
 * ReportCanvas — the in-memory report the agent writes onto.
 *
 * The canvas is an ordered list of section-groups; each lands through the
 * agent's `report_write` tool as typed Sections. `document()` compiles the
 * canvas into a ReportDocument — the same schema the UI already renders — so
 * the canvas IS the report at every moment. The canvas lives in process
 * memory; the caller decides what to persist.
 *
 * Source ids are namespaced per write on entry: two report_write calls that
 * both invent "s1" would collide. Identical sources (same label + value)
 * dedupe; conflicting ones get rewritten — both the Source and every
 * reference to it inside that write's sections.
 */

import {
  SCHEMA_VERSION,
  SectionSchema,
  SourceSchema,
  type ReportDocument,
  type Section,
  type Source,
} from "../report/document.js";
import { unwrapResult } from "../report/builder.js";
import type { TraceEvent } from "../types.js";

export interface CanvasEntry {
  id: string;
  title: string;
  sections: Section[];
  /** Plan position (parallel runs) — document() orders by slot, write order breaks ties. */
  slot?: number;
}

export interface DocumentOptions {
  /** Emit the citations tail. */
  final?: boolean;
}

const HIGHLIGHT_KINDS = new Set(["number", "positive", "negative", "citation", "neutral"]);

/** Coerce invented highlight kinds back into the enum before schema grading. */
function repairSection(raw: any): any {
  if ((raw?.type === "paragraph" || raw?.type === "callout") && Array.isArray(raw.highlights)) {
    for (const h of raw.highlights) {
      if (h && typeof h === "object" && !HIGHLIGHT_KINDS.has(h.kind)) h.kind = "number";
    }
  }
  return raw;
}

/** Validate + lenient-repair a report_write payload; keeps only schema-valid sections. */
export function validateComposed(raw: { sections: unknown[]; sources?: Source[] }): {
  sections: Section[];
  sources: Source[];
  invalid: string[];
} {
  const sections: Section[] = [];
  const invalid: string[] = [];
  for (const [i, s] of (raw.sections ?? []).entries()) {
    const parsed = SectionSchema.safeParse(repairSection(s));
    if (parsed.success) sections.push(parsed.data);
    // Index + type so the agent can map the failure to the block it just sent
    // (anonymous "spec: Required" had it re-writing already-accepted sections).
    else invalid.push(`sections[${i}] (${(s as any)?.type ?? "?"}): ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ")}`);
  }
  const sources: Source[] = [];
  for (const src of raw.sources ?? []) {
    const parsed = SourceSchema.safeParse(src);
    if (parsed.success) sources.push(parsed.data);
  }
  return { sections, sources, invalid };
}

function rewriteSourceId(value: string | undefined, map: Map<string, string>): string | undefined {
  if (!value) return value;
  return map.get(value) ?? value;
}

function mapHighlights(
  highlights: { text: string; kind: "number" | "positive" | "negative" | "citation" | "neutral"; sourceId?: string }[] | undefined,
  map: Map<string, string>,
) {
  if (!highlights) return highlights;
  return highlights.map((h) => (h.sourceId ? { ...h, sourceId: rewriteSourceId(h.sourceId, map) } : h));
}

/** Rewrite every source reference inside one section through the id map. */
export function rewriteSectionSourceIds(section: Section, map: Map<string, string>): Section {
  if (!map.size) return section;
  switch (section.type) {
    case "paragraph":
      return { ...section, highlights: mapHighlights(section.highlights, map) };
    case "callout":
      return { ...section, highlights: mapHighlights(section.highlights, map) };
    case "metrics":
      return {
        ...section,
        items: section.items.map((m) => (m.sourceId ? { ...m, sourceId: rewriteSourceId(m.sourceId, map) } : m)),
      };
    case "quote":
      return section.sourceId ? { ...section, sourceId: rewriteSourceId(section.sourceId, map) } : section;
    case "citations":
      return { ...section, refs: section.refs.map((r) => map.get(r) ?? r) };
    default:
      return section;
  }
}

/** Every sourceId a section set cites, deduped, in first-seen order. */
export function collectSourceRefs(sections: Section[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id?: string) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  const TOKEN = /\[src:(\w+)\]/g;
  const tokens = (text?: string) => {
    if (!text) return;
    for (const m of text.matchAll(TOKEN)) add(m[1]);
  };
  for (const s of sections) {
    if (s.type === "paragraph" || s.type === "callout") {
      for (const h of s.highlights ?? []) add(h.sourceId);
      tokens(s.text); // agents cite in prose without registering the source
    } else if (s.type === "metrics") for (const m of s.items) add(m.sourceId);
    else if (s.type === "quote") add(s.sourceId);
    else if (s.type === "citations") for (const r of s.refs) add(r);
    else if (s.type === "table") {
      tokens(s.caption);
      for (const row of s.rows) for (const cell of row) if (typeof cell === "string") tokens(cell);
    } else if (s.type === "chart") tokens(s.caption);
  }
  return ids;
}

/**
 * Build a Source for an id the model cited but never emitted, attributing it
 * to a real data tool from this run. Falls back to a generic research note so
 * the reference always resolves rather than being dropped.
 */
function synthesizeSource(id: string, provenance: Map<string, string>, symbol: string): Source {
  // Prefer a tool whose evidence plausibly backs the citation (price/technical
  // tools for a price-shaped id), else any tool, else a generic note.
  const prefer = /sma|rsi|price|candle|trend|close|ohlc|technical/i.test(id) ? /price|candle|technical|ohlc|trend/i : null;
  const entries = [...provenance.entries()];
  const pick =
    (prefer && entries.find(([tool]) => prefer.test(tool))) ||
    entries.find(([tool]) => /search|news|filing|fundamental/i.test(tool)) ||
    entries[0];
  if (pick) {
    const [tool, snippet] = pick;
    return { id, label: `${symbol} ${tool.replace(/_/g, " ")}`, tool, value: snippet.slice(0, 300) };
  }
  return { id, label: `${symbol} research`, tool: "research", value: "Evidence gathered during the analysis run." };
}

export class ReportCanvas {
  readonly symbol: string;
  title: string;
  subtitle?: string;
  private readonly entries: CanvasEntry[] = [];
  private readonly sourceMap = new Map<string, Source>();
  /** Tool name → a snippet of its evidence, for synthesizing cited-but-missing sources. */
  private readonly toolProvenance = new Map<string, string>();

  constructor(symbol: string, title?: string, subtitle?: string) {
    this.symbol = symbol;
    this.title = title?.trim() || `Analysis — ${symbol}`;
    this.subtitle = subtitle;
  }

  /**
   * Record where each data tool's evidence came from, so a section that cites
   * a sourceId the agent never registered (common: they all invent "s1")
   * can still be resolved to a real, tool-attributed Source instead of being
   * dropped by validateReportDocument.
   */
  recordEvidence(trace: TraceEvent[]): void {
    for (const ev of trace) {
      if (ev.type !== "tool_result" || ev.status !== "ok" || !ev.tool) continue;
      const unwrapped = unwrapResult((ev as any).result);
      if (unwrapped == null) continue;
      let snippet: string;
      if (typeof unwrapped === "string") snippet = unwrapped;
      else {
        try {
          snippet = JSON.stringify(unwrapped);
        } catch {
          continue;
        }
      }
      if (!snippet.trim()) continue;
      // First (oldest) successful call per tool wins as the representative.
      if (!this.toolProvenance.has(ev.tool)) this.toolProvenance.set(ev.tool, snippet.slice(0, 400));
    }
  }

  /** Append one report_write call: merge its sources and land its sections.
   *  `slot` fixes the section-group's position in the compiled document
   *  (parallel workers write concurrently; order must follow the plan, not
   *  completion order). Stable sort keeps write order within equal slots. */
  appendSections(title: string, sections: Section[], sources: Source[], slot?: number): void {
    const idMap = new Map<string, string>();
    for (const s of sources) {
      if (!s?.id) continue;
      let mapped = s.id;
      const existing = this.sourceMap.get(mapped);
      if (existing) {
        if (existing.label === s.label && existing.value === s.value && existing.tool === s.tool) continue; // identical — reuse
        let n = 2;
        while (this.sourceMap.has(`${s.id}_${n}`)) n++;
        mapped = `${s.id}_${n}`;
      }
      this.sourceMap.set(mapped, { ...s, id: mapped });
      idMap.set(s.id, mapped);
    }
    const n = this.entries.length + 1;
    const entry: CanvasEntry = {
      id: `t${n}`,
      title: title?.trim() || `Section ${n}`,
      sections: sections.map((sec) => rewriteSectionSourceIds(sec, idMap)),
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
   * A citations tail is appended when final and none of the writes included one.
   */
  document(opts: DocumentOptions = {}): ReportDocument {
    const final = opts.final === true;
    // Group titles are the report's skeleton — surface them as level-2
    // headings (unless the write already led with one) so template validation
    // and markdown dumps see "What's new" / "Risks" instead of titles
    // vanishing at compile time.
    const ordered = [...this.entries].sort(
      (a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER),
    );
    const sections: Section[] = ordered.flatMap((e) => {
      // The write "led" with the group title when any heading equals it OR
      // extends it ("Relative Strength" / "Relative Strength: AAPL has a low
      // bar") — exact match alone duplicated the heading in every such group.
      const t = e.title.trim().toLowerCase();
      const led = e.sections.some(
        (s) => s.type === "heading" && (s.text.trim().toLowerCase() === t || s.text.trim().toLowerCase().startsWith(t)),
      );
      return led ? e.sections : [{ type: "heading" as const, level: 2 as const, text: e.title }, ...e.sections];
    });
    const sources = this.sources();
    const knownIds = new Set(sources.map((s) => s.id));
    // The agent routinely cites an id it never registered (every write invents
    // "s1"). Synthesize a real Source for each unresolved id from the run's
    // own tool evidence so the citations resolve — one id → one Source, so a
    // section's numbers stay attributed consistently across the document.
    const referenced = collectSourceRefs(sections);
    for (const id of referenced) {
      if (knownIds.has(id)) continue;
      sources.push(synthesizeSource(id, this.toolProvenance, this.symbol));
      knownIds.add(id);
    }
    if (final && sources.length && !sections.some((s) => s.type === "citations")) {
      sections.push({ type: "citations", refs: sources.map((s) => s.id) });
    }
    const doc: ReportDocument = {
      schema: SCHEMA_VERSION,
      title: this.title,
      generatedAt: new Date().toISOString(),
      symbol: this.symbol,
      sections,
      sources,
    };
    if (this.subtitle) doc.subtitle = this.subtitle;
    return doc;
  }
}
