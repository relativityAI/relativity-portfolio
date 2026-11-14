/**
 * Renderer — the event → terminal presentation. One interface, three modes:
 *
 *   live    interactive TTY, compact output: a reconciled activity block with
 *           per-tool one-line updates, a pinned footer, spinner, keys.
 *   append  --verbose/--full: append-only colored lines with the raw data
 *           (full args, full results, full thoughts) — no footer, no cursor
 *           control, safe to pipe.
 *   plain   --plain / piped / CI / NO_COLOR: append-only, zero ANSI, compact
 *           one-line summaries — parseable by scripts.
 *
 * Presentation only: it consumes TraceEvents and step-progress reads; it
 * never mutates the run.
 */

import { pathToFileURL } from "node:url";
import readline from "node:readline";
import type { TraceEvent } from "../types.js";
import type { Verdict } from "../report/verdict.js";
import {
  G,
  COL,
  VERSION,
  accent,
  bold,
  dim,
  detectPlain,
  error as errPaint,
  italic,
  success,
  warn,
} from "./theme.js";
import {
  clip,
  displayWidth,
  fmtBytes,
  fmtMs,
  fmtTokens,
  padEndW,
  padStartW,
  parseCompaction,
  toolLabel,
  toolMetric,
  truncate,
} from "./format.js";
import { finalLine, renderFooter, type FooterInput } from "./footer.js";
import { box, dimLine, errorBox } from "./report.js";

// ── Public shapes ───────────────────────────────────────────────────────────

export interface RunHeader {
  name: string;
  source: string;
  /** Short model id (provider prefix stripped). */
  model: string;
  skills: string[];
  maxSteps: number;
  maxTokens: number;
  /** Dim one-liner: config source, web provider, compaction mode. */
  configLine?: string;
}

export interface StepProgress {
  step: number;
  /** Provider usage — any field may be missing; the UI degrades, never NaN. */
  outputTokens?: number;
}

export interface RunSummary {
  status: "completed" | "partial" | "failed";
  interrupted?: boolean;
  elapsedMs: number;
  steps: number;
  maxSteps: number;
  outputTokens: number;
  maxTokens: number;
  inputTokens: number;
  toolCalls: number;
  toolErrors: number;
  kbFiles: number;
  kbBytes: number;
  sections: number;
  sources: number;
  verdict?: Verdict | null;
  outputPath?: string;
  errors: string[];
}

export interface OutStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

export interface InStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  resume?(): unknown;
  pause?(): unknown;
}

export interface Renderer {
  readonly mode: "live" | "append" | "plain";
  verbose: boolean;
  header(h: RunHeader): void;
  event(e: TraceEvent): void;
  progress(p: StepProgress): void;
  summary(s: RunSummary): void;
  note(text: string): void;
  error(title: string, details?: string[]): void;
  /** Current activity lines (no footer) — tests and resize re-render. */
  snapshot(): string[];
  flush(): void;
  dispose(): void;
  onInterrupt?: () => void;
}

export interface RendererOptions {
  plain?: boolean;
  verbose?: boolean;
  out?: OutStream;
  stdin?: InStream;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** false → no timers/keys; every mutation flushes synchronously (tests). */
  animate?: boolean;
  interactive?: boolean;
}

// ── Activity entries (re-rendered from state — verbose toggle re-draws all) ─

type Entry =
  | { kind: "think"; step: number; text: string; agent?: string }
  | { kind: "tool"; step: number; id: string; tool: string; args: unknown; result?: ToolDone; agent?: string }
  | { kind: "canvas"; step: number; title: string; ok: boolean; sections: number; error?: string; durationMs?: number }
  | { kind: "kb"; step: number; files: number; bytes: number; delta: number }
  | { kind: "note"; step: number; text: string; tone: "dim" | "error" | "compact" };

interface ToolDone {
  status: "ok" | "error";
  result: unknown;
  durationMs: number;
  summary?: string;
}

const PHASE_BY_TOOL: Record<string, string> = {
  web_search: "Gathering evidence",
  search_news: "Gathering evidence",
  web_fetch: "Fetching page",
  fs_read: "Reading",
  fs_ls: "Surveying workspace",
  fs_grep: "Surveying workspace",
  fs_write: "Taking notes",
  fs_append: "Taking notes",
  report_write: "Writing report",
};

function phaseForTool(tool: string): string {
  return PHASE_BY_TOOL[tool] ?? (tool.startsWith("mcp.") || tool.includes("voyager") ? "Fetching data" : `Running ${tool}`);
}

// ── Implementation ──────────────────────────────────────────────────────────

class RunRenderer implements Renderer {
  readonly mode: "live" | "append" | "plain";
  verbose: boolean;
  onInterrupt?: () => void;

  private out: OutStream;
  private stdin?: InStream;
  private now: () => number;
  private animate: boolean;
  private interactive: boolean;

  private entries: Entry[] = [];
  private headerInput?: RunHeader;
  private completedSteps = 0;
  private outTokens?: number;
  private startedAt: number;
  private spinFrame = 0;
  private paused = false;
  private finished = false;
  private painted: string[] = [];
  private running = new Map<string, string>();
  private reportWritten = false;
  private kbPrev?: { files: number; bytes: number };
  private stepKb = new Map<number, number>();
  private stepCompaction = new Map<number, number>();
  private plainArgs = new Map<string, unknown>();
  private maxSteps = 20;
  private maxTokens = 200_000;

  private timer: NodeJS.Timeout | null = null;
  private lastFlush = 0;
  private keyListener?: (str: string | undefined, key: { ctrl?: boolean; name?: string } | undefined) => void;

  constructor(opts: RendererOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.stdin = opts.stdin === undefined ? process.stdin : opts.stdin;
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    this.animate = opts.animate ?? true;
    this.mode = opts.plain ? "plain" : opts.verbose ? "append" : this.out.isTTY ? "live" : "append";
    this.interactive = opts.interactive ?? this.mode === "live";
    this.verbose = !!opts.verbose && this.mode !== "plain";
    if (this.mode === "live" && this.animate) this.startTimer();
    if (this.mode === "live") this.setupKeys();
  }

  // ── Header ───────────────────────────────────────────────────────────────

  header(h: RunHeader): void {
    this.headerInput = h;
    this.maxSteps = h.maxSteps;
    this.maxTokens = h.maxTokens;
    if (this.mode === "live") {
      this.flush();
      return;
    }
    for (const line of this.headerLines(this.width())) this.write(line + "\n");
  }

  private headerLines(width: number): string[] {
    const h = this.headerInput;
    if (!h) return [];
    if (this.mode === "plain") {
      return [
        `${h.name} · ${h.source} · ${h.model} · ${h.maxSteps} steps · ${fmtTokens(h.maxTokens)} tokens`,
        h.configLine ?? "",
      ].filter(Boolean);
    }
    const left = ` RELATIVITY  ${dim("harness")}`;
    const version = dim(`v${VERSION}`);
    const rule = "─".repeat(Math.max(8, width));
    const rowA = splitRow(`${h.name} · ${h.source} equity research`, h.model, width);
    const rowB = splitRow(`${h.maxSteps} steps · ${fmtTokens(h.maxTokens)} tokens`, `skills: ${h.skills.join(", ")}`, width);
    const lines = [left + " ".repeat(Math.max(1, width - displayWidth(left) - displayWidth(version))) + version, rule, rowA, rowB];
    if (h.configLine) lines.push(` ${dim(truncate(h.configLine, width - 2))}`);
    lines.push("");
    return lines;
  }

  // ── Event intake ─────────────────────────────────────────────────────────

  event(e: TraceEvent): void {
    if (this.mode === "plain") return this.plainEvent(e);
    if (this.mode === "append") return this.appendEvent(e);

    switch (e.type) {
      case "tool_call": {
        this.running.set(e.toolCallId, e.tool);
        this.entries.push({ kind: "tool", step: this.nextStep(), id: e.toolCallId, tool: e.tool, args: e.args, agent: e.agent });
        break;
      }
      case "tool_result": {
        this.running.delete(e.toolCallId);
        const entry = this.entries.find((x): x is Extract<Entry, { kind: "tool" }> => x.kind === "tool" && x.id === e.toolCallId);
        if (entry) {
          entry.result = { status: e.status, result: e.result, durationMs: e.durationMs, summary: e.summary };
          if (entry.tool === "report_write" && e.status === "ok") this.reportWritten = true;
        } else {
          // Result without a call (resumed trace) — still show it.
          this.entries.push({
            kind: "tool",
            step: this.nextStep(),
            id: e.toolCallId,
            tool: e.tool,
            args: {},
            agent: e.agent,
            result: { status: e.status, result: e.result, durationMs: e.durationMs, summary: e.summary },
          });
        }
        break;
      }
      case "thought": {
        const text = e.text.trim();
        if (text) this.entries.push({ kind: "think", step: this.nextStep(), text, agent: e.agent });
        break;
      }
      case "kb": {
        const delta = this.kbPrev ? Math.max(0, e.files - this.kbPrev.files) : e.files;
        this.kbPrev = { files: e.files, bytes: e.bytes };
        const step = this.nextStep();
        const idx = this.stepKb.get(step);
        if (idx != null) {
          const kb = this.entries[idx] as Extract<Entry, { kind: "kb" }>;
          kb.files = e.files;
          kb.bytes = e.bytes;
          kb.delta += delta;
        } else {
          this.stepKb.set(step, this.entries.length);
          this.entries.push({ kind: "kb", step, files: e.files, bytes: e.bytes, delta });
        }
        break;
      }
      case "log": {
        const compaction = parseCompaction(e.text);
        const step = this.nextStep();
        if (compaction) {
          const idx = this.stepCompaction.get(step);
          if (idx != null) {
            const note = this.entries[idx] as Extract<Entry, { kind: "note" }>;
            note.text = note.text.includes(compaction) ? note.text : `${note.text} · ${compaction}`;
          } else {
            this.stepCompaction.set(step, this.entries.length);
            this.entries.push({ kind: "note", step, text: compaction, tone: "compact" });
          }
        } else if (/run stats —/.test(e.text)) {
          // End-of-run counters live in the summary — don't double-print.
        } else if (/agent loop (failed|crashed)/.test(e.text)) {
          this.entries.push({ kind: "note", step, text: e.text, tone: "error" });
        } else {
          this.entries.push({ kind: "note", step, text: e.text, tone: "dim" });
        }
        break;
      }
      case "canvas_block": {
        this.entries.push({
          kind: "canvas",
          step: this.nextStep(),
          title: e.taskTitle,
          ok: e.status === "done",
          sections: e.sectionCount,
          error: e.error,
          durationMs: e.durationMs,
        });
        break;
      }
      case "phase":
        break; // footer infers the phase from activity; nothing to print
    }
    this.schedule();
  }

  progress(p: StepProgress): void {
    this.completedSteps = Math.max(this.completedSteps, p.step || 0);
    if (p.outputTokens != null && Number.isFinite(p.outputTokens)) this.outTokens = p.outputTokens;
    this.schedule();
  }

  private nextStep(): number {
    return this.completedSteps + 1;
  }

  // ── Live rendering ───────────────────────────────────────────────────────

  /** The full live block minus the footer — header + activity. */
  snapshot(): string[] {
    const width = this.width();
    const lines: string[] = [...this.headerLines(width)];
    let current: number | null = null;
    for (const e of this.entries) {
      if (e.step !== current) {
        current = e.step;
        lines.push(this.mode === "plain" ? `step ${e.step}` : ` ${accent(G.arrow)} ${bold(`Step ${e.step}`)}`);
      }
      lines.push(...this.entryLines(e, width));
    }
    return lines;
  }

  private entryLines(e: Entry, width: number): string[] {
    switch (e.kind) {
      case "think": {
        const tag = e.agent ? `${dim(`[${e.agent}]`)} ` : "";
        const one = `   ${dim(G.think)} ${tag}${dim("thinking")} ${dim(italic(clip(e.text, Math.max(20, width - 24 - tag.length))))}`;
        if (!this.verbose) return [one];
        return [one, ...wrapContinuation(e.text, width).map((l) => `      ${dim(italic(l))}`)];
      }
      case "tool":
        return this.toolLines(e, width);
      case "canvas": {
        const glyph = e.ok ? success(G.ok) : errPaint(G.err);
        const meta = e.ok ? dim(` ${e.sections} sections`) : "";
        const err = e.error ? errPaint(` ${clip(e.error, Math.max(16, width - 30))}`) : "";
        const dur = e.durationMs != null ? dim(padStartW(fmtMs(e.durationMs), COL.dur)) : "";
        return [`   ${glyph} ${padEndW(e.title, 24)}${meta}${err}${dur ? " " + dur : ""}`];
      }
      case "kb": {
        const parts = [
          e.delta > 0 ? `+${e.delta} this step` : null,
          `${e.files} file${e.files === 1 ? "" : "s"}`,
          fmtBytes(e.bytes),
        ]
          .filter(Boolean)
          .join(" · ");
        return [`   ${dim(G.dot)} ${dim(`kb  ${parts}`)}`];
      }
      case "note": {
        if (e.tone === "compact") return [`   ${dim(G.compact)} ${dim(`compacted context · ${e.text}`)}`];
        if (e.tone === "error") return [`   ${errPaint(G.err)} ${errPaint(clip(e.text, Math.max(20, width - 8)))}`];
        return [`   ${dim(clip(e.text, Math.max(20, width - 6)))}`];
      }
    }
  }

  private toolLines(e: Extract<Entry, { kind: "tool" }>, width: number): string[] {
    const label = (e.agent ? `[${e.agent}] ` : "") + toolLabel(e.tool, e.args);
    const name = padEndW(e.tool, COL.tool);
    if (!e.result) {
      const spin = dim(G.spin[this.spinFrame % G.spin.length]);
      const labelW = Math.max(12, width - COL.lead - COL.tool - COL.gap - 2);
      const lines = [`   ${spin} ${accent(name)} ${dim(clip(label, labelW))}`];
      if (this.verbose) lines.push(...this.detailLines(e.args, null, width));
      return lines;
    }

    const ok = e.result.status === "ok";
    const glyph = ok ? success(G.ok) : errPaint(G.err);
    const metric = ok ? toolMetric(e.tool, e.result.result) : "";
    const dur = fmtMs(e.result.durationMs);
    const rightMetric = metric ? padStartW(metric, COL.metric) + " " : "";
    const right = `${metric ? dim(rightMetric) : ""}${dim(padStartW(dur, COL.dur))}`;
    const leftW = COL.lead + COL.tool + COL.gap;
    // Narrow terminals drop the metric column before anything wraps.
    let labelW = width - leftW - displayWidth(right) - 1;
    let rightStr = right;
    if (labelW < 10 && metric) {
      rightStr = dim(padStartW(dur, COL.dur));
      labelW = width - leftW - displayWidth(rightStr) - 1;
    }
    const labelText = clip(label, Math.max(6, labelW));
    const pad = " ".repeat(Math.max(0, labelW - displayWidth(labelText)));
    const lines = [`   ${glyph} ${name} ${labelText}${pad} ${rightStr}`];
    if (ok && this.verbose && e.result.result != null) lines.push(...this.detailLines(e.args, e.result.result, width));
    if (!ok) {
      const msg = e.result.summary ?? String(e.result.result ?? "");
      lines[0] = `   ${glyph} ${name} ${errPaint(clip(msg, Math.max(10, width - leftW - COL.dur - 2)))} ${dim(padStartW(dur, COL.dur))}`;
      if (this.verbose) lines.push(...this.detailLines(e.args, e.result.result, width));
    }
    return lines;
  }

  /** --verbose / v-toggle detail: full args + result, dim and indented. */
  private detailLines(args: unknown, result: unknown, width: number): string[] {
    const out: string[] = [];
    const show = (value: unknown) => {
      let text: string;
      try {
        text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
      } catch {
        text = String(value);
      }
      return text;
    };
    if (args != null && JSON.stringify(args) !== "{}") {
      out.push(...wrapContinuation(show(args), width).map((l) => `      ${dim(l)}`));
    }
    if (result != null) {
      out.push(...wrapContinuation(show(result), width).map((l) => `      ${dim(l)}`));
    }
    return out;
  }

  // ── Footer ───────────────────────────────────────────────────────────────

  private footerInput(): FooterInput {
    const running = [...this.running.values()];
    const phase = running.length
      ? phaseForTool(running[0])
      : this.reportWritten
        ? "Writing report"
        : this.completedSteps === 0
          ? "Starting"
          : "Researching";
    return {
      phase,
      step: this.completedSteps || undefined,
      maxSteps: this.maxSteps,
      outputTokens: this.outTokens,
      maxTokens: this.maxTokens,
      elapsedMs: this.now() - this.startedAt,
      spinFrame: this.spinFrame,
      paused: this.paused,
      hint: this.interactive,
    };

  }

  // ── Screen painter (live mode) ───────────────────────────────────────────
  // Append-only history + a CAPPED rewrite of only the dirty suffix (oldest
  // line that will change → footer). The old whole-block cursor-up clamped at
  // the screen top once the run outgrew the terminal → blank-line corruption.
  private width(): number {
    return Math.max(40, this.out.columns || 80);
  }

  private schedule(): void {
    if (this.mode !== "live" || this.finished) return;
    if (!this.animate) return this.flushNow();
    const since = this.now() - this.lastFlush;
    if (since >= 50) return this.flushNow();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, 50 - since);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.mode === "live") this.flushNow();
  }

  private flushNow(): void {
    if (this.mode !== "live" || this.finished || this.paused) return;
    this.lastFlush = this.now();
    this.paintTo([...this.snapshot(), ...renderFooter(this.footerInput(), this.width())]);
  }

  /**
   * Diff `target` against the painted screen and rewrite only from the first
   * changed line to the bottom. Cursor-up is capped at `cap` rows so the
   * reach can never exceed the screen.
   *
   * ponytail: a dirty line buried under >cap newer lines freezes stale in
   * history (and a mid-run `v` toggle only re-styles subsequent lines).
   * Both only happen on pathological runs; per-line addressing if ever needed.
   */
  private paintTo(target: string[]): void {
    const painted = this.painted;
    let d = 0;
    while (d < painted.length && d < target.length && painted[d] === target[d]) d++;
    const cap = Math.max(8, (this.out.rows ?? 24) - 4);
    const from = Math.min(Math.max(d, target.length - cap, painted.length - cap), painted.length);
    const rows = target.slice(from);
    const oldTail = Math.max(0, painted.length - from);
    const n = Math.max(rows.length, oldTail);
    let out = "";
    // Cursor sits on the last painted row; step to row `from` — up over the
    // old tail, down one on pure growth (else new rows would overwrite it).
    const move = painted.length ? from - painted.length + 1 : 0;
    if (move < 0) out += `\x1b[${-move}A`;
    else if (move > 0) out += "\r\n".repeat(move);
    for (let i = 0; i < n; i++) {
      const line = rows[i];
      if (line === undefined) out += "\r\x1b[2K";
      else if (from + i >= painted.length || painted[from + i] !== line) out += "\r\x1b[2K" + line;
      if (i < n - 1) out += "\r\n";
    }
    // Shrank (footer → final line): climb back off the cleared rows.
    if (oldTail > rows.length) out += `\x1b[${oldTail - rows.length}A`;
    out += "\r";
    this.out.write(out);
    this.painted = target;
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.spinFrame++;
      this.flushNow();
    }, 80);
    this.timer.unref?.();
  }

  private setupKeys(): void {
    const stdin = this.stdin;
    if (!this.interactive || !stdin?.isTTY || typeof stdin.setRawMode !== "function" || typeof stdin.on !== "function") return;
    readline.emitKeypressEvents(stdin as NodeJS.ReadStream);
    stdin.setRawMode(true);
    stdin.resume?.();
    this.keyListener = (str, key) => {
      if (key?.ctrl && key.name === "c") {
        this.onInterrupt?.();
        return;
      }
      if (str === "v") {
        this.verbose = !this.verbose;
        this.flushNow();
      } else if (str === " ") {
        this.paused = !this.paused;
        if (!this.paused) this.flushNow();
      }
    };
    stdin.on("keypress", this.keyListener);
  }

  // ── Append mode (verbose: raw data, no footer, no cursor control) ────────

  private appendEvent(e: TraceEvent): void {
    const width = this.width();
    switch (e.type) {
      case "phase":
        this.write(`\n${accent(G.diamond)} ${bold(e.phase.toUpperCase())} ${bold(e.label)}${e.detail ? dim(` — ${e.detail}`) : ""}\n`);
        break;
      case "thought": {
        const first = clip(e.text.trim(), Math.max(20, width - 8));
        this.write(`${dim(G.think)} ${e.agent ? dim(`[${e.agent}] `) : ""}${dim(italic(first))}\n`);
        if (e.text.includes("\n")) this.write(wrapContinuation(e.text, width).map((l) => dim(l)).join("\n") + "\n");
        break;
      }
      case "tool_call": {
        this.write(` ${e.agent ? dim(`[${e.agent}] `) : ""}${accent(e.tool)}${e.summary ? dim(` — ${e.summary}`) : ""}\n`);
        if (this.verbose && e.args != null && JSON.stringify(e.args) !== "{}") {
          this.write(wrapContinuation(jsonOf(e.args), width).map((l) => dim(l)).join("\n") + "\n");
        }
        break;
      }
      case "tool_result": {
        const ok = e.status === "ok";
        const glyph = ok ? success(G.ok) : errPaint(G.err);
        const metric = ok ? toolMetric(e.tool, e.result) : "";
        this.write(` ${glyph} ${e.agent ? dim(`[${e.agent}] `) : ""}${e.tool}${metric ? dim(` ${metric}`) : ""}${dim(` ${fmtMs(e.durationMs)}`)}${e.summary && !ok ? dim(` — ${e.summary}`) : ""}\n`);
        if (this.verbose) {
          const lines = jsonOf(e.result).split("\n").map((l) => dim(l));
          this.write(box(lines) + "\n");
        }
        break;
      }
      case "kb":
        this.write(dim(` ${G.dot} kb ${e.files} files · ${fmtBytes(e.bytes)}`) + "\n");
        break;
      case "log": {
        const compaction = parseCompaction(e.text);
        if (compaction) this.write(` ${dim(G.compact)} ${dim(`compacted context · ${compaction}`)}\n`);
        else this.write(`${dim("·")} ${dim(clip(e.text, width - 2))}\n`);
        break;
      }
      case "canvas_block": {
        const glyph = e.status === "done" ? success(G.ok) : errPaint(G.err);
        this.write(` ${glyph} ${bold(e.taskTitle)}${e.status === "done" ? dim(` (${e.sectionCount} blocks)`) : ""}${e.error ? errPaint(` — ${e.error}`) : ""}\n`);
        break;
      }
    }
  }

  // ── Plain mode (piped: zero ANSI, one line per action) ───────────────────

  private plainEvent(e: TraceEvent): void {
    switch (e.type) {
      case "tool_call":
        this.plainArgs.set(e.toolCallId, e.args); // one line per call, printed at result time
        break;
      case "tool_result": {
        const label = toolLabel(e.tool, this.plainArgs.get(e.toolCallId) ?? {});
        this.plainArgs.delete(e.toolCallId);
        const metric = e.status === "ok" ? toolMetric(e.tool, e.result) : "";
        const parts = [e.tool, label, metric, fmtMs(e.durationMs)].filter(Boolean);
        if (e.agent) parts.unshift(`[${e.agent}]`);
        if (e.status === "error") parts.push(`error: ${clip(e.summary ?? String(e.result ?? ""), 120)}`);
        // ponytail: hard clip — long workspace paths would blow the width invariant
        this.write(clip(parts.join(" · "), this.width()) + "\n");
        break;
      }
      case "thought": {
        const first = clip(e.text.trim(), 160);
        if (first) this.write(`thinking${e.agent ? ` [${e.agent}]` : ""} ${first}\n`);
        break;
      }
      case "kb": {
        const delta = this.kbPrev ? Math.max(0, e.files - this.kbPrev.files) : e.files;
        this.kbPrev = { files: e.files, bytes: e.bytes };
        this.write(`kb ${delta > 0 ? `+${delta} this step · ` : ""}${e.files} file${e.files === 1 ? "" : "s"} · ${fmtBytes(e.bytes)}\n`);
        break;
      }
      case "log": {
        if (/run stats —/.test(e.text)) break;
        const compaction = parseCompaction(e.text);
        if (compaction) this.write(`${G.compact} compacted context · ${compaction}\n`);
        else this.write(`${clip(e.text, 200)}\n`);
        break;
      }
      case "canvas_block":
        this.write(`${e.status === "done" ? G.ok : G.err} ${e.taskTitle} · ${e.sectionCount} sections${e.error ? ` · ${e.error}` : ""}\n`);
        break;
      case "phase":
        break;
    }
  }

  // ── Summary / notes / errors ─────────────────────────────────────────────

  summary(s: RunSummary): void {
    this.finished = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const width = this.width();
    const state = s.interrupted ? "interrupted" : s.status === "completed" ? "complete" : s.status === "partial" ? "partial" : "failed";
    const rows = this.summaryRows(s, width, state);

    if (this.mode === "plain") {
      const label = s.interrupted ? "interrupted" : state === "complete" ? "report complete" : `report ${state}`;
      this.write(
        `${label} · ${s.steps} steps · ${fmtTokens(s.outputTokens)} tokens · ${s.toolCalls} tool call${s.toolCalls === 1 ? "" : "s"} · ${s.toolErrors} error${s.toolErrors === 1 ? "" : "s"} · ${fmtBytes(s.kbBytes)}\n`,
      );
      for (const line of rows) this.write(line + "\n");
      return;
    }

    if (this.mode === "append") {
      this.write("\n" + finalLine({ state, elapsedMs: s.elapsedMs, verdict: s.verdict, width }) + "\n");
      this.write("─".repeat(Math.min(width, 72)) + "\n");
      for (const line of rows) this.write(line + "\n");
      return;
    }

    // live: replace the footer with the final line, then append the summary.
    this.paintTo([...this.snapshot(), finalLine({ state, elapsedMs: s.elapsedMs, verdict: s.verdict, width })]);
    let out = "\r\n" + "─".repeat(Math.min(width, 72)) + "\r\n";
    for (const line of rows) out += line + "\r\n";
    if (s.errors.length) {
      for (const err of s.errors.slice(0, 3)) out += ` ${errPaint(clip(err, width - 2))}\r\n`;
    }
    this.out.write(out);
    this.painted = [];
  }

  private summaryRows(s: RunSummary, width: number, state: string): string[] {
    // Plain mode never paints — piped output stays byte-clean.
    const label = this.mode === "plain" ? (t: string) => t : dim;
    const bad = this.mode === "plain" ? (t: string) => t : state === "partial" ? warn : errPaint;
    const rows: string[] = [];
    rows.push(label(padEndW("steps", 12)) + `${s.steps} / ${s.maxSteps}`);
    rows.push(
      label(padEndW("tokens", 12)) +
        `${fmtTokens(s.outputTokens)} / ${fmtTokens(s.maxTokens)}   (in ${fmtTokens(s.inputTokens)} · out ${fmtTokens(s.outputTokens)})`,
    );
    rows.push(label(padEndW("tools", 12)) + `${s.toolCalls} call${s.toolCalls === 1 ? "" : "s"} · ${s.toolErrors} error${s.toolErrors === 1 ? "" : "s"}`);
    rows.push(label(padEndW("workspace", 12)) + `${s.kbFiles} files · ${fmtBytes(s.kbBytes)}`);
    rows.push(label(padEndW("sections", 12)) + `${s.sections}`);
    if (s.verdict) rows.push(label(padEndW("verdict", 12)) + s.verdict);
    if (s.outputPath) {
      const link = this.mode === "live" ? osc8(s.outputPath) : s.outputPath;
      const hint = this.mode === "live" && state !== "failed" && state !== "interrupted" ? "   (cmd-click to open)" : "";
      rows.push(label(padEndW("output", 12)) + truncate(link + hint, width - 14));
    }
    if (s.status !== "completed" && !s.interrupted && s.errors.length) {
      rows.push(label(padEndW("status", 12)) + bad(clip(s.errors[0], width - 16)));
    }
    return rows;
  }

  note(text: string): void {
    if (this.mode === "plain") this.write(` ${text}\n`);
    else this.write(dimLine(text) + "\n");
  }

  error(title: string, details: string[] = []): void {
    this.write(errorBox(title, details) + "\n");
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const stdin = this.stdin;
    if (this.keyListener && typeof stdin?.removeListener === "function") stdin.removeListener("keypress", this.keyListener);
    if (stdin?.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
      stdin.pause?.();
    }
  }

  private write(chunk: string): void {
    this.out.write(chunk);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonOf(value: unknown): string {
  try {
    return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    return String(value);
  }
}

function wrapContinuation(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && displayWidth(line) + 1 + displayWidth(word) > width - 6) {
        lines.push(line);
        line = "";
      }
      let chunk = word;
      while (displayWidth(chunk) > width - 6) {
        let cut = "";
        for (const ch of chunk) {
          if (displayWidth(cut + ch) > width - 6) break;
          cut += ch;
        }
        lines.push(cut);
        chunk = chunk.slice(cut.length);
      }
      line = line ? `${line} ${chunk}` : chunk;
    }
    lines.push(line);
  }
  return lines;
}

/** `left … right` with the right column flush to the terminal edge. */
function splitRow(left: string, right: string, width: number): string {
  const r = truncate(right, Math.max(10, Math.floor(width / 2)));
  const l = truncate(left, Math.max(8, width - displayWidth(r) - 3));
  const pad = Math.max(2, width - displayWidth(l) - displayWidth(r) - 2);
  return ` ${l}${" ".repeat(pad)}${r}`;
}

/** OSC 8 hyperlink — clickable where the terminal supports it. */
function osc8(path: string): string {
  let url: string;
  try {
    url = pathToFileURL(path).href;
  } catch {
    return path;
  }
  return `\x1b]8;;${url}\x1b\\${path}\x1b]8;;\x1b\\`;
}

export function createRenderer(opts: RendererOptions = {}): Renderer {
  const out = opts.out ?? process.stdout;
  if (detectPlain(out, opts.plain)) return new RunRenderer({ ...opts, out, plain: true, verbose: false });
  if (opts.verbose) return new RunRenderer({ ...opts, out, plain: false, verbose: true });
  return new RunRenderer({ ...opts, out, plain: false, verbose: false });
}
