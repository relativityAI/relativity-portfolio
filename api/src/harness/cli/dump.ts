/**
 * dumpMarkdown — raw markdown dump of the ReportDocument (the .md artifact
 * the run writes). Lives outside cli.ts so it stays importable in tests
 * (cli.ts self-executes main()).
 *
 * v2: each section prints its heading, then its blocks in order. Figures
 * render as the assembly's stored SVG (standalone via var() fallbacks) with
 * Fig. N, measure, how-to-read, a linked source and a CSV data block — the
 * figure leaves the file whole (skill rule 7). Every figure block prints its
 * Source line beneath it.
 */
import { figureCsv } from "../report/figure-kit.js";
import { supGlyph, type Block, type ReportDocument, type Section } from "../report/document.js";

export function dumpMarkdown(doc: ReportDocument): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`# ${doc.title}`);
  if (doc.subtitle) lines.push(doc.subtitle);
  if (doc.generatedAt) lines.push(`${doc.symbol} · ${doc.generatedAt}`, "");
  else if (doc.title || doc.subtitle) lines.push("");
  const specLine = (s: { kind: string; data?: string; series?: unknown[]; categories?: unknown[] }) =>
    `${s.kind}${s.data ? ` data=${s.data}` : ""}` +
    (s.series?.length ? ` · ${s.series.length} series` : "") +
    (s.categories?.length ? ` · ${s.categories.length} cats` : "");
  const sourceLine = (sourceId?: string) => {
    const src = sourceId ? doc.sources.find((x) => x.id === sourceId) : undefined;
    return src ? `Source: ${src.url ? `[${src.label}](${src.url})` : src.label}` : "";
  };
  let figN = 0;
  for (const sec of doc.sections as Section[]) {
    lines.push(`${"#".repeat(sec.heading.level + 1)} ${sec.heading.text}`, "");
    for (const s of sec.blocks as Block[]) {
      switch (s.type) {
        case "text":
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
          const src = sourceLine(s.sourceId);
          if (src) lines.push(src);
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
          const src = sourceLine(s.sourceId);
          if (src) lines.push(src, "");
          const csv = figureCsv(s.spec);
          if (csv) lines.push("<details><summary>Data</summary>", "", "```csv", csv, "```", "", "</details>", "");
          break;
        }
        case "diagram":
          lines.push(`[diagram] ${s.title ?? "(untitled)"} — mermaid`, "```mermaid", s.spec.code, "```", "");
          if (s.caption) lines.push(`How to read: ${s.caption}`);
          {
            const src = sourceLine(s.sourceId);
            if (src) lines.push(src);
          }
          lines.push("");
          break;
        case "compare": {
          const before = "kind" in s.before ? specLine(s.before) : "diagram";
          const after = "kind" in s.after ? specLine(s.after) : "diagram";
          lines.push(`[compare] ${s.title ?? "(untitled)"} — ${before} → ${after}`, "");
          const src = sourceLine(s.sourceId);
          if (src) lines.push(src, "");
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
        case "code":
          lines.push("```" + (s.language ?? ""), s.text, "```", "");
          break;
        default:
          lines.push(JSON.stringify(s), "");
      }
    }
  }
  return lines.join("\n").trimEnd();
}
