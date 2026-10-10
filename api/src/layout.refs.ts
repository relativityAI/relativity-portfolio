/**
 * Shared ref extraction helpers (pony tail lite)
 * ponytail: regex-based for now; upgrade to tokenizer/AST if DSL complexity grows
 */
export function extractRefs(text: string, kind: "ds" | "lit" | "mt"): string[] {
  const re = new RegExp(`@${kind}:([\\w.-]+)`, "g");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) out.add(m[1]);
  }
  return Array.from(out);
}

export function hasScoreLeak(text: string): boolean {
  // forbid scores in layout per design
  return /@ds:score_skills\b/.test(text) || /@lit:score\./.test(text);
}
