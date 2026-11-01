/**
 * Numeric fidelity — a deterministic check that numbers quoted in the final
 * report actually appear in archived evidence.
 *
 * Free-tier models transcribe figures from memory ("200-DMA ₹4,842") as
 * often as from evidence. The check never blocks a run: flagged numbers go
 * into the run's error notes so the hallucination is visible instead of
 * silent.
 */

import type { ReportDocument, Section } from "../report/document.js";
import type { SourceStub } from "./archive.js";

// A number must start at a non-alphanumeric boundary so identifiers like
// "SMA200", "RSI14" or "src_001" don't contribute phantom figures.
const NUM_RE = /(?<![A-Za-z0-9_])-?\d[\d,]*(?:\.\d+)?/g;
const FLAG_CAP = 12;
const PAYLOAD_SCAN_CAP = 40;
const PAYLOAD_CHARS_CAP = 200_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Numeric literals in a text (commas tolerated: "4,842.30" → 4842.3). */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(round2(v));
  }
  return out;
}

/** Every number the archived evidence can back: stub derived facts + payload literals. */
export function allowedNumbers(stubs: SourceStub[], payloads: unknown[]): Set<number> {
  const set = new Set<number>();
  const add = (v: number) => {
    if (Number.isFinite(v)) set.add(round2(v));
  };
  for (const stub of stubs) {
    for (const v of Object.values(stub.derived?.scalars ?? {})) add(v);
    for (const s of stub.derived?.series ?? []) {
      add(s.first);
      add(s.last);
      add(s.min);
      add(s.max);
      add(s.changePct);
    }
  }
  const scanned = payloads.slice(0, PAYLOAD_SCAN_CAP);
  for (const p of scanned) {
    let str: string;
    try {
      str = typeof p === "string" ? p : JSON.stringify(p);
    } catch {
      continue;
    }
    if (!str || str.length > PAYLOAD_CHARS_CAP) str = str?.slice(0, PAYLOAD_CHARS_CAP) ?? "";
    for (const v of extractNumbers(str)) add(v);
  }
  return set;
}

/** Numbers in `text` that no allowed value backs (rounded to 2dp). */
export function verifyNumbers(text: string, allowed: Set<number>): number[] {
  const seen = new Set<number>();
  const flagged: number[] = [];
  for (const v of extractNumbers(text)) {
    if (allowed.has(v) || seen.has(v)) continue;
    seen.add(v);
    flagged.push(v);
    if (flagged.length >= FLAG_CAP) break;
  }
  return flagged;
}

function sectionText(section: Section): string {
  switch (section.type) {
    case "paragraph":
    case "callout":
      return section.text ?? "";
    case "heading":
      return section.text;
    case "table":
      return [section.caption ?? "", ...section.rows.flat().map(String)].join(" ");
    case "metrics":
      return section.items.map((i) => `${i.label} ${i.value}`).join(" ");
    case "quote":
      return section.text;
    default:
      return "";
  }
}

/** Unbacked numbers in the assembled document (citations/refs carry no numbers). */
export function verifyDocumentNumbers(doc: ReportDocument, allowed: Set<number>): number[] {
  // Numbers a cited source itself quotes are backed by that source — e.g. the
  // report's own DCF source carries "Base value $218/share" in its value.
  const allow = new Set(allowed);
  for (const src of doc.sources) {
    for (const v of extractNumbers(`${src.value} ${src.label}`)) allow.add(round2(v));
  }
  const text = doc.sections.map(sectionText).filter(Boolean).join("\n");
  return verifyNumbers(text, allow);
}
