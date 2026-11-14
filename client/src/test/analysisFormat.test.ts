import { describe, it, expect } from "vitest";
import {
    currencyForSource,
    formatCurrencyForMarket,
    actionBucket,
    bandForScore,
    scoreSignal,
    stripScoreScaffolding,
    coverageLabel,
    insufficientCoverage,
    DEFAULT_BANDS,
} from "../lib/analysisFormat";

describe("currencyForSource (E4)", () => {
    it("maps NSE runs to INR and everything else to USD", () => {
        expect(currencyForSource("nse")).toBe("INR");
        expect(currencyForSource("NSE")).toBe("INR");
        expect(currencyForSource("sec")).toBe("USD");
        expect(currencyForSource(undefined)).toBe("USD");
        expect(currencyForSource(null)).toBe("USD");
    });
});

describe("formatCurrencyForMarket (E4)", () => {
    it("uses Cr/Lakh for Indian listings — never the mixed ₹…B convention", () => {
        expect(formatCurrencyForMarket(2.5e11, "INR")).toBe("₹25000.00Cr");
        expect(formatCurrencyForMarket(1.5e9, "INR")).toBe("₹150.00Cr");
        expect(formatCurrencyForMarket(5e7, "INR")).toBe("₹5.00Cr");
        expect(formatCurrencyForMarket(6e5, "INR")).toBe("₹6.00L");
    });

    it("uses M/B for US listings", () => {
        expect(formatCurrencyForMarket(2.5e9, "USD")).toBe("$2.50B");
        expect(formatCurrencyForMarket(4.2e6, "USD")).toBe("$4.20M");
        expect(formatCurrencyForMarket(850, "USD")).toBe("$850");
    });
});

describe("bands + action buckets (D4/E3: one scale, one definition)", () => {
    it("default bands are shortlist ≥75, watch ≥55, else pass", () => {
        expect(DEFAULT_BANDS).toEqual({ shortlistAt: 75, watchAt: 55 });
        expect(actionBucket(80)).toBe("shortlist");
        expect(actionBucket(74.9)).toBe("watch");
        expect(actionBucket(55)).toBe("watch");
        expect(actionBucket(54.9)).toBe("pass");
    });

    it("scoreSignal no longer labels everything positive (the old 70/40-on-0–1 bug)", () => {
        expect(scoreSignal(80)).toBe("positive");
        expect(scoreSignal(60)).toBe("positive");
        expect(scoreSignal(45)).toBe("caution");
        expect(scoreSignal(10)).toBe("negative");
    });

    it("bandForScore handles null as unscored, not positive", () => {
        expect(bandForScore(null).label).toBe("unscored");
        expect(bandForScore(80).label).toBe("Shortlist");
        expect(bandForScore(60).label).toBe("Watch");
        expect(bandForScore(20).label).toBe("Pass");
    });
});

describe("stripScoreScaffolding (E2)", () => {
    it("removes FINAL_SCORE lines in their colon, fullwidth-colon and = forms", () => {
        expect(stripScoreScaffolding("Reasoning here.\nFINAL_SCORE: 72\nMore text.")).toBe("Reasoning here.\nMore text.");
        expect(stripScoreScaffolding("FINAL_SCORE：80")).toBe("");
        expect(stripScoreScaffolding("FINAL_SCORE = 60")).toBe("");
    });

    it("removes bolded and decorated FINAL_SCORE variants", () => {
        expect(stripScoreScaffolding("**FINAL_SCORE: 88**")).toBe("");
        expect(stripScoreScaffolding("# Final Score: 42/100")).toBe("");
    });

    it("removes bare 'Score: NN/100' stubs but keeps prose mentioning scores", () => {
        expect(stripScoreScaffolding("Score: 72/100")).toBe("");
        expect(stripScoreScaffolding("Score: 61.5")).toBe("");
        expect(stripScoreScaffolding("The score of 72 reflects durable advantages.")).toContain("score of 72");
    });

    it("keeps ordinary content intact and collapses the gap left behind", () => {
        const md = "Para one.\n\nFINAL_SCORE: 65\n\nPara two.";
        const out = stripScoreScaffolding(md);
        expect(out).toContain("Para one.");
        expect(out).toContain("Para two.");
        expect(out).not.toContain("FINAL_SCORE");
    });

    it("tolerates empty input", () => {
        expect(stripScoreScaffolding(undefined)).toBe("");
        expect(stripScoreScaffolding(null)).toBe("");
        expect(stripScoreScaffolding("")).toBe("");
    });
});

describe("coverage chip semantics (E8)", () => {
    it("coverageLabel renders a compact percentage and tolerates 0–1 or 0–100 inputs", () => {
        expect(coverageLabel(0.74)).toBe("74%");
        expect(coverageLabel(74)).toBe("74%");
        expect(coverageLabel(null)).toBe("");
        expect(coverageLabel(undefined)).toBe("");
    });

    it("insufficientCoverage gates below the profile minimum (default 60%)", () => {
        expect(insufficientCoverage(0.59)).toBe(true);
        expect(insufficientCoverage(0.6)).toBe(false);
        expect(insufficientCoverage(0.88)).toBe(false);
        expect(insufficientCoverage(null)).toBe(false);
        // Coverage expressed 0–100 is also accepted.
        expect(insufficientCoverage(45, 0.6)).toBe(false);
        expect(insufficientCoverage(0.45, 0.6)).toBe(true);
    });
});
