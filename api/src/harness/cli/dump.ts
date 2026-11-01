/**
 * dumpMarkdown — raw markdown dump of the ReportDocument (the .md artifact
 * the run writes). Lives outside cli.ts so it stays importable in tests
 * (cli.ts self-executes main()).
 *
 * Figures render as the assembly's stored SVG (standalone via var() fallbacks)
 * with Fig. N, measure, how-to-read, a linked source and a CSV data block —
 * the figure leaves the file whole (skill rule 7).
 */
import { figureCsv } from "../report/figure-kit.js";
import { supGlyph, type ReportDocument, type Section } from "../report/document.js";

export function dumpMarkdown(doc: ReportDocument): string {
  const lines: string[] = [`# ${doc.title}`];
  if (doc.subtitle) lines.push(doc.subtitle);
  lines.push(`${doc.symbol} · ${doc.generatedAt}`, "");
  const specLine = (s: { kind: string; data?: string; series?: unknown[]; categories?: unknown[] }) =>
    `${s.kind}${s.data ? ` data=${s.data}` : ""}` +
    (s.series?.length ? ` · ${s.series.length} series` : "") +
    (s.categories?.length ? ` · ${s.categories.length} cats` : "");
  let figN = 0;
  for (const s of doc.sections as Section[]) {
    switch (s.type) {
      case "heading":
        lines.push(`${"#".repeat(s.level + 1)} ${s.text}`, "");
        break;
      case "paragraph":
        lines.push(s.text, "");
        break;
      case "callout":
        lines.push(`> [${s.variant}]${s.title ? ` ${s.title}:` : ""} ${s.text}`, "");
        break;
      case "table": {
        if (s.title) lines.push(s.title);
        lines.push(`| ${s.columns.join(" | ")} |`);
        lines.push(`| ${s.columns.map(() => "---").join(" | ")} |`);
        for (const r of s.rows) lines.push(`| ${r.join(" | ")} |`);
        if (s.caption) lines.push(s.caption);
        lines.push("");
        break;
      }
      case "chart": {
        figN++;
        lines.push(`**Fig. ${figN} — ${s.title ?? "(untitled chart)"}**${s.measure ? ` *(${s.measure})*` : ""}`, "");
        if (s.svgs?.length) {
          lines.push(s.svgs.join("\n"), "");
        } else {
          // no stored svg (candle or legacy doc) — the data still ships below
          const specs = s.panels?.length ? s.panels : [s.spec];
          lines.push(`[chart] ${s.title ?? "(untitled)"} — ${specs.map(specLine).join(" + ")}`, "");
        }
        if (s.caption) lines.push(`How to read: ${s.caption}`, "");
        const src = s.sourceId ? doc.sources.find((x) => x.id === s.sourceId) : undefined;
        if (src) lines.push(`Source: ${src.url ? `[${src.label}](${src.url})` : src.label}`, "");
        const csv = figureCsv(s.spec);
        if (csv) lines.push("<details><summary>Data</summary>", "", "```csv", csv, "```", "", "</details>", "");
        break;
      }
      case "metrics":
        lines.push(`| ${s.items.map((m) => m.label).join(" | ")} |`);
        lines.push(`| ${s.items.map(() => "---").join(" | ")} |`);
        lines.push(`| ${s.items.map((m) => `${m.value}${m.delta ? ` (${m.delta})` : ""}`).join(" | ")} |`, "");
        break;
      case "citations": {
        // footnotes, not a sources list — order from assembly, refs as legacy fallback
        const ids = doc.footnotes ?? s.refs;
        if (!ids.length) break;
        lines.push("**Footnotes**", "");
        ids.forEach((id, i) => {
          const src = doc.sources.find((x) => x.id === id);
          if (!src) return;
          lines.push(`${supGlyph(i + 1)} ${src.url ? `[${src.label}](${src.url})` : src.label} — ${src.value}`, "");
        });
        break;
      }
      case "diagram":
        lines.push(`[diagram] ${s.title ?? "(untitled)"} — mermaid`, "```mermaid", s.spec.code, "```", "");
        break;
      case "quote":
        lines.push(`> ${s.text}${s.attribution ? ` — ${s.attribution}` : ""}`, "");
        break;
      case "code":
        lines.push("```" + (s.language ?? ""), s.text, "```", "");
        break;
      case "badges":
        lines.push(s.items.map((i) => `[${i.label}]`).join(" "), "");
        break;
      case "compare":
        lines.push(`[compare] ${s.title ?? "(untitled)"}`, "");
        break;
      default:
        lines.push(JSON.stringify(s), "");
    }
  }
  return lines.join("\n").trimEnd();
}
