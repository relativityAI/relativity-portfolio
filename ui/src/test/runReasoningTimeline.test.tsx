import { describe, it, expect, beforeAll } from "vitest";
import type { ReactElement } from "react";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { render, screen } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import RunReasoningTimeline from "../components/report/RunReasoningTimeline";
import type { TraceEvent } from "../pages/shared/TracePanel";

function wrap(ui: ReactElement) {
  return (
    <ChakraProvider value={createSystem(defaultConfig)}>
      <ThemeProvider attribute="class" defaultTheme="dark">{ui}</ThemeProvider>
    </ChakraProvider>
  );
}

let seq = 0;
const ev = (e: Omit<TraceEvent, "seq" | "ts" | "key">): TraceEvent => ({ seq: ++seq, ts: Date.now(), key: "k", ...e });

describe("RunReasoningTimeline", () => {
  it("renders phases, human summaries, durations, and friendly errors — no raw dumps", () => {
    seq = 0;
    const events: TraceEvent[] = [
      ev({ type: "phase", phase: "plan", label: "Planning the report", detail: "Breaking the analysis into sections" }),
      ev({ type: "log", text: "3 sections planned: Thesis · Levels · Summary" }),
      ev({ type: "phase", phase: "research", label: "Research session 1 of 3", detail: "Gathering evidence for: Thesis" }),
      ev({ type: "tool_call", tool: "get_price_history", tool_call_id: "c1", args: { symbol: "KEI" }, summary: "Fetching price history: KEI" }),
      ev({ type: "tool_result", tool: "get_price_history", tool_call_id: "c1", status: "OK", result: { close: 2950 }, duration_ms: 1400 }),
      ev({ type: "tool_call", tool: "fs_write", tool_call_id: "c2", args: { path: "/knowledge_base/t1-thesis/s1.md" }, summary: "Adding note: Thesis" }),
      ev({ type: "tool_result", tool: "fs_write", tool_call_id: "c2", status: "OK", result: { path: "…" }, duration_ms: 30 }),
      ev({ type: "thought", text: "The trend is ranging per the technicals record." }),
      ev({ type: "phase", phase: "compose", label: "Writing the report", detail: "3 sections from the research evidence" }),
      ev({ type: "canvas_block", key: "t1", label: "Thesis", status: "done", sectionCount: 4, duration_ms: 8200, summary: "Section written (4 blocks)" }),
      ev({ type: "canvas_block", key: "t2", label: "Levels", status: "failed", sectionCount: 0, duration_ms: 4100, summary: "Section could not be written", error: "Model provider quota exhausted — the provider asked to retry in 45s" }),
    ];

    render(wrap(<RunReasoningTimeline events={events} active={false} />));

    // Phase headers
    expect(screen.getByText("Planning the report")).toBeTruthy();
    expect(screen.getByText("Research session 1 of 3")).toBeTruthy();
    expect(screen.getByText("Writing the report")).toBeTruthy();

    // Human tool summaries + durations
    expect(screen.getByText("Fetching price history: KEI")).toBeTruthy();
    expect(screen.getByText("1.4s")).toBeTruthy();
    expect(screen.getByText("Adding note: Thesis")).toBeTruthy();
    expect(screen.getByText("30ms")).toBeTruthy();

    // Section outcomes with durations
    expect(screen.getByText("Thesis — Section written (4 blocks)")).toBeTruthy();
    expect(screen.getByText("8.2s")).toBeTruthy();
    expect(screen.getByText("Levels — not written")).toBeTruthy();

    // Friendly error, not the raw Google quota dump
    expect(screen.getByText(/quota exhausted/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("ai.google.dev");
    expect(document.body.textContent).not.toContain("generativelanguage");

    // Thinking block
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText(/trend is ranging/i)).toBeTruthy();

    // Raw tool names never surface as labels
    expect(screen.queryByText("fs_write")).toBeNull();
    expect(screen.queryByText("get_price_history")).toBeNull();
  });

  it("shows a running row as pending and the working footer while active", () => {
    seq = 0;
    const events: TraceEvent[] = [
      ev({ type: "phase", phase: "research", label: "Research session 1 of 3" }),
      ev({ type: "tool_call", tool: "get_technicals_summary", tool_call_id: "c9", args: { symbol: "KEI" }, summary: "Fetching technicals: KEI" }),
    ];
    render(wrap(<RunReasoningTimeline events={events} active />));
    expect(screen.getByText("Fetching technicals: KEI")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    // no duration shown while running
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)?(ms|s)\b/);
  });

  it("renders the empty state", () => {
    seq = 0;
    render(wrap(<RunReasoningTimeline events={[]} active />));
    expect(screen.getByText("Starting…")).toBeTruthy();
  });
});
