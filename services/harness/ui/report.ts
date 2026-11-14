/**
 * Report — static post-run presentation: the boxed report, the markdown
 * restyler, and the error box. Display-width-aware (emoji-safe), clamped
 * to the terminal so borders never shatter.
 */

import { accent, bold, dim, error as red, warn } from "./theme.js";
import { displayWidth, fmtBytes, truncate } from "./format.js";

function width(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols, 40), 120);
}

/** Hard-wrap one paragraph to `w` display columns (long words broken). */
function wrapPara(para: string, w: number): string[] {
  if (!para.trim()) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of para.split(/\s+/)) {
    let chunk = word;
    if (line && displayWidth(line) + 1 + displayWidth(chunk) > w) {
      lines.push(line);
      line = "";
    }
    while (displayWidth(chunk) > w) {
      // Break a mega-word (urls, svg attrs) at the display boundary.
      let cut = "";
      for (const ch of chunk) {
        if (displayWidth(cut + ch) > w) break;
        cut += ch;
      }
      lines.push(cut);
      chunk = chunk.slice(cut.length);
    }
    line = line ? `${line} ${chunk}` : chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export function wrapIndent(text: string, indent: string, w: number): string[] {
  return text.split("\n").flatMap((para) => wrapPara(para, w).map((l) => indent + l));
}

export function box(lines: string[], opts: { pad?: number } = {}): string {
  const pad = opts.pad ?? 1;
  const bounded = lines.flatMap((l) => wrapIndent(l, "", width() - 2));
  const inner = Math.max(...bounded.map(displayWidth), 1);
  const rule = (l: string, r: string) => l + "─".repeat(inner + pad * 2) + r;
  const body = bounded.map((l) => `│${" ".repeat(pad)}${l}${" ".repeat(Math.max(0, inner - displayWidth(l)) + pad)}│`);
  return [rule("╭", "╮"), ...body, rule("╰", "╯")].join("\n");
}

/** Terminal styling for the final report: headings, callouts, chart placeholders. */
export function renderMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      if (/^#{1,6} /.test(line)) return bold(line);
      if (line.startsWith("> ")) return warn(line);
      if (/^\[(chart|diagram|compare)\]/.test(line)) return dim(line);
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return dim(line);
      if (/^---+$/.test(line)) return dim(line);
      return line.replace(/\*\*([^*]+)\*\*/g, (_, t) => bold(t));
    })
    .join("\n");
}

/** The final report, wrapped and boxed. */
export function reportBox(md: string): string {
  const inner = width() - 6;
  const lines = md.split("\n").flatMap((l) => wrapIndent(l, "   ", inner));
  return box(lines);
}

export function errorBox(title: string, details: string[] = []): string {
  const inner = width() - 6;
  const lines = [bold(red(title)), ...details.flatMap((d) => wrapIndent(d, "  • ", inner).map((l) => red(l)))];
  return box(lines);
}

/** Dim one-liner (saved-file notices, config notes). */
export function dimLine(text: string): string {
  return dim(`  ${truncate(text, width() - 4)}`);
}
/**
 * Knowledge-base overview as a directory tree with a right-hand metadata
 * column: recursive file counts for directories, sizes for files (pass
 * path → content for sizes; bare paths get counts only). One display line
 * per item — long names truncate with … at the terminal width, never wrap.
 * Padding is computed on plain widths, so color codes never skew columns.
 */
export function kbTree(paths: string[] | Record<string, string>): string {
  interface Node {
    dir: boolean;
    bytes: number;
    children: Map<string, Node>;
    /** Recursive file count (dirs). */
    files: number;
  }
  const root: Node = { dir: true, bytes: 0, children: new Map(), files: 0 };
  const list: [string, number][] = Array.isArray(paths)
    ? paths.map((p) => [p, 0] as [string, number])
    : Object.entries(paths).map(([p, content]) => [p, content.length]);
  for (const [path, bytes] of list) {
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let next = node.children.get(part);
      if (!next) {
        next = { dir: !isFile, bytes: 0, children: new Map(), files: 0 };
        node.children.set(part, next);
      }
      if (isFile) next.bytes = bytes;
      else next.dir = true;
      node = next;
    });
  }
  const count = (n: Node): number => {
    if (!n.dir) return (n.files = 1);
    n.files = 0;
    for (const c of n.children.values()) n.files += count(c);
    return n.files;
  };
  count(root);

  const rows: { prefix: string; branch: string; label: string; dir: boolean; meta: string }[] = [];
  const walk = (branch: Map<string, Node>, prefix: string): void => {
    const entries = [...branch.entries()].sort(
      ([a, A], [b, B]) => Number(!!B.dir) - Number(!!A.dir) || a.localeCompare(b),
    );
    entries.forEach(([name, node], i) => {
      const last = i === entries.length - 1;
      rows.push({
        prefix,
        branch: last ? "└── " : "├── ",
        label: node.dir ? `\u{1F4C1} ${name}/` : name,
        dir: node.dir,
        meta: node.dir ? `${node.files} files` : node.bytes > 0 ? fmtBytes(node.bytes) : "",
      });
      if (node.dir) walk(node.children, prefix + (last ? "    " : "\u2502   "));
    });
  };
  walk(root.children, "");

  const w = width();
  const metaW = Math.max(0, ...rows.map((r) => displayWidth(r.meta)));
  return rows
    .map((r) => {
      const gutter = r.prefix + r.branch;
      const gutW = displayWidth(gutter);
      const label = truncate(r.label, r.meta ? Math.max(4, w - gutW - metaW - 2) : Math.max(4, w - gutW - 2));
      const painted = r.dir ? accent(label) : label;
      if (!r.meta) return dim(gutter) + painted;
      const pad = Math.max(1, w - metaW - 1 - gutW - displayWidth(label));
      return dim(gutter) + painted + " ".repeat(pad) + dim(r.meta);
    })
    .join("\n");
}
