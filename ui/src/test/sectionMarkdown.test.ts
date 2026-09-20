import { describe, it, expect } from "vitest";
import { sectionToMarkdown, parseSection, type AgentShape } from "../lib/sectionMarkdown";

const agent: AgentShape = {
    name: "Test Agent",
    source: "NSE",
    configuration: { investment_horizon: "Swing", risk_appetite: 5 },
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

    it("generates configuration frontmatter that round-trips", () => {
        const md = sectionToMarkdown("configuration", agent);
        expect(md).toContain("investment_horizon: Swing");
        expect(md).toContain("risk_appetite: 5");

        const res = parseSection("configuration", md);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.merged.configuration?.investment_horizon).toBe("Swing");
            expect(res.merged.configuration?.risk_appetite).toBe(5);
        }
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