import { describe, it, expect } from "vitest";
import { builderResponseSchema } from "../src/builder.js";
import { aggregateWeightedScores } from "../src/scoring.js";
import { voyagerCircuitBreaker } from "../src/voyager.js";

describe("Eval Harness & Circuit Breaker Tests", () => {
  describe("builderResponseSchema validation", () => {
    it("validates a complete builder response structure", () => {
      const sample = {
        message: "I have updated the agent configuration for CAN SLIM strategy.",
        options: [
          { id: "opt_1", label: "Focus on Earnings", description: "Prioritize EPS growth > 25%" },
          { id: "opt_2", label: "Focus on RS Index", description: "Require Relative Strength > 80" },
        ],
        agent_draft_update: {
          philosophy: "CAN SLIM Growth Investing",
          asset_evaluation: {
            qualitative: [
              { parameter: "Market Leadership", content: "Industry top 3 company", weightage: 8 },
            ],
          },
        },
        thinking: "Extracted CAN SLIM principles from search results",
        annotations: [
          { what: "Market Leadership", basis: "Investor's Business Daily (https://investors.com)" },
        ],
      };

      const parsed = builderResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.message).toContain("CAN SLIM");
        expect(parsed.data.options?.length).toBe(2);
        expect(parsed.data.annotations?.[0].basis).toContain("https://investors.com");
      }
    });

    it("rejects invalid builder response missing required message", () => {
      const invalid = {
        options: [],
      };
      const parsed = builderResponseSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Honest scoring (plan 0.3: unknown ≠ 0)", () => {
    it("includeMissingAsZero counts missing data as zero with weight (opt-in only)", () => {
      const items = [
        { score: 100, weightage: 5 },
        { score: null, weightage: 5, unscored_reason: "missing_data" as const },
      ];
      // (100*5 + 0*5) / (5 + 5) = 50; coverage 0.5; band [0, 100]
      const res = aggregateWeightedScores(items, { includeMissingAsZero: true });
      expect(res.score).toBe(50);
      expect(res.totalWeight).toBe(10);
      expect(res.coverage).toBe(0.5);
      expect(res.fit_low).toBe(50);
      expect(res.fit_high).toBe(100);
    });

    it("default treats errored parameters as UNSCORED, not zero and not excluded silently", () => {
      const items = [
        { score: 80, weightage: 5 },
        { score: null, weightage: 5, unscored_reason: "error" as const },
      ];
      // Point estimate over scored only: 80. Coverage 0.5; band [40, 90].
      const res = aggregateWeightedScores(items);
      expect(res.score).toBe(80);
      expect(res.totalWeight).toBe(5);
      expect(res.coverage).toBe(0.5);
      expect(res.fit_low).toBe(40);
      expect(res.fit_high).toBe(90);
    });

    it("zero-weight items are excluded, never defaulted to 5 (plan A2)", () => {
      const items = [
        { score: 10, weightage: 0 },
        { score: 80, weightage: 5 },
      ];
      const res = aggregateWeightedScores(items);
      expect(res.score).toBe(80);
      expect(res.coverage).toBe(1);
    });

    it("a real score of 1 no longer becomes 100 (plan A1)", () => {
      const res = aggregateWeightedScores([
        { score: 1, weightage: 5 },
        { score: 60, weightage: 5 },
      ]);
      expect(res.score).toBe(30.5);
    });
  });

  describe("Cockatiel Voyager Circuit Breaker", () => {
    it("circuit breaker policy exists and executes wrapped tasks", async () => {
      let count = 0;
      const res = await voyagerCircuitBreaker.execute(async () => {
        count++;
        return "success";
      });
      expect(res).toBe("success");
      expect(count).toBe(1);
    });
  });
});
