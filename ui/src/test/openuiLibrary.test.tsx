import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { createParser } from "@openuidev/react-lang";
import { openUiLibrary, OpenUiReport, type OpenUiManifest } from "@/lib/openui";

const specFile = resolve(__dirname, "../lib/openui.spec.json");

// Deterministic manifest fixture shaped exactly like api buildDataManifest.
const manifest: OpenUiManifest = {
    identity: { symbol: "RELIANCE", shareName: "Reliance Industries Ltd", asOf: "2026-04-03" },
    price: { lastPrice: "₹4,502", asOf: "Apr 3" },
    score: { totalScore: 71, coverage: 100 },
    skills: [
        { id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84, markdown: "## Moat\n\nStrong brand." },
        { id: "fin-leverage", name: "Leverage", category: "financials", weight: 4, score: 61, markdown: "" },
    ],
    datasets: [
        { id: "price_candles", label: "Price", kind: "series", cols: ["date", "close"], rows: [{ date: "2026-04-01", close: 4410 }, { date: "2026-04-02", close: 4498 }] },
        { id: "price_sma20", label: "SMA 20", kind: "series", cols: ["date", "value"], rows: [{ date: "2026-04-01", value: 4320.5 }, { date: "2026-04-02", value: 4361.2 }] },
        { id: "price_sma50", label: "SMA 50", kind: "series", cols: ["date", "value"], rows: [{ date: "2026-04-01", value: 4180 }, { date: "2026-04-02", value: 4200 }] },
        { id: "score_skills", label: "Skill scores", kind: "table", cols: ["id", "name", "category", "weight", "score"], rows: [
            { id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84 },
            { id: "fin-leverage", name: "Leverage", category: "financials", weight: 4, score: 61 },
        ] },
    ],
};

// Positional syntax only — children passed as a bracketed array, the form the parser accepts.
const lang = `root = AnalysisPage("RELIANCE", [StatHero("Last Price", "@lit:price.lastPrice", "as of @lit:price.asOf"), PriceChart("@ds:price_candles", "@ds:price_sma20", "@ds:price_sma50"), SkillScoreCard("@ds:score_skills"), MarkdownBlock("sku-moat")])`;

describe("openui library", () => {
    it("spec json is committed and in sync with the live library (UPDATE_OPENUI_SPEC=1 regenerates)", () => {
        const spec = openUiLibrary.toJSONSchema() as Record<string, unknown>;
        if (process.env.UPDATE_OPENUI_SPEC === "1") {
            writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
        }
        const committed = JSON.parse(readFileSync(specFile, "utf8")) as Record<string, unknown>;
        expect(spec).toEqual(committed);
    });

    it("parses positional Lang referencing manifest ids without errors", () => {
        const parser = createParser(openUiLibrary.toJSONSchema(), "AnalysisPage");
        const result = parser.parse(lang);
        expect(result.meta?.errors ?? []).toHaveLength(0);
        const root = result.root as unknown as { props: { symbol?: string; children?: { typeName: string }[] } };
        expect(root.props.symbol).toBe("RELIANCE");
        expect((root.props.children ?? []).map((c) => c.typeName).sort()).toEqual(["MarkdownBlock", "PriceChart", "SkillScoreCard", "StatHero"].sort());
    });

    it("renders to HTML client-side shape: hero value, prose markdown, titles", () => {
        const wrap = (n: React.ReactNode) => (
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    {n}
                </ThemeProvider>
            </ChakraProvider>
        );
        const html = renderToString(wrap(<OpenUiReport lang={lang} manifest={manifest} fallback={<div id="fb" />} />));
        expect(html).toContain("RELIANCE");
        expect(html).toContain("₹4,502");
        expect(html).toContain("Strong brand");
        expect(html).toContain("Moat");
    });

    it("resolves @lit:score.* literals", () => {
        const scoreLang = `root = AnalysisPage("RELIANCE", [StatHero("Composite Score", "@lit:score.totalScore", "weighted")])`;
        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    <OpenUiReport lang={scoreLang} manifest={manifest} fallback={<div id="fb" />} />
                </ThemeProvider>
            </ChakraProvider>
        );
        expect(html).toContain("71");
    });

    it("returns the fallback when lang is empty", () => {
        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <OpenUiReport lang="" manifest={manifest} fallback={<div id="fb">fallback</div>} />
            </ChakraProvider>
        );
        expect(html).toContain("fallback");
        expect(html).not.toContain("RELIANCE");
    });
});