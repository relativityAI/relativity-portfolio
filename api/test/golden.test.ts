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

  describe("Scoring Symmetry", () => {
    it("computes quantitative score with missing data as zero", () => {
      const items = [
        { score: 1.0, weightage: 5 },
        { score: 0.0, weightage: 5, error: "missing_data" },
      ];
      // (1*5 + 0*5) / (5 + 5) = 5/10 = 0.5 -> 50%
      const res = aggregateWeightedScores(items, { includeMissingAsZero: true });
      expect(res.score).toBe(50);
      expect(res.totalWeight).toBe(10);
    });

    it("computes qualitative score excluding errored parameters", () => {
      const items = [
        { score: 80, weightage: 5 },
        { score: 0, weightage: 5, error: "LLM timeout" },
      ];
      // Excludes errored item: 80*5 / 5 = 80
      const res = aggregateWeightedScores(items, { includeMissingAsZero: false });
      expect(res.score).toBe(80);
      expect(res.totalWeight).toBe(5);
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
