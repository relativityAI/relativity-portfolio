import { describe, expect, it } from "vitest";

// Colors (and thus renderMarkdown's styling) only apply when enabled — force
// them on before the module's top-level `colorsEnabled` capture.
process.env.FORCE_COLOR = "1";

const { renderMarkdown, reportBox, errorBox, kbTree } = await import("../src/harness/ui/report.js");
const { fmtBytes, fmtTokens, fmtDur, fmtMs, truncate, displayWidth, stripAnsi, toolLabel, toolMetric, parseCompaction } = await import(
  "../src/harness/ui/format.js"
);

describe("renderMarkdown", () => {
  it("styles headings, callouts, chart placeholders and **bold**; keeps tables literal", () => {
    const out = renderMarkdown(
      ["# Title", "> [warn] careful", "**strong** and plain", "| a | b |", "| --- |", "[chart] px — price", "plain text"].join("\n"),
    );
    expect(out).toContain("\x1b[1m# Title\x1b[22m");
    expect(out).toContain("\x1b[33m> [warn] careful\x1b[39m");
    expect(out).toContain("\x1b[1mstrong\x1b[22m and plain");
    expect(out).toContain("| a | b |");
    expect(out).toContain("\x1b[2m| --- |\x1b[22m");
    expect(out).toContain("\x1b[2m[chart] px — price\x1b[22m");
    expect(out.split("\n").at(-1)).toBe("plain text");
  });
});

describe("formatters", () => {
  it("formats B/KB/MB", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("formats tokens, durations, and latency", () => {
    expect(fmtTokens(820)).toBe("820");
    expect(fmtTokens(12_400)).toBe("12.4k");
    expect(fmtTokens(1_200_000)).toBe("1.2M");
    expect(fmtDur(38_000)).toBe("00:38");
    expect(fmtDur(134_000)).toBe("02:14");
    expect(fmtMs(714)).toBe("714ms");
    expect(fmtMs(4_100)).toBe("4.1s");
  });

  it("truncates by display width (emoji-safe)", () => {
    expect(displayWidth("🌐")).toBe(2);
    expect(truncate("🌐🌐🌐", 5)).toBe("🌐🌐…");
    expect(displayWidth(truncate("🌐🌐🌐", 5))).toBe(5);
    expect(truncate("short", 20)).toBe("short");
  });

  it("summarizes tool calls and results", () => {
    expect(toolLabel("web_search", { query: "AAPL market cap" })).toBe('"AAPL market cap"');
    expect(toolLabel("fs_read", { path: "/knowledge_base/sources/raw/AAPL_capex.json" })).toBe("AAPL_capex.json");
    expect(toolMetric("web_search", { count: 5, results: [] })).toBe("5 results");
    expect(toolMetric("fs_read", { content: "x".repeat(2765) })).toBe("2.7 KB");
    expect(toolMetric("fs_ls", { entries: ["a"] })).toBe("1 entry");
    expect(toolMetric("report_write", { added: 3 })).toBe("3 sections");
  });

  it("parses compaction logs", () => {
    expect(parseCompaction("compaction: clearing active — 3 old tool result(s) replaced with workspace pointers (kept last 3)")).toBe(
      "cleared 3 old tool results",
    );
    expect(parseCompaction("compaction: summarized older context — last step input 90,000 > 86,400 token threshold")).toBe(
      "summarized older messages",
    );
    expect(parseCompaction("run stats — done")).toBeNull();
  });
});

describe("box bounds (the shattered-rows fix)", () => {
  it("no box line may exceed the terminal — mega words hard-broken, borders aligned", () => {
    const prev = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 92, configurable: true });
    try {
      const vis = (l: string) => displayWidth(l);
      // svg style attrs / urls are single words wider than the gutter
      const mega = `<svg><text style="${"fill:var(--mid,#5A6270);".repeat(20)}">x</text></svg>`;
      for (const out of [
        reportBox(renderMarkdown(`## Head\n${mega}\n${"x".repeat(400)}`)).split("\n"),
        errorBox("report warnings", ["numbers not backed by any source: " + "1.97, ".repeat(40)]).split("\n"),
      ]) {
        for (const l of out) expect(vis(l)).toBeLessThanOrEqual(92);
        expect(new Set(out.map(vis)).size).toBe(1); // every border the same width
      }
    } finally {
      Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    }
  });
});

describe("reportBox", () => {
  it("boxes markdown lines", () => {
    const out = reportBox("# Title\nbody text");
    expect(out).toContain("╭");
    expect(out).toContain("# Title");
    expect(out).toContain("╰");
  });
});

describe("writeWorkspaceRun (run.saveWorkspace flag)", () => {
  it("materializes the full memfs as runs/<id>/workspace/", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeWorkspaceRun } = await import("../src/harness/cli.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-export-"));
    try {
      const runFile = path.join(dir, "2026-10-31T00-00-00Z-AAPL.json");
      fs.writeFileSync(runFile, "{}");
      writeWorkspaceRun(runFile, {
        "/AGENTS.md": "rules",
        "/knowledge_base/sources/raw/x.json": "{}",
        "/workspace/plan.json": '{"items":[]}',
      });
      const root = path.join(dir, "2026-10-31T00-00-00Z-AAPL", "workspace");
      expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe("rules");
      expect(fs.readFileSync(path.join(root, "knowledge_base/sources/raw/x.json"), "utf8")).toBe("{}");
      expect(fs.readFileSync(path.join(root, "workspace/plan.json"), "utf8")).toContain("items");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveRun writes everything inside runs/<id>/ — no loose files outside folders", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { saveRun } = await import("../src/harness/cli.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-save-"));
    try {
      const runFile = await saveRun({ symbol: "AAPL", status: "completed" }, dir);
      // <dir>/<id>/<id>.json — dump lives inside its own folder
      expect(runFile).toMatch(/\.json$/);
      expect(path.dirname(runFile)).toMatch(/AAPL$/);
      expect(fs.readFileSync(runFile, "utf8")).toContain("completed");
      // nothing sits loose in runs/ itself: every entry is a folder
      const entries = fs.readdirSync(dir);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => fs.statSync(path.join(dir, e)).isDirectory())).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kbTree", () => {
  const paths = [
    "/control/plan.md",
    "/memory/AGENTS.md",
    "/sources/AAPL_web_search_apple-q4.json",
    "/sources/raw/AAPL_web_search_apple-q4.json",
    "/knowledge_base/t1-trend-and-structure/s3.md",
    "/AGENTS.md",
  ];

  it("renders a directory tree, one line per item, dirs before files", () => {
    const lines = kbTree(paths).split("\n").map(stripAnsi);
    expect(lines.filter((l) => l.includes("── "))).toHaveLength(12); // 6 files + 6 dirs, each once
    expect(lines.some((l) => l.startsWith("├── 📁 control/"))).toBe(true); // no heading — starts at root
    expect(lines.some((l) => l.includes("── 📁 raw/") && l.includes("│"))).toBe(true);
    expect(lines.join("\n")).toContain("s3.md");
    expect(lines.findIndex((l) => l.includes("control/"))).toBeLessThan(
      lines.findIndex((l) => l.includes("plan.md")),
    );
  });

  it("fits narrow terminals — items truncate, never wrap", () => {
    const prev = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 44, configurable: true });
    try {
      const long = stripAnsi(kbTree(["/sources/" + "a-very-long-source-file-name-that-overflows.json"]));
      for (const l of long.split("\n")) expect(displayWidth(l)).toBeLessThanOrEqual(44);
      expect(long.split("\n")).toHaveLength(2); // dir + one truncated file line
      expect(long).toContain("…");
    } finally {
      Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    }
  });
});

describe("kbTree metadata column", () => {
  it("file counts for dirs, sizes for files, one start-aligned column", () => {
    const record: Record<string, string> = {
      "/sources/AAPL_web_search_q.json": "x".repeat(2048),
      "/sources/raw/different-name.json": "y".repeat(1024),
      "/plan.md": "z".repeat(100),
    };
    const lines = kbTree(record).split("\n").map(stripAnsi);
    expect(lines.find((l) => l.includes("📁 sources/"))).toContain("2 files"); // recursive count
    expect(lines.find((l) => l.includes("📁 raw/"))).toContain("1 files");
    expect(lines.find((l) => l.includes("AAPL_web_search_q.json"))).toContain("2.0 KB");
    expect(lines.find((l) => l.includes("plan.md"))).toContain("100 B");
    const metaRows = lines.filter((l) => /(files| B|KB)$/.test(l.trim()));
    const starts = new Set(
      metaRows.map((l) => {
        const meta = l.split(" ").slice(-2).join(" ");
        return l.length - meta.length;
      }),
    );
    expect(starts.size, JSON.stringify(metaRows)).toBe(1); // one column for every meta
    expect([...starts][0]).toBe(72); // width 80 − metaW("2 files"=7) − 1
  });
});
