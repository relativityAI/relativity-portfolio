import { describe, it, expect } from "vitest";
import { sectionToMarkdown, parseSection, type AgentShape } from "../lib/sectionMarkdown";
import { agentToMarkdown, parseAgentMarkdown, skillsMarkdown } from "../lib/sectionMarkdown";

const agent: AgentShape = {
    name: "Test Agent",
    source: "NSE",
    persona: { philosophy_and_mindset: "We seek durable moats." },
    asset_evaluation: {
        qualitative: [{ parameter: "Management Quality", content: "Track record matters.", weightage: 8 }],
        quantitative: [{ metric_name: "ROE", operator: "gt", value: 20, weightage: 7 }],
    },
    macro_evaluation: {
        qualitative: [],
        quantitative: [{ metric_name: "CPI", operator: "between", value: [2, 5], weightage: 6 }],
    },
};

describe("sectionMarkdown", () => {
    it("generates persona markdown that round-trips", () => {
        const md = sectionToMarkdown("persona", agent);
        expect(md).toContain("## Philosophy");
        expect(md).toContain("We seek durable moats.");

        const res = parseSection("persona", md);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.merged.persona?.philosophy_and_mindset).toBe("We seek durable moats.");
    });

    it("generates configuration frontmatter without strategy/risk fields", () => {
        const md = sectionToMarkdown("configuration", agent);
        expect(md).toContain("name: Test Agent");
        expect(md).not.toContain("investment_horizon");
        expect(md).not.toContain("risk_appetite");

        const res = parseSection("configuration", md);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.merged.name).toBe("Test Agent");
    });

    it("round-trips asset evaluation qualitative + quantitative", () => {
        const md = sectionToMarkdown("asset_evaluation", agent);
        expect(md).toContain("#### Management Quality — weight 8");
        expect(md).toContain("| ROE | > 20 | 7 |");

        const res = parseSection("asset_evaluation", md);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.merged.asset_evaluation?.qualitative).toHaveLength(1);
            expect(res.merged.asset_evaluation?.qualitative?.[0]?.parameter).toBe("Management Quality");
            expect(res.merged.asset_evaluation?.qualitative?.[0]?.weightage).toBe(8);
            expect(res.merged.asset_evaluation?.quantitative?.[0]?.operator).toBe("gt");
            expect(res.merged.asset_evaluation?.quantitative?.[0]?.value).toBe(20);
        }
    });

    it("round-trips between rules in macro evaluation", () => {
        const md = sectionToMarkdown("macro_evaluation", agent);
        const res = parseSection("macro_evaluation", md);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.merged.macro_evaluation?.quantitative?.[0]?.operator).toBe("between");
            expect(res.merged.macro_evaluation?.quantitative?.[0]?.value).toEqual([2, 5]);
        }
    });

    it("blocks apply on unrecognised structure", () => {
        const res = parseSection("asset_evaluation", "## Asset Evaluation\n\n### Qualitative\n\nbogus text");
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.issues.length).toBeGreaterThan(0);
    });
});
// --- whole-agent markdown (v3) ------------------------------------------------
describe("agentToMarkdown / parseAgentMarkdown", () => {
    const v3: AgentShape = {
        name: "Value Rider",
        persona: { philosophy: "I buy durable compounders and refuse litigation risk." },
        skills: [
            { skill_id: "moat-analysis", weight: 8 },
            { skill_id: "dcf-valuation", weight: 6 },
        ],
    };

    it("never emits an empty document (the regression that broke the raw editor)", () => {
        const md = agentToMarkdown(v3);
        expect(md).toContain("## Philosophy");
        expect(md).toContain("## Skills");
        expect(md).toContain("moat-analysis");
        expect(md.trim().length).toBeGreaterThan(0);
    });

    it("round-trips name, philosophy and skills — no strategy/risk emitted", () => {
        const md = agentToMarkdown(v3);
        expect(md).not.toContain("risk_appetite");
        expect(md).not.toContain("investment_horizon");
        const res = parseAgentMarkdown(md);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.merged.name).toBe("Value Rider");
        expect(res.merged.persona?.philosophy).toBe(v3.persona.philosophy);
        expect(res.merged.skills).toEqual(v3.skills);
    });

    it("parses weights and defaults a missing one to 5", () => {
        const res = parseAgentMarkdown(
            "---\nname: X\nrisk_appetite: 3\n---\n\n## Skills\n\n- alpha — weight 9\n- beta\n",
        );
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.merged.skills).toEqual([
                { skill_id: "alpha", weight: 9 },
                { skill_id: "beta", weight: 5 },
            ]);
        }
    });

    it("round-trips an agent with no skills and no philosophy", () => {
        const bare: AgentShape = {
            name: "Bare",
            persona: { philosophy: "" },
            skills: [],
        };
        const res = parseAgentMarkdown(agentToMarkdown(bare));
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.merged.skills).toEqual([]);
            expect(res.merged.persona?.philosophy).toBe("");
        }
    });

    it("rejects a document with no frontmatter", () => {
        const res = parseAgentMarkdown("## Philosophy\n\nno frontmatter here");
        expect(res.ok).toBe(false);
    });

    it("rejects a missing name and ignores legacy strategy/risk keys", () => {
        expect(parseAgentMarkdown("---\nrisk_appetite: 5\n---\n\n## Philosophy\n\nx").ok).toBe(false);
        const legacy = parseAgentMarkdown("---\nname: X\nrisk_appetite: 99\n---\n\n## Philosophy\n\nx");
        expect(legacy.ok).toBe(true);
        if (legacy.ok) expect(legacy.merged.name).toBe("X");
    });

    it("emits a standalone skills block for the export bundle", () => {
        expect(skillsMarkdown(v3)).toContain("- moat-analysis — weight 8");
        expect(skillsMarkdown({ skills: [] })).toContain("(no skills attached)");
    });
});
