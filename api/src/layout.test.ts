import { describe, it, expect } from "vitest";
import { validateLangStructure } from "./layout.js";
import { extractRefs, hasScoreLeak } from "./layout.refs.js";

describe("validateLangStructure", () => {
  it("accepts a well-formed report and rejects unknown components", () => {
    expect(validateLangStructure(`root = AnalysisPage("RELIANCE", [StatHero("Last", "@lit:price.lastPrice"), MarkdownBlock("sku-moat")])`).ok).toBe(true);
    expect(validateLangStructure(`root = AnalysisPage("RELIANCE", [FancyChart("@ds:obs_news_0")])`).ok).toBe(false);
  });

  it("rejects any score reference in the layout", () => {
    expect(validateLangStructure(`root = AnalysisPage("RELIANCE", [SkillScoreCard("@ds:score_skills")])`).ok).toBe(false);
    expect(validateLangStructure(`root = AnalysisPage("RELIANCE", [BarChart("@ds:score_skills", "name", "score")])`)).toEqual({
      ok: false,
      error: "scores may not appear in the layout — figures must show stock data",
    });
    expect(validateLangStructure(`root = AnalysisPage("RELIANCE", [StatHero("Score", "@lit:score.totalScore")])`).ok).toBe(false);
  });
});

describe("extractRefs (text-level grounding)", () => {
  it("dedupes repeats and keeps kinds isolated", () => {
    const text = `PriceChart("@ds:price_candles", "@ds:price_candles"), StatHero("Last", "@lit:price.lastPrice"), MetricGrid("@mt:roe-ttm")`;
    expect(extractRefs(text, "ds")).toEqual(["price_candles"]);
    expect(extractRefs(text, "lit")).toEqual(["price.lastPrice"]);
    expect(extractRefs(text, "mt")).toEqual(["roe-ttm"]);
  });

  it("survives escaped quotes, nested strings, and prose mentions", () => {
    // escaped quotes inside a positional string
    expect(extractRefs(`StatHero("he said \\"buy\\" @lit:price.asOf")`, "lit")).toEqual(["price.asOf"]);
    // refs inside markdown prose count (grounding is text-level by design)
    expect(extractRefs(`MarkdownBlock("sku-moat") — see @ds:price_candles`, "ds")).toEqual(["price_candles"]);
    // an email-looking token is not a ref
    expect(extractRefs(`mail me at ops@example.com`, "ds")).toEqual([]);
  });
});

describe("hasScoreLeak", () => {
  it("flags score refs only, not prose or prefix lookalikes", () => {
    expect(hasScoreLeak(`SkillScoreCard("@ds:score_skills")`)).toBe(true);
    expect(hasScoreLeak(`StatHero("Score", "@lit:score.totalScore")`)).toBe(true);
    // \\b boundary: longer ids sharing the prefix are separate datasets
    expect(hasScoreLeak(`DataTable("@ds:score_skills_daily")`)).toBe(false);
    expect(hasScoreLeak(`StatHero("n", "@lit:scores.total")`)).toBe(false);
    // plain prose mentioning the id without the @ds: prefix is not a ref
    expect(hasScoreLeak(`MarkdownBlock("sku-moat") — score_skills is excluded`)).toBe(false);
  });
});
