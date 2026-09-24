import { describe, it, expect } from "vitest";
import { validateRubric, rubricHash, type CompiledRubric } from "../src/rubric.js";

const rubric: CompiledRubric = {
  name: "test-rubric",
  version: "1",
  parameters: [
    {
      section: "asset_evaluation",
      criteria: [
        {
          id: "roe-min",
          title: "Return on equity",
          kind: "predicate",
          weightage: 3,
          requires: ["roe_annual"],
          expr: { ">=": [{ var: "roe_annual" }, 15] },
        },
      ],
    },
  ],
};

describe("validateRubric", () => {
  it("accepts a well-formed rubric", () => {
    expect(validateRubric(rubric)).toHaveLength(0);
  });

  it("accepts a judge criterion", () => {
    expect(
      validateRubric({
        ...rubric,
        parameters: [
          {
            section: "asset_evaluation",
            criteria: [
              {
                id: "j1",
                title: "Judged",
                kind: "judge" as const,
                weightage: 2,
                evidence: { features: ["roe_annual"], retrieval: [], event_types: [] },
                prompt: "Assess quality",
                anchors: { yes: "strong", partial: "mixed", no: "weak" },
              },
            ],
          },
        ],
      }),
    ).toHaveLength(0);
  });

  it("rejects judge with no evidence sources", () => {
    const issues = validateRubric({
      ...rubric,
      parameters: [
        {
          section: "asset_evaluation",
          criteria: [
            {
              id: "j2",
              title: "Bad",
              kind: "judge" as const,
              weightage: 2,
              evidence: { features: [], retrieval: [], event_types: [] },
              prompt: "x",
              anchors: { yes: "strong", partial: "mixed", no: "weak" },
            },
          ],
        },
      ],
    });
    expect(issues.some((i) => i.includes("judge needs ≥1 evidence source"))).toBe(true);
  });

  it("rejects unknown feature in a predicate", () => {
    const issues = validateRubric({
      ...rubric,
      parameters: [
        {
          section: "asset_evaluation",
          criteria: [
            {
              id: "bad-feat",
              title: "d",
              kind: "predicate" as const,
              weightage: 1,
              requires: ["not_a_feature"],
              expr: { ">=": [{ var: "not_a_feature" }, 1] },
            },
          ],
        },
      ],
    });
    expect(issues.some((i) => i.includes('unknown feature "not_a_feature"'))).toBe(true);
  });
});

describe("rubricHash", () => {
  it("is deterministic and 16 chars", () => {
    expect(rubricHash(rubric)).toBe(rubricHash(rubric));
    expect(rubricHash(rubric)).toHaveLength(16);
    expect(rubricHash(rubric)).not.toBe(rubricHash({ ...rubric, name: "other" }));
  });
});