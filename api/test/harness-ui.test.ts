import { afterEach, describe, expect, it } from "vitest";

// Colors on before the theme's module-level capture (FORCE_COLOR only affects
// painting — plain-mode detection still keys off isTTY/CI/NO_COLOR).
process.env.FORCE_COLOR = "1";
delete process.env.CI;
delete process.env.NO_COLOR;

const { createRenderer } = await import("../src/harness/ui/renderer.js");
const { stripAnsi, displayWidth } = await import("../src/harness/ui/format.js");
const { statusLine, renderFooter } = await import("../src/harness/ui/footer.js");
const { VERSION } = await import("../src/harness/ui/theme.js");
import type { TraceEvent } from "../src/harness/types.js";
import type { Renderer } from "../src/harness/ui/renderer.js";

interface FakeOut {
  write(c: string): boolean;
  isTTY?: boolean;
  columns?: number;
}

function fakeOut(columns: number, isTTY = true): { out: FakeOut; chunks: string[] } {
  const chunks: string[] = [];
  const out: FakeOut = {
    write(c: string) {
      chunks.push(c);
      return true;
    },
    isTTY,
    columns,
  };
  return { out, chunks };
}

/** The same fake run the demo plays: parallel calls, thinking, kb, compaction, failure. */
function play(r: Renderer): void {
  const ev = (e: TraceEvent) => r.event(e);
  r.header({
    name: "AAPL",
    source: "SEC",
    model: "deepseek-v4.1-flash",
    skills: ["dcf-valuation"],
    maxSteps: 20,
    maxTokens: 30_000,
    configLine: "config: harness.config.json · web: searxng · compaction: clear + summarize",
  });
  ev({ type: "phase", phase: "run", label: "Agent", detail: "x" });
  ev({ type: "tool_call", tool: "web_search", toolCallId: "t1", args: { query: "AAPL Q4 FY2026 results" } });
  ev({
    type: "tool_result",
    tool: "web_search",
    toolCallId: "t1",
    status: "ok",
    durationMs: 822,
    result: { count: 5, results: [{ title: "Apple Q4 2026" }] },
  });
  ev({ type: "tool_call", tool: "fs_ls", toolCallId: "t2", args: { path: "/knowledge_base/sources" } });
  ev({ type: "tool_result", tool: "fs_ls", toolCallId: "t2", status: "ok", durationMs: 3, result: { entries: ["a"] } });
  ev({ type: "kb", files: 1, bytes: 8_900 });
  r.progress({ step: 1, outputTokens: 1_800 });
  ev({ type: "thought", text: "Need FY21–22 FCF and market cap for the multiples cross-check." });
  ev({ type: "tool_call", tool: "web_search", toolCallId: "t3", args: { query: "AAPL statistics market cap PE ratio" } });
  ev({ type: "tool_call", tool: "web_search", toolCallId: "t4", args: { query: "Microsoft Alphabet Meta forward PE" } });
  ev({ type: "tool_result", tool: "web_search", toolCallId: "t3", status: "ok", durationMs: 714, result: { count: 5, results: [] } });
  ev({ type: "tool_result", tool: "web_search", toolCallId: "t4", status: "ok", durationMs: 822, result: { count: 5, results: [] } });
  ev({ type: "tool_call", tool: "fs_read", toolCallId: "t5", args: { path: "/knowledge_base/sources/AAPL_capex_fiscal_2025.json" } });
  ev({
    type: "tool_result",
    tool: "fs_read",
    toolCallId: "t5",
    status: "ok",
    durationMs: 5,
    result: { content: "x".repeat(2_765) },
  });
  ev({ type: "kb", files: 29, bytes: 92_037 });
  ev({ type: "log", text: "compaction: clearing active — 3 old tool result(s) replaced with workspace pointers (kept last 3)" });
  r.progress({ step: 2, outputTokens: 6_400 });
  ev({ type: "tool_call", tool: "fs_read", toolCallId: "t6", args: { path: "/knowledge_base/sources/missing.json" } });
  ev({
    type: "tool_result",
    tool: "fs_read",
    toolCallId: "t6",
    status: "error",
    durationMs: 2,
    result: { error: "no such file: /knowledge_base/sources/missing.json" },
    summary: "no such file: /knowledge_base/sources/missing.json",
  });
  ev({ type: "tool_call", tool: "report_write", toolCallId: "t7", args: { title: "DCF & comps", sections: [{}, {}, {}], sources: [] } });
  ev({
    type: "tool_result",
    tool: "report_write",
    toolCallId: "t7",
    status: "ok",
    durationMs: 4_100,
    result: { added: 3, rejected: [], sourceIds: ["s1"], totalSections: 3 },
  });
  r.progress({ step: 3, outputTokens: 9_200 });
}

const SUMMARY = {
  status: "completed" as const,
  elapsedMs: 134_200,
  steps: 9,
  maxSteps: 20,
  outputTokens: 21_300,
  maxTokens: 30_000,
  inputTokens: 17_900,
  toolCalls: 14,
  toolErrors: 1,
  kbFiles: 29,
  kbBytes: 92_037,
  sections: 9,
  sources: 29,
  verdict: "Good" as const,
  outputPath: "./runs/2026-10-31T12-00-00-000Z-AAPL/2026-10-31T12-00-00-000Z-AAPL.md",
  errors: [],
};

afterEach(() => {
  delete process.env.CI;
});

describe("live layout", () => {
  for (const w of [60, 80, 120]) {
    it(`fits ${w} columns — every line of the final block and summary ≤ width`, () => {
      const { out, chunks } = fakeOut(w);
      const r = createRenderer({ out, stdin: undefined, animate: false });
      play(r);
      r.flush();
      const mid = stripAnsi(chunks.join("")).split(/\r\n|\n|\r/);
      for (const line of mid) expect(displayWidth(line), JSON.stringify(line)).toBeLessThanOrEqual(w);
      chunks.length = 0;
      r.summary(SUMMARY);
      const end = stripAnsi(chunks.join("")).split(/\r\n|\n|\r/);
      for (const line of end) expect(displayWidth(line), JSON.stringify(line)).toBeLessThanOrEqual(w);
      r.dispose();
    });
  }

  it("header shows version, symbol, model, budget, skills — no config dump", () => {
    const { out } = fakeOut(80);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    play(r);
    const snap = stripAnsi(r.snapshot().join("\n"));
    expect(snap).toContain(VERSION);
    expect(snap).toContain("AAPL · SEC equity research");
    expect(snap).toContain("deepseek-v4.1-flash");
    expect(snap).toContain("20 steps · 30.0k tokens");
    expect(snap).toContain("skills: dcf-valuation");
    expect(snap).not.toContain("system prompt"); // the old 12-row dump is gone
    r.dispose();
  });

  it("each tool call is exactly one line in its final state; parallel calls are siblings", () => {
    const { out } = fakeOut(100);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    play(r);
    const snap = stripAnsi(r.snapshot().join("\n")).split("\n");
    const toolLines = snap.filter((l) => /web_search|fs_read|fs_ls|report_write/.test(l));
    expect(toolLines.filter((l) => l.includes("web_search"))).toHaveLength(3);
    expect(toolLines.filter((l) => l.includes("report_write"))).toHaveLength(1);
    for (const l of toolLines) expect(l).toMatch(/[✓✗]/); // all resolved, no spinner rows
    expect(snap.some((l) => l.includes('"AAPL statistics market cap PE ratio"') && l.includes("714ms"))).toBe(true);
    expect(snap.some((l) => l.includes('"Microsoft Alphabet Meta forward PE"') && l.includes("822ms"))).toBe(true);
    r.dispose();
  });

  it("renders step dividers, dim thinking, kb growth and compaction as single lines", () => {
    const { out } = fakeOut(100);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    play(r);
    const snap = stripAnsi(r.snapshot().join("\n")).split("\n");
    expect(snap.some((l) => /▸ Step 1/.test(l))).toBe(true);
    expect(snap.some((l) => /▸ Step 2/.test(l))).toBe(true);
    expect(snap.some((l) => l.includes("◦ thinking") && l.includes("Need FY21–22 FCF"))).toBe(true);
    expect(snap.some((l) => l.includes("● kb") && l.includes("29 files") && l.includes("89.9 KB"))).toBe(true);
    expect(snap.some((l) => l.includes("⟲ compacted context · cleared 3 old tool results"))).toBe(true);
    expect(snap.filter((l) => l.includes("compacted context"))).toHaveLength(1);
    expect(snap.some((l) => l.includes("✗") && l.includes("no such file"))).toBe(true);
    r.dispose();
  });

  it("shows the footer with step/token counter and hides it from the activity snapshot", () => {
    const { out, chunks } = fakeOut(80);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    play(r);
    const block = stripAnsi(chunks.join("")).split("\n");
    const footer = block.find((l) => l.includes("step 3/20"));
    expect(footer).toBeDefined();
    expect(footer).toContain("9,200/30.0k");
    expect(footer).toMatch(/00:00/);
    expect(footer).toContain("Writing report"); // report_write drives the phase
    expect(stripAnsi(r.snapshot().join("\n"))).not.toContain("step 3/20"); // footer is not an activity line
    r.dispose();
  });

  it("re-measures on resize — the next flush fits the new width", () => {
    const { out } = fakeOut(120);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    play(r);
    (out as { columns?: number }).columns = 60;
    r.flush();
    for (const line of stripAnsi(r.snapshot().join("\n")).split("\n")) {
      expect(displayWidth(line), JSON.stringify(line)).toBeLessThanOrEqual(60);
    }
    r.dispose();
  });
});

describe("footer", () => {
  const base = { phase: "Researching", maxSteps: 20, maxTokens: 30_000, elapsedMs: 38_000, spinFrame: 3 };

  it("omits the token segment when the provider reported no usage — never NaN", () => {
    const line = statusLine({ ...base, step: 4, outputTokens: undefined });
    expect(line).toContain("step 4/20");
    expect(line).not.toContain("NaN");
    expect(line).not.toContain("▰");
  });

  it("omits the step segment until one finishes", () => {
    const line = statusLine({ ...base, step: undefined, outputTokens: 100 });
    expect(line).not.toContain("step");
    expect(line).toContain("100/30.0k");
  });

  it("turns yellow past 80% and red past 95% of the token budget", () => {
    const yellow = renderFooter({ ...base, outputTokens: 25_000 }, 80).join("\n");
    const red = renderFooter({ ...base, outputTokens: 29_500 }, 80).join("\n");
    const calm = renderFooter({ ...base, outputTokens: 5_000 }, 80).join("\n");
    expect(yellow).toContain("\x1b[33m");
    expect(red).toContain("\x1b[31m");
    expect(calm).not.toContain("\x1b[33m");
    expect(calm).not.toContain("\x1b[31m");
  });

  it("stays within width and adds a key hint on wide terminals", () => {
    for (const w of [60, 80, 120]) {
      const lines = renderFooter({ ...base, step: 4, outputTokens: 12_400, hint: true }, w);
      for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(w);
      expect(lines[1]).toContain("ctrl+c");
    }
    expect(renderFooter({ ...base, hint: true }, 40)).toHaveLength(1); // no hint on narrow
  });
});

describe("plain mode (piped / CI / --plain)", () => {
  it("--plain: zero ANSI, one line per action, no footer, no spinner", () => {
    const { out, chunks } = fakeOut(80, true); // even on a TTY, --plain wins
    const r = createRenderer({ out, plain: true, stdin: undefined, animate: false });
    play(r);
    r.summary(SUMMARY);
    const text = chunks.join("");
    expect(text).not.toContain("\x1b");
    expect(text).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇▱▰▸●◆]/);
    const lines = text.split("\n");
    expect(lines.filter((l) => l.includes("web_search"))).toHaveLength(3);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(80);
    expect(text).toContain('web_search · "AAPL Q4 FY2026 results" · 5 results · 822ms');
    expect(text).toContain("report complete · 9 steps · 21.3k tokens");
    expect(text).toMatch(/verdict\s+Good/); // quality verdict rides the summary
    expect(text).not.toContain("cmd-click"); // no TTY affordances in pipes
    r.dispose();
  });

  it("CI=true forces plain mode even on a TTY", () => {
    process.env.CI = "true";
    const { out, chunks } = fakeOut(80, true);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    expect(r.mode).toBe("plain");
    play(r);
    expect(chunks.join("")).not.toContain("\x1b");
    r.dispose();
  });

  it("non-TTY stdout auto-falls back to plain", () => {
    const { out } = fakeOut(80, false);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    expect(r.mode).toBe("plain");
    r.dispose();
  });
});

describe("verbose mode (--verbose / --full)", () => {
  it("shows full args and results, no footer, append-only", () => {
    const { out, chunks } = fakeOut(80, true);
    const r = createRenderer({ out, verbose: true, stdin: undefined, animate: false });
    play(r);
    const text = chunks.join("");
    expect(r.mode).toBe("append");
    expect(text).not.toContain("step 3/20"); // footer-free
    expect(text).toContain('"query": "AAPL Q4 FY2026 results"'); // raw args restored
    expect(text).toContain('"added": 3'); // raw result restored
    expect(text).toContain("╭"); // result boxes are back
    const cursorUp = new RegExp("\\x1b\\[\\d+[AB]");
    expect(text).not.toMatch(cursorUp); // no cursor control — pipe-safe
    r.dispose();
  });
});

// ── The blank-line regression: a run taller than the screen ────────────────
// The old whole-block painter cursor-up'd by the full run length; past
// screen height the move clamped at the top and blanked rows every tick.

function fakeOutRows(columns: number, rows: number): { out: FakeOut; chunks: string[] } {
  const base = fakeOut(columns);
  (base.out as { rows?: number }).rows = rows;
  return base;
}

/** Minimal terminal: cursor move/clear/print + scroll on bottom-row LF. */
function emulate(stream: string, cols: number, rows: number): string[] {
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(""));
  let r = 0;
  let c = 0;
  const scroll = () => {
    grid.shift();
    grid.push(Array(cols).fill(""));
  };
  let i = 0;
  while (i < stream.length) {
    if (stream[i] === "\x1b") {
      const osc = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(stream.slice(i));
      if (osc) {
        i += osc[0].length;
        continue;
      }
      const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(stream.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const n = m[1] === "" ? 1 : Number(m[1]);
      if (m[2] === "A") r = Math.max(0, r - n);
      else if (m[2] === "B") r = Math.min(rows - 1, r + n);
      else if (m[2] === "K" && n === 2) grid[r] = Array(cols).fill("");
      i += m[0].length;
      continue;
    }
    const ch = stream[i];
    if (ch === "\r") c = 0;
    else if (ch === "\n") {
      c = 0;
      if (r === rows - 1) scroll();
      else r++;
    } else {
      if (c >= cols) c = cols - 1;
      grid[r][c] = ch;
      c++;
    }
    i++;
  }
  return grid.map((row) => row.join("").trimEnd());
}

describe("long run — screen-height regression", () => {
  it("never cursor-ups past the cap; final screen has the summary and no blank floods", () => {
    const ROWS = 24;
    const { out, chunks } = fakeOutRows(80, ROWS);
    const r = createRenderer({ out, stdin: undefined, animate: false });
    r.header({
      name: "AAPL",
      source: "SEC",
      model: "deepseek-v4.1-flash",
      skills: ["dcf-valuation"],
      maxSteps: 20,
      maxTokens: 30_000,
      configLine: "config: harness.config.json · web: searxng · compaction: clear + summarize",
    });
    // 15 steps × 4 calls = 60 tool lines + dividers/thoughts — far past 24 rows.
    for (let s = 1; s <= 15; s++) {
      const ids: string[] = [];
      for (let t = 0; t < 4; t++) {
        const id = `s${s}t${t}`;
        ids.push(id);
        r.event({ type: "tool_call", tool: "web_search", toolCallId: id, args: { query: `q${s}.${t} long query text here` } });
      }
      for (const id of ids) {
        r.event({ type: "tool_result", tool: "web_search", toolCallId: id, status: "ok", durationMs: 100, result: { count: 5, results: [] } });
      }
      r.event({ type: "thought", text: `step ${s} reasoning about the evidence gathered so far` });
      r.progress({ step: s, outputTokens: s * 1_000 });
      r.flush();
    }
    r.summary({ ...SUMMARY, steps: 15, toolCalls: 60, outputTokens: 15_000 });
    r.dispose();

    const stream = chunks.join("");
    // Regression guard: cursor reach is bounded, never the full run length.
    const ups = [...stream.matchAll(/\x1b\[(\d+)A/g)].map((m) => Number(m[1]));
    expect(Math.max(0, ...ups)).toBeLessThanOrEqual(ROWS - 4);

    const screen = emulate(stream, 80, ROWS);
    // Summary pinned at the bottom (cursor parks on a fresh row below it)…
    expect(screen.slice(-2).join("\n")).toContain("output");
    expect(screen.join("\n")).toContain("Report complete · Good");
    // …and no blank flood anywhere visible (the bug was runs of blank rows).
    for (let i = 2; i < ROWS; i++) {
      const run = [screen[i - 2], screen[i - 1], screen[i]];
      expect(run.some((l) => l !== ""), JSON.stringify(run)).toBe(true);
    }
    // Activity is still visible right above the summary.
    expect(screen.join("\n")).toMatch(/step 15 reasoning/);
  });
});
