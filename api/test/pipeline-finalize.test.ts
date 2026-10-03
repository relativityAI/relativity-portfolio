/**
 * The four shipped failure modes, as assertions.
 *
 * Every case here is a bug that reached production: a completed analysis with
 * no headline score, no executive summary, plots with no narrative, or a
 * scorecard that vanished after the gate retry. One file, table-driven — the
 * pipeline had 500+ passing tests and none of them touched finalize.
 */

import { describe, it, expect } from "vitest";
import { finalizeReport } from "../src/skills/finalize.js";
import { aggregateSkillOutputs, isScoreDisplayable } from "../src/skills/aggregate.js";
import { buildSourcesBlocks } from "../src/agent.js";
import type { AnalysisReport, ReportBlock } from "../src/agent.js";
import type { SkillOutput } from "../src/skills/types.js";

// A facts pack whose computed readings make "overbought" a factual error.
const FACTS = [
  "price=1402.35",
  "rsi14=36.45",
  "sma20=1390.10 sma50=1410.20 sma200=1380.00",
  "level map: ok",
  "volume_ratio_max=1.1",
  "READING rsi: daily=36.45 (neutral); weekly=52.52 (neutral)",
  "READING ma_stack: mixed",
  "READING regime: pullback",
  "READING vwap: price is below vwap",
].join("\n");

const cleanNarrative = (): AnalysisReport => ({
  heroPct: 71,
  heroLabel: "bullish",
  source: "llm",
  blocks: [
    { type: "heading", level: 2, text: "Summary" },
    { type: "paragraph", text: "Revenue grew across the last four reported quarters." },
  ],
});

const scoreTable = (): ReportBlock => ({
  type: "table",
  title: "Skill scores",
  columns: ["Skill", "Score"],
  rows: [["Valuation", 71]],
  sourceKeys: ["code:aggregate.per_skill"],
} satisfies ReportBlock);

const known = new Set([71]);

function skillOutput(over: Partial<SkillOutput> = {}): SkillOutput {
  return {
    skill_id: "dcf-valuation",
    skill_name: "DCF Valuation",
    category: "valuation",
    weight: 5,
    findings: [{ title: "WACC", detail: "Cost of equity implied at 11.2%.", citations: [] }],
    verdicts: [{ anchor: "The discount rate is defensible", verdict: "YES", evidence: "WACC 11.2% vs peers 10-13%." }],
    chart_requests: [],
    tools_used: ["get_financial_metrics"],
    citations: [{ source: "get_financial_metrics", value: "wacc=11.2" }],
    raw_observations: [],
    scored_by: "llm",
    ...over,
  };
}

describe("finalizeReport — the gate cannot delete the report", () => {
  it("keeps the report and the code blocks when the gate still fails", async () => {
    // The narrative calls RSI "overbought" — a real contradiction, and exactly
    // the kind of thing that used to end with blockedReport() replacing
    // everything the pipeline had computed.
    const narrative: AnalysisReport = {
      ...cleanNarrative(),
      blocks: [
        ...cleanNarrative().blocks,
        { type: "paragraph", text: "Momentum is overbought after the recent rally." },
      ],
    };
    const regenerate = async () => narrative; // same prose: the retry fails too

    const { report, gate } = await finalizeReport({
      narrative,
      factsPack: FACTS,
      codeBlocks: [scoreTable()],
      known,
      totalScore: 71,
      regenerate,
    });

    expect(gate.pass).toBe(false);
    expect(report.blocks.length).toBeGreaterThan(1);
    // The scorecard survives a failed gate.
    expect(report.blocks.some((b) => b.type === "table" && b.title === "Skill scores")).toBe(true);
    expect(report.blocks.some((b) => b.type === "paragraph" && /Revenue grew/.test((b as any).text))).toBe(true);
    // The failure is surfaced as a caution, not a silent deletion.
    expect(report.blocks[0]).toMatchObject({ type: "callout", tone: "caution" });
    expect(report.blocks[0].type === "callout" && /contradicts/.test(report.blocks[0].text)).toBe(true);
  });

  it("gates the narrative only — raw tool text in Sources cannot void it", async () => {
    // A web snippet that happens to say "overbought". It lives in the Sources
    // section, so the gate must never see it.
    const outputs = [
      skillOutput({
        raw_observations: [
          {
            tool: "search_news",
            result: JSON.stringify([{ title: "Brokerage note", content: "The stock looks overbought after a 40% run." }]),
            status: "ok",
          },
        ],
        citations: [{ source: "search_news", url: "https://example.com/n", value: "looks overbought" }],
      }),
    ];
    const sourceBlocks = buildSourcesBlocks(outputs);
    expect(sourceBlocks.length).toBeGreaterThan(0);

    const { report, gate } = await finalizeReport({
      narrative: cleanNarrative(),
      factsPack: FACTS,
      codeBlocks: [...sourceBlocks, scoreTable()],
      known,
      totalScore: 71,
      // A regenerate that would otherwise be triggered must not be needed.
      regenerate: async () => {
        throw new Error("regenerate must not be called when the narrative is clean");
      },
    });

    expect(gate.pass).toBe(true);
    expect(report.blocks.some((b) => b.type === "heading" && b.text === "Sources")).toBe(true);
  });

  it("keeps the code blocks when a regeneration passes the gate", async () => {
    // The old code appended scoreTables inside the pre-regeneration branch, so
    // a passing regeneration replaced the report with bare prose.
    const dirty: AnalysisReport = {
      ...cleanNarrative(),
      blocks: [...cleanNarrative().blocks, { type: "paragraph", text: "The regime is an aligned downtrend." }],
    };
    const { report, gate } = await finalizeReport({
      narrative: dirty,
      factsPack: FACTS,
      codeBlocks: [scoreTable()],
      known,
      totalScore: 71,
      regenerate: async () => cleanNarrative(),
    });

    expect(gate.pass).toBe(true);
    expect(report.blocks.some((b) => b.type === "table" && b.title === "Skill scores")).toBe(true);
    expect(report.blocks.some((b) => b.type === "paragraph" && /Revenue grew/.test((b as any).text))).toBe(true);
    expect(report.heroPct).toBe(71);
  });

  it("clamps the hero to our deterministic total, not the model's", async () => {
    const { report } = await finalizeReport({
      narrative: { ...cleanNarrative(), heroPct: 97 },
      factsPack: FACTS,
      codeBlocks: [],
      known,
      totalScore: 71,
    });
    expect(report.heroPct).toBe(71);
  });
});

describe("aggregation — a dead skill no longer suppresses the headline", () => {
  const good = skillOutput();

  it("coverage is measured against declared anchors, not returned verdicts", () => {
    // 1 verdict returned, 4 anchors declared → 25% coverage, not 100%.
    const agg = aggregateSkillOutputs([skillOutput({ anchor_count: 4 })]);
    expect(agg.per_skill[0].coverage).toBeCloseTo(0.25, 5);
  });

  it("an errored skill is excluded from the run coverage average", () => {
    // One good skill (all 4 anchors assessed) + one errored skill.
    // Old formula: (1.0 + 0) / 2 = 0.5 → below the 0.6 floor → no score at all.
    const outputs = [
      skillOutput({
        anchor_count: 4,
        verdicts: [
          { anchor: "a", verdict: "YES", evidence: "x" },
          { anchor: "b", verdict: "YES", evidence: "x" },
          { anchor: "c", verdict: "YES", evidence: "x" },
          { anchor: "d", verdict: "YES", evidence: "x" },
        ],
      }),
      skillOutput({ skill_id: "moat", skill_name: "Moat", error: "model refused tools", verdicts: [] }),
    ];
    const agg = aggregateSkillOutputs(outputs, { "dcf-valuation": 5, moat: 5 });
    expect(agg.scored_count).toBe(1);
    expect(agg.coverage).toBe(1);
    expect(isScoreDisplayable(agg)).toBe(true);
    expect(agg.total_score).toBe(100);
  });

  it("still suppresses the score when the scoring skill really is thin", () => {
    const outputs = [
      skillOutput({
        anchor_count: 4,
        verdicts: [
          { anchor: "a", verdict: "YES", evidence: "x" },
          { anchor: "b", verdict: "INSUFFICIENT", evidence: "no data" },
          { anchor: "c", verdict: "INSUFFICIENT", evidence: "no data" },
          { anchor: "d", verdict: "INSUFFICIENT", evidence: "no data" },
        ],
      }),
    ];
    const agg = aggregateSkillOutputs(outputs);
    expect(agg.coverage).toBeCloseTo(0.25, 5);
    expect(isScoreDisplayable(agg)).toBe(false);
    // The score itself still exists — it is only withheld from display.
    expect(agg.total_score).toBe(100);
  });

  it("INSUFFICIENT is never counted as a NO", () => {
    const agg = aggregateSkillOutputs([
      skillOutput({ verdicts: [{ anchor: "a", verdict: "INSUFFICIENT", evidence: "no data" }] }),
    ]);
    expect(agg.per_skill[0].score_0_100).toBe(null);
    expect(agg.per_skill[0].verdict_counts.insufficient).toBe(1);
  });
});