import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { parseSkillMarkdown } from "../src/harness/skills/loader.js";
import { clampBudget, runAnalysis, type RunCanvasOptions, type ToolDefinition } from "../src/harness/index.js";
import { PlanSchema, validatePlan, SECTION_TOOL } from "../src/harness/plan/plan.js";
import { runPlanAnalysis, verdictFromScores } from "../src/harness/plan/run.js";

const SKILL_MD = `---
name: test-skill
description: fixture skill
tools:
  - get_fundamentals
metadata:
  title: Test
  category: custom
---

# Body
`;

const skill = parseSkillMarkdown(SKILL_MD, "custom").skill!;

const dataTool: ToolDefinition = {
  name: "get_fundamentals",
  description: "fundamentals",
  parameters: z.object({ symbol: z.string() }),
  execute: async () => ({ pe: 25, revenue: [1, 2, 3] }),
};

const PLAN = {
  version: "1.0.0",
  planId: "plan_aapl",
  target: { entity: "AAPL", domain: "stock_analysis" },
  executionMode: "map_reduce",
  tasks: [
    { id: "fetch", name: "Fetch Fundamentals", description: "d", tool: "get_fundamentals", input: { symbol: "AAPL" }, dependsOn: [] },
    { id: "s1", name: "Valuation", description: "d", tool: SECTION_TOOL, input: { sectionId: "valuation" }, dependsOn: ["fetch"] },
    { id: "s2", name: "Trend", description: "d", tool: SECTION_TOOL, input: { sectionId: "trend" }, dependsOn: ["fetch"] },
  ],
};

const section = (heading: string) => ({
  heading: { level: 2, text: heading },
  blocks: [
    { type: "text", level: 1, text: "The claim." },
    { type: "text", level: 2, text: "The detail." },
  ],
});
const source = (id: string) => ({ id, label: "Fundamentals", tool: "get_fundamentals", value: "pe 25" });

/** call 1 = plan, calls 2+ = section drafts (score 8 and 6 → avg 7 → Good). */
const scriptedModel = (seenPrompts?: string[]) => {
  let n = 0;
  const replies = [
    JSON.stringify(PLAN),
    JSON.stringify({ sections: [section("Valuation")], sources: [source("s1")], score: 8 }),
    JSON.stringify({ sections: [section("Trend")], sources: [source("s2")], score: 6 }),
  ];
  return new MockLanguageModelV4({
    doGenerate: async (opts: any) => {
      seenPrompts?.push(JSON.stringify(opts?.prompt ?? opts));
      return {
        content: [{ type: "text", text: replies[Math.min(n++, replies.length - 1)] }],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        rawResponse: { headers: {} },
        warnings: [],
      } as any;
    },
  });
};

const neverModel = new MockLanguageModelV4({
  doGenerate: async () => {
    throw new Error("model must not be called");
  },
});

const opts = (model: any, skills = [skill]): RunCanvasOptions => ({
  model,
  soul: "",
  skills,
  prompt: "Analyze AAPL (SEC).",
  tools: [dataTool],
  ctx: { symbol: "AAPL", source: "SEC" },
  budget: clampBudget(undefined),
});

describe("SKILL.md tools: frontmatter", () => {
  it("parses a tools list", () => {
    expect(skill.tools).toEqual(["get_fundamentals"]);
  });

  it("rejects a non-list tools value", () => {
    const bad = `---\nname: bad\ndescription: d\ntools: get_fundamentals\n---\n`;
    const { skill: s, issues } = parseSkillMarkdown(bad, "custom");
    expect(s).toBeNull();
    expect(issues.some((i) => /tools must be a list/.test(i.message))).toBe(true);
  });
});

describe("validatePlan", () => {
  const parse = () => PlanSchema.parse(PLAN);

  it("accepts a well-formed plan", () => {
    expect(validatePlan(parse(), [dataTool])).toEqual([]);
  });

  it("rejects unknown tools, cycles, and plans without sections", () => {
    const unknown = parse();
    unknown.tasks[0].tool = "get_quote";
    expect(validatePlan(unknown, [dataTool]).join()).toMatch(/unknown tool "get_quote"/);

    const cyclic = parse();
    cyclic.tasks[0].dependsOn = ["s1"];
    expect(validatePlan(cyclic, [dataTool]).join()).toMatch(/cycle/);

    const noSections = parse();
    noSections.tasks = [noSections.tasks[0]];
    expect(validatePlan(noSections, [dataTool]).join()).toMatch(/generate_section/);
  });

  it("rejects inputs that fail the tool's own zod schema", () => {
    const bad = parse();
    bad.tasks[0].input = { ticker: "AAPL" };
    expect(validatePlan(bad, [dataTool]).join()).toMatch(/get_fundamentals schema/);
  });
});

describe("verdictFromScores", () => {
  it("maps the score average onto the five bands", () => {
    expect(verdictFromScores([8, 6])).toBe("Good");
    expect(verdictFromScores([9, 9])).toBe("Excellent");
    expect(verdictFromScores([5, 6])).toBe("Fair");
    expect(verdictFromScores([4, 5])).toBe("Poor");
    expect(verdictFromScores([1, 2])).toBe("Very Poor");
    expect(verdictFromScores([])).toBeNull();
  });
});

describe("runPlanAnalysis", () => {
  it("stops without a model call when the skill declares no tools", async () => {
    const bare = parseSkillMarkdown("---\nname: bare\ndescription: d\n---\n", "custom").skill!;
    const res = await runPlanAnalysis(opts(neverModel, [bare]));
    expect(res.status).toBe("failed");
    expect(res.errors.join()).toMatch(/declares no tools/);
  });

  it("plans, executes tools to the KB, drafts sections in parallel, assembles", async () => {
    const seen: string[] = [];
    // through the run seam (engine.ts) — this doubles as the v2 dispatch check
    const res = await runAnalysis({ ...opts(scriptedModel(seen)), saveWorkspace: true }, "v2");
    expect(res.status).toBe("completed");
    expect(res.document.sections.map((s) => s.heading.text)).toEqual(["Valuation", "Trend"]);
    // score average (8+6)/2 = 7 → Good, computed in code — no grading call
    expect(res.verdict).toBe("Good");
    // data tool results were archived into the knowledge base
    expect(res.budgetUsed.kbFiles).toBeGreaterThan(0);
    expect(Object.keys(res.workspace).some((p) => p.startsWith("/knowledge_base/"))).toBe(true);
    // the plan file records every task completed, with scores
    const saved = JSON.parse(res.workspace["/workspace/plan.json"]);
    expect(saved.tasks.every((t: any) => t.status === "completed")).toBe(true);
    // drafts run in parallel, so task→score order is not guaranteed
    expect(saved.tasks.filter((t: any) => t.score != null).map((t: any) => t.score).sort()).toEqual([6, 8]);
    // full memfs (incl. raw payloads) materializes when saveWorkspace is on
    expect(Object.keys(res.workspaceFull ?? {}).some((p) => p.startsWith("/knowledge_base/sources/raw/"))).toBe(true);
    // draft prompts carry the evidence inline (no KB re-reads) — the stub view of the data tool
    expect(seen.some((p) => p.includes("revenue") && p.includes("Do NOT fs_read"))).toBe(true);
  });

  it("keeps a bare sections array and a draft that omitted the score (no wasted regeneration)", async () => {
    let n = 0;
    const replies = [
      JSON.stringify(PLAN),
      JSON.stringify([section("Solo")]), // envelope missing — top-level array
      JSON.stringify({ sections: [section("Scored")], sources: [source("s1")], score: 7 }),
    ];
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        ({
          content: [{ type: "text", text: replies[Math.min(n++, replies.length - 1)] }],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          rawResponse: { headers: {} },
          warnings: [],
        }) as any,
    });
    const res = await runPlanAnalysis(opts(model));
    expect(res.status).toBe("completed");
    expect(res.document.sections).toHaveLength(2);
    // verdict averages only the sections that actually scored (7 → Good)
    expect(res.verdict).toBe("Good");
  });

  it("recovers a draft whose real envelope follows a stray leading object", async () => {
    const env = (name: string, score: number) =>
      `{"note":"thinking out loud"}\n${JSON.stringify({ sections: [section(name)], sources: [source("s1")], score })}`;
    let n = 0;
    const replies = [JSON.stringify(PLAN), env("First", 6), env("Second", 8)];
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        ({
          content: [{ type: "text", text: replies[Math.min(n++, replies.length - 1)] }],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          rawResponse: { headers: {} },
          warnings: [],
        }) as any,
    });
    const res = await runPlanAnalysis(opts(model));
    expect(res.status).toBe("completed");
    expect(res.document.sections).toHaveLength(2);
    expect(res.verdict).toBe("Good"); // (6+8)/2 = 7
  });
});
