/**
 * Format — display-width-safe truncation, number/duration/bytes formatting,
 * and the per-tool summarizers that turn args+result into a short label and
 * a metric. This module never writes; it only produces strings.
 */

import stringWidth from "string-width";

const CSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(OSC_RE, "").replace(CSI_RE, "");
}

/** Visual column width — ANSI- and emoji-safe. */
export function displayWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

const ELLIPSIS = "…";

/** CSI/OSC escape or a single visible character. */
const TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))|(\x1b\[[0-9;]*[A-Za-z])|([\s\S])/g;

/**
 * Truncate to `max` display columns, ending with "…" when cut. ANSI styles
 * pass through untouched (and a cut styled string gets a reset), so callers
 * can truncate after painting.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(text) <= max) return text;
  if (max === 1) return ELLIPSIS;
  let out = "";
  let w = 0;
  let styled = false;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1] || m[2]) {
      out += m[0];
      styled = true;
      continue;
    }
    const ch = m[3];
    const cw = stringWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + ELLIPSIS + (styled ? "\x1b[0m" : "");
}

/** One-line flatten: collapse whitespace, then clip by display width. */
export function clip(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, " ").trim(), max);
}

export function padEndW(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

export function padStartW(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? " ".repeat(pad) + text : text;
}

/** mm:ss elapsed clock (00:38, 02:14). */
export function fmtDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Tool latency: 822ms under a second, else 4.1s. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Token counts: 820 · 12.4k · 1.2M. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 10_000) return Math.round(n).toLocaleString("en-US");
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Untrusted web content ───────────────────────────────────────────────────

const UNTRUSTED_RE = /\[UNTRUSTED [^\]]*\]|\[\/UNTRUSTED [^\]]*\]/g;

/** Replace the `[UNTRUSTED …]` wrapper lines with a small [web] tag. */
export function stripUntrusted(text: string): string {
  return text.replace(UNTRUSTED_RE, (m) => (m.startsWith("[/") ? "" : "[web]")).replace(/\[web\]\n/g, "[web] ");
}

// ── Compaction logs ─────────────────────────────────────────────────────────

/** `compaction: clearing active — 3 old tool result(s)…` → `cleared 3 old tool results`. */
export function parseCompaction(text: string): string | null {
  if (!text.startsWith("compaction:")) return null;
  const clearing = text.match(/clearing active — (\d+) old tool result/);
  if (clearing) return `cleared ${clearing[1]} old tool result${clearing[1] === "1" ? "" : "s"}`;
  if (/summarized older context/.test(text)) return "summarized older messages";
  if (/summarize failed/.test(text)) return "summarize failed — clearing only";
  return clip(text.slice("compaction:".length).trim(), 80);
}

// ── Tool summarizers ────────────────────────────────────────────────────────

function argsOf(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" && v ? v : "";
}

/** `knowledge_base/t1-trend/s3.md` → `s3.md`; keeps dirs readable, clips long names. */
function basename(path: string): string {
  const clean = path.replace(/^\//, "");
  const base = clean.split("/").pop() ?? clean;
  return base.length > 40 ? `${base.slice(0, 39)}…` : base || clean;
}

const WEB_TOOLS = new Set(["web_search", "search_news", "web_fetch"]);

export function isWebTool(tool: string): boolean {
  return WEB_TOOLS.has(tool);
}

/** Short human label for a tool call — the part after the tool name. */
export function toolLabel(tool: string, args: unknown): string {
  const a = argsOf(args);
  switch (tool) {
    case "web_search":
    case "search_news": {
      const q = str(a, "query");
      return q ? `"${clip(q, 48)}"` : "search";
    }
    case "web_fetch": {
      const u = str(a, "url");
      if (!u) return "page";
      try {
        return new URL(u).host;
      } catch {
        return clip(u, 48);
      }
    }
    case "fs_ls":
    case "fs_read":
    case "fs_write":
    case "fs_append": {
      const p = str(a, "path");
      return p ? basename(p) : tool;
    }
    case "fs_grep": {
      const p = str(a, "pattern");
      return p ? `/${clip(p, 40)}/` : "grep";
    }
    case "report_write":
      return str(a, "title") || "sections";
    case "report_remove":
      return str(a, "group") || "group";
    default: {
      const json = JSON.stringify(a);
      if (!json || json === "{}") return "";
      return clip(json, 48);
    }
  }
}

/** Short metric for a tool result — "5 results", "2.7 KB", "3 sections". */
export function toolMetric(tool: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  switch (tool) {
    case "web_search":
    case "search_news": {
      const count = typeof r.count === "number" ? r.count : Array.isArray(r.results) ? r.results.length : undefined;
      return count == null ? "" : `${count} result${count === 1 ? "" : "s"}`;
    }
    case "fs_ls": {
      const entries = Array.isArray(r.entries) ? r.entries.length : undefined;
      return entries == null ? "" : `${entries} entr${entries === 1 ? "y" : "ies"}`;
    }
    case "web_fetch": {
      const bytes = typeof r.bytes === "number" ? r.bytes : undefined;
      return bytes == null ? "" : fmtBytes(bytes);
    }
    case "fs_read": {
      const content = typeof r.content === "string" ? r.content.length : undefined;
      return content == null ? "" : fmtBytes(content);
    }
    case "fs_write":
    case "fs_append": {
      const bytes = typeof r.bytes === "number" ? r.bytes : undefined;
      return bytes == null ? "" : fmtBytes(bytes);
    }
    case "fs_grep": {
      const matches = Array.isArray(r.matches) ? r.matches.length : undefined;
      return matches == null ? "" : `${matches} match${matches === 1 ? "" : "es"}`;
    }
    case "report_write": {
      if (typeof r.added === "number") return `${r.added} section${r.added === 1 ? "" : "s"}`;
      return "";
    }
    case "report_remove":
      return typeof r.removed === "string" ? "1 group" : "";
    default:
      return "";
  }
}
