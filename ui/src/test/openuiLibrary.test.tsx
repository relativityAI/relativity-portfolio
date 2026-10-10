import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { createParser } from "@openuidev/react-lang";
import { openUiLibrary, compactNumber, OpenUiReport, type OpenUiManifest } from "@/lib/openui";

const specFile = resolve(__dirname, "../lib/openui.spec.json");

// Deterministic manifest fixture shaped exactly like api buildDataManifest.
const manifest: OpenUiManifest = {
    api: 1,
    identity: { symbol: "RELIANCE", shareName: "Reliance Industries Ltd", source: "market", agentName: "test-agent", runMode: "agent", asOf: "2026-04-03" },
    price: { lastPrice: 4502, week52Low: null, week52High: null, asOf: "2026-04-03", rsi14: null, sma20: null, sma50: null, sma200: null, returns: {} },
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
        { id: "obs_income", label: "Income", kind: "table", cols: ["report_date", "net_profit", "totalRevenue"], rows: [
            { report_date: "FY24", net_profit: 100, totalRevenue: 400 },
        ] },
    ],
};

// Positional syntax only — children passed as a bracketed array, the form the parser accepts.
const lang = `root = AnalysisPage("RELIANCE", [StatHero("Last Price", "@lit:price.lastPrice", "as of @lit:price.asOf"), PriceChart("@ds:price_candles", "@ds:price_sma20", "@ds:price_sma50"), SkillScoreCard("@ds:score_skills"), MarkdownBlock("sku-moat")])`;

describe("openui library", () => {
    it("compactNumber renders large magnitudes as K/M/B/T", () => {
        expect(compactNumber(842)).toBe("842");
        expect(compactNumber(2_500_000)).toBe("2.5M");
        expect(compactNumber(1_234_000_000)).toBe("1.2B");
        expect(compactNumber(null)).toBe("—");
    });

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
        // lastPrice is a number on the wire (api/src/types/layout.ts) — StatHero
        // renders it via String(), so no ₹ grouping comes along for free.
        expect(html).toContain("4502");
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

    it("groups consecutive StatHero into one row but leaves a lone hero full-width", () => {
        const render = (l: string) =>
            renderToString(
                <ChakraProvider value={createSystem(defaultConfig)}>
                    <ThemeProvider attribute="class" defaultTheme="light">
                        <OpenUiReport lang={l} manifest={manifest} fallback={<div id="fb" />} />
                    </ThemeProvider>
                </ChakraProvider>
            );
        const two = render(`root = AnalysisPage("RELIANCE", [StatHero("A", "1"), StatHero("B", "2")])`);
        expect((two.match(/data-hero-row/g) ?? []).length).toBe(1);
        const one = render(`root = AnalysisPage("RELIANCE", [StatHero("A", "1")])`);
        expect(one).not.toContain("data-hero-row");
    });

    it("DataTable shows only the selected columns, in order", () => {
        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    <OpenUiReport lang={`root = AnalysisPage("RELIANCE", [DataTable("@ds:score_skills", 12, "score,name")])`} manifest={manifest} fallback={<div id="fb" />} />
                </ThemeProvider>
            </ChakraProvider>
        );
        expect(html).toContain("Name");
        expect(html).toContain("Score");
        expect(html).not.toContain("Category");
        expect(html).not.toContain("Weight");
        expect(html.indexOf("Score")).toBeLessThan(html.indexOf("Name"));
    });

    it("DataTable renders snake_case and camelCase column names as normal words", () => {        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    <OpenUiReport lang={`root = AnalysisPage("RELIANCE", [DataTable("@ds:obs_income")])`} manifest={manifest} fallback={<div id="fb" />} />
                </ThemeProvider>
            </ChakraProvider>
        );
        expect(html).toContain("Report Date");
        expect(html).toContain("Net Profit");
        expect(html).toContain("Total Revenue");
        expect(html).not.toContain("report_date");
        expect(html).not.toContain("net_profit");
        expect(html).not.toContain("totalRevenue");
    });

    it("MetricGrid renders only the selected fields, formatted by unit", () => {
        const withMetrics: OpenUiManifest = {
            ...manifest,
            metrics: [{ id: "met_x_0", label: "ratios", fields: [
                { key: "net_margin", label: "net margin", value: 8.08, unit: "pct" },
                { key: "debt_to_equity", label: "debt to equity", value: 0.0279, unit: "x" },
                { key: "current_price", label: "current price", value: 4580, unit: "cur" },
            ] }],
        };
        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    <OpenUiReport lang={`root = AnalysisPage("RELIANCE", [MetricGrid("@mt:met_x_0", "net_margin,current_price")])`} manifest={withMetrics} fallback={<div id="fb" />} />
                </ThemeProvider>
            </ChakraProvider>
        );
        expect(html).toContain("net margin");
        expect(html).toContain("8.08%");
        expect(html).toContain("4,580");
        expect(html).not.toContain("debt to equity");
        expect(html).not.toContain("0.0279");
    });

    it("renders one prose section for a @md:<section-id> ref", () => {
        const sectioned: OpenUiManifest = {
            ...manifest,
            skills: [{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84, sections: [
                { id: "md_sku-moat_0", heading: "Moat", markdown: "## Moat\n\nStrong brand." },
                { id: "md_sku-moat_1", heading: "Trend", markdown: "## Trend\n\nWidening." },
            ] }],
        };
        const html = renderToString(
            <ChakraProvider value={createSystem(defaultConfig)}>
                <ThemeProvider attribute="class" defaultTheme="light">
                    <OpenUiReport lang={`root = AnalysisPage("RELIANCE", [MarkdownBlock("@md:md_sku-moat_1")])`} manifest={sectioned} fallback={<div id="fb" />} />
                </ThemeProvider>
            </ChakraProvider>
        );
        expect(html).toContain("Widening");
        expect(html).not.toContain("Strong brand");
    });
});