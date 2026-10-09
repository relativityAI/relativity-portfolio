import { describe, it, expect } from "vitest";
import { buildReportPdf } from "./latex.js";

describe("buildReportPdf", () => {
  it("produces a valid PDF buffer", async () => {
    const run = {
      symbol: "RELIANCE",
      source: "NSE",
      share_name: "Reliance Industries",
      run_mode: "agent",
      total_score: 72,
      coverage: { scored: 18, total: 20 },
      agent_name: "value-investor",
      report: {
        blocks: [
          { type: "heading", level: 2, text: "Executive Summary" },
          { type: "paragraph", text: "Strong cash flows and reasonable valuation." },
          { type: "callout", tone: "positive", text: "Fit score 72/100" },
        ],
      },
      trace: [{ type: "thought", text: "Inspected coverage before synthesis." }],
    };
    const buf = await buildReportPdf(run);
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
