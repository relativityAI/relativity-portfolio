/*
 * Design-preview harness for the Agent Skills console page. NOT part of the
 * app build (dev-only entry; never imported by main.tsx). Mocks the API so
 * the real page component renders with representative data for design review:
 *   open  http://localhost:5173/skills-preview.html
 */
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import axios from "axios";
import "./index.css";
import "./console.css";
import AgentSkills from "./pages/console/AgentSkills";

const SKILLS = [
    { id: "moat-analysis", name: "Moat Analysis", category: "fundamentals", source: "builtin", version: 2, description: "Sizes the durability of a business's competitive advantage against pricing power and churn." },
    { id: "dcf-valuation", name: "DCF Valuation", category: "valuation", source: "builtin", version: 3, description: "Intrinsic value from discounted cash flows with explicit growth and terminal assumptions." },
    { id: "management-quality", name: "Management Quality", category: "qualitative", source: "builtin", version: 1, description: "Capital allocation track record, insider alignment and tone in transcripts." },
    { id: "balance-sheet-stress", name: "Balance Sheet Stress Test", category: "fundamentals", source: "custom", version: 1, description: "Can the company survive its own capital structure?" },
    { id: "macro-regime", name: "Macro Regime", category: "macro", source: "builtin", version: 4, description: "Rates, inflation and liquidity regime shaping the opportunity set." },
    { id: "news-sentiment", name: "News Sentiment", category: "market", source: "builtin", version: 2, description: "Rolling news tone and unusual volume around the ticker." },
    { id: "peer-comparison", name: "Peer Comparison", category: "valuation", source: "builtin", version: 1, description: "Relative multiples and growth against a hand-picked peer set." },
    { id: "dividend-anchor", name: "Dividend Anchor", category: "valuation", source: "custom", version: 1, description: "Yield, payout durability and history of cuts." },
    { id: "insider-flow", name: "Insider Flow", category: "qualitative", source: "builtin", version: 1, description: "Insider buys and sells clustered around filings." },
    { id: "earnings-quality", name: "Earnings Quality", category: "fundamentals", source: "builtin", version: 2, description: "Accruals, cash conversion and one-off noise in reported earnings." },
    { id: "sector-rotation", name: "Sector Rotation", category: "macro", source: "builtin", version: 1, description: "Where capital is rotating within the market right now." },
    { id: "chart-patterns", name: "Chart Patterns", category: "market", source: "custom", version: 1, description: "Structural levels, trend health and participation." },
] as const;

const AGENTS = [
    { id: "a1", name: "GARP Fund", skills: [] as { skill_id: string; weight: number }[] },
    { id: "a2", name: "Deep Value", skills: [] as { skill_id: string; weight: number }[] },
    { id: "a3", name: "Quality Compounder", skills: [] as { skill_id: string; weight: number }[] },
];

const MARKDOWN = `---
name: Moat Analysis
category: fundamentals
---

## Purpose

Sizes the durability of a business's competitive advantage.

## Method

- Read the last 4 filings for pricing power evidence.
- Compare gross margins against peers over 5 years.

## Verdict anchors

- Durable moat — weight 5
- Fading moat — weight 3
`;

// Mock the API at the axios level — SkillService/AgentService call through it.
axios.get = (async (url: string) => {
    const skillMatch = url.match(/\/skills\/([^/]+)$/);
    if (skillMatch) {
        const s = SKILLS.find((x) => x.id === skillMatch[1]) || SKILLS[0];
        return { data: { ...s, purpose: "Sizes the durability of a business's competitive advantage against pricing power and churn.", anchors: [{ label: "Durable moat", weight: 5 }, { label: "Fading moat", weight: 3 }], markdown: MARKDOWN } };
    }
    if (url.includes("/skills")) return { data: SKILLS.map((s) => ({ ...s, purpose: "Sizes the durability of a business's competitive advantage.", anchors: [{ label: "Durable moat", weight: 5 }, { label: "Fading moat", weight: 3 }] })) };
    if (url.includes("/agents")) return { data: AGENTS };
    return { data: {} };
}) as unknown as typeof axios.get;
axios.post = (async () => ({ data: { skill: SKILLS[0], issues: [] } })) as unknown as typeof axios.post;
axios.put = (async () => ({ data: { skill: SKILLS[0], issues: [] } })) as unknown as typeof axios.put;
axios.delete = (async () => ({ data: {} })) as unknown as typeof axios.delete;

createRoot(document.getElementById("root")!).render(
    <ThemeProvider attribute="class" defaultTheme="dark">
        <ChakraProvider value={createSystem(defaultConfig)}>
            <MemoryRouter initialEntries={["/console/skills"]}>
                <div className="console-shell min-h-dvh bg-console-canvas">
                    <AgentSkills />
                </div>
            </MemoryRouter>
        </ChakraProvider>
    </ThemeProvider>,
);
