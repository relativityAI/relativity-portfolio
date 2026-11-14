// Human-readable per-item differences between two agent draft snapshots.
// Used by the builder preview to show exactly what changed since last save.

export interface ChangeItem {
  label: string;
  detail: string;
  /** Machine-readable path (dot notation, shallow) for per-item discard. */
  path?: string;
}

type Qual = { parameter?: string; content?: string; weightage?: number };
type Quant = { metric?: string; metric_name?: string; operator?: string; value?: unknown; weightage?: number };

const opLabel: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between" };

function snip(s: string, n = 90): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
}

function qualKey(p: Qual): string {
  return (p.parameter || "").trim();
}

function ruleKey(r: Quant): string {
  return `${r.metric || r.metric_name || ""}|${r.operator || ""}|${JSON.stringify(r.value ?? null)}`;
}

function ruleLabel(r: Quant): string {
  const name = r.metric_name || r.metric || "rule";
  return `${name} ${opLabel[r.operator || ""] || r.operator} ${JSON.stringify(r.value)}`;
}

function has(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

function diffQual(out: ChangeItem[], section: string, prev: unknown, next: unknown): void {
  const a = Array.isArray(prev) ? (prev as Qual[]) : [];
  const b = Array.isArray(next) ? (next as Qual[]) : [];
  const bm = new Map(b.map((p) => [qualKey(p), p] as const));
  for (const p of a) {
    const key = qualKey(p);
    const nb = bm.get(key);
    if (!nb) {
      if (key) out.push(chg(`${section} · ${key}`, "removed"));
    } else {
      const contentChanged = JSON.stringify(p.content) !== JSON.stringify(nb.content);
      const weightChanged = JSON.stringify(p.weightage) !== JSON.stringify(nb.weightage);
      const bits: string[] = [];
      if (contentChanged) bits.push(nb.content && has(nb.content) ? `content: “${snip(nb.content)}”` : "content cleared");
      if (weightChanged) bits.push(`weightage ${p.weightage ?? "—"} → ${nb.weightage ?? "—"}`);
      if (bits.length) out.push(chg(`${section} · ${key}`, bits.join(" · ")));
    }
  }
  const ak = new Set(a.map(qualKey));
  for (const p of b) {
    const key = qualKey(p);
    if (key && !ak.has(key)) out.push(chg(`${section} · ${key}`, `added — ${snip(p.content || "")}`));
  }
}

function diffQuant(out: ChangeItem[], section: string, prev: unknown, next: unknown): void {
  const a = Array.isArray(prev) ? (prev as Quant[]) : [];
  const b = Array.isArray(next) ? (next as Quant[]) : [];
  const bm = new Map(b.map((r) => [ruleKey(r), r] as const));
  for (const r of a) {
    const key = ruleKey(r);
    const nb = bm.get(key);
    if (nb === undefined) {
      out.push(chg(`${section} · ${ruleLabel(r)}`, "removed"));
    } else if (JSON.stringify(r.weightage) !== JSON.stringify(nb.weightage)) {
      out.push(chg(`${section} · ${ruleLabel(r)}`, `weightage ${r.weightage ?? "—"} → ${nb.weightage ?? "—"}`));
    }
  }
  const ak = new Set(a.map(ruleKey));
  for (const r of b) {
    const key = ruleKey(r);
    if (!ak.has(key)) out.push(chg(`${section} · ${ruleLabel(r)}`, "added"));
  }
}

function chg(label: string, detail: string, path?: string): ChangeItem {
  return path ? { label, detail, path } : { label, detail };
}

export function diffDraft(prev: Record<string, unknown>, next: Record<string, unknown>): ChangeItem[] {
  const out: ChangeItem[] = [];

  for (const [key, label] of [["name", "Name"], ["style", "Style"], ["philosophy", "Philosophy"]] as const) {
    const a = prev[key];
    const b = next[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      const detail = has(a) && has(b) && typeof a === "string" && typeof b === "string"
        ? `${snip(a, 40)} → ${snip(b, 40)}`
        : typeof b === "string"
          ? `set to “${snip(b, 90)}”`
          : "updated";
      out.push(chg(label, detail, key));
    }
  }

  const configA = prev.configuration as Record<string, unknown> | undefined;
  const configB = next.configuration as Record<string, unknown> | undefined;
  const subLabels: Record<string, string> = { investment_horizon: "Horizon", risk_appetite: "Risk appetite" };
  for (const [k, v] of Object.entries(configB || {})) {
    const a = configA?.[k];
    if (JSON.stringify(a) !== JSON.stringify(v)) {
      const label = subLabels[k] || k;
      const detail = a != null && has(v)
        ? (k === "investment_horizon" || k === "risk_appetite"
            ? `${String(a)} → ${String(v)}`
            : "updated")
        : has(v) ? `set to “${String(v)}”` : "cleared";
      out.push(chg(label, detail, `configuration.${k}`));
    }
  }

  type EvalShape = { qualitative?: unknown; quantitative?: unknown };
  const aeA = prev.asset_evaluation as EvalShape | undefined;
  const aeB = next.asset_evaluation as EvalShape | undefined;
  const meA = prev.macro_evaluation as EvalShape | undefined;
  const meB = next.macro_evaluation as EvalShape | undefined;

  diffQual(out, "Asset Qualitative", aeA?.qualitative, aeB?.qualitative);
  diffQuant(out, "Asset Quantitative", aeA?.quantitative, aeB?.quantitative);
  diffQual(out, "Macro Qualitative", meA?.qualitative, meB?.qualitative);
  diffQuant(out, "Macro Quantitative", meA?.quantitative, meB?.quantitative);

  const pa = prev.persona as Record<string, unknown> | undefined;
  const pb = next.persona as Record<string, unknown> | undefined;
  if (JSON.stringify(pa?.philosophy_and_mindset) !== JSON.stringify(pb?.philosophy_and_mindset) && !out.some((c) => c.label === "Philosophy")) {
    const detail = (pa?.philosophy_and_mindset as string) && (pb?.philosophy_and_mindset as string)
      ? `“${snip(pa?.philosophy_and_mindset as string, 40)}” → “${snip(pb?.philosophy_and_mindset as string, 40)}”`
      : (pb?.philosophy_and_mindset as string)
        ? `set to “${snip(pb?.philosophy_and_mindset as string, 90)}”`
        : "philosophy cleared";
    out.push(chg("Persona", detail, "persona.philosophy_and_mindset"));
  }

  return out;
}