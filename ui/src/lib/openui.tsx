/**
 * OpenUI Lang layer for the layout-agent report.
 *
 * The api layout agent emits OpenUI Lang (a small DSL resolved client-side)
 * that references ids from a data manifest it also sends. This module defines
 * the component *library* the model is allowed to write, plus the React bits
 * that render it:
 *
 *   - each component is a `defineComponent` with a zod props schema — the
 *     schema is positional (first key = first positional arg) and the model
 *     only sees this catalog via the api's LAYOUT_AGENT_SYSTEM_PROMPT;
 *   - every data-bearing prop is a `z.string()` holding a `@ds:`/`@lit:` ref,
 *     *not* inline data — the quoted string survives parsing untouched
 *     (verified against lang-core 0.3.2: `key=value` syntax is treated as
 *     positional args and drops to null, so the catalog is strictly
 *     positional) and is resolved here through the manifest context;
 *   - chart components reuse the app-wide Echart wrapper so theme tokens and
 *     a11y labels stay consistent with the rest of the app.
 */
/* eslint-disable react-hooks/rules-of-hooks -- defineComponent's `component`
   callbacks are invoked as React components by the Renderer; the rule cannot
   see through the `component:` property to know they are components. */
/* eslint-disable react-refresh/only-export-components -- this module exports
   the library value alongside its components, by design. */
import { Component, createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod";
import { Box, Flex, Text } from "@chakra-ui/react";
import { useColorMode } from "@/compat/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Echart from "@/components/shared/Echart";
import { resolvedTheme, tooltipStyle, type ResolvedTheme, type ECOption } from "@/lib/echarts";

// ---------------------------------------------------------------------------
// Manifest types (mirror api/src/layout.ts shapes)
// ---------------------------------------------------------------------------

export interface OpenUiDataset {
    id: string;
    label: string;
    kind: "series" | "table";
    cols: string[];
    rows: Record<string, number | string | null>[];
}

export interface OpenUiSkill {
    id: string;
    name: string;
    category: string;
    weight: number;
    score: number | null;
    /** Skill analyst prose — stripped from the prompt view, kept for rendering. */
    markdown?: string;
}

export interface OpenUiManifest {
    api?: number;
    identity?: {
        symbol?: string;
        shareName?: string;
        source?: string;
        agentName?: string;
        runMode?: string;
        asOf?: string;
    };
    score?: {
        totalScore?: number | null;
        coverage?: number | null;
        degraded?: string;
    };
    skills?: OpenUiSkill[];
    price?: Record<string, unknown> | null;
    datasets?: OpenUiDataset[];
}

// ---------------------------------------------------------------------------
// Manifest context + id resolution
// ---------------------------------------------------------------------------

const ManifestContext = createContext<OpenUiManifest>({});

export function ManifestProvider({ manifest, children }: { manifest: OpenUiManifest; children: ReactNode }) {
    return <ManifestContext.Provider value={manifest}>{children}</ManifestContext.Provider>;
}

export function useManifest(): OpenUiManifest {
    return useContext(ManifestContext);
}

/** Resolve a `@ds:` / `@lit:` ref against the manifest. */
function resolveRef(manifest: OpenUiManifest, ref: string | null | undefined): unknown {
    if (!ref) return undefined;
    if (ref.startsWith("@ds:")) return manifest.datasets?.find((d) => d.id === ref.slice(4));
    if (ref.startsWith("@lit:")) {
        const key = ref.slice(5);
        if (key.startsWith("skill.")) {
            const id = key.slice(6);
            return manifest.skills?.find((s) => s.id === id || s.name === id);
        }
        if (key.startsWith("price.") || key.startsWith("score.")) {
            const [root, ...path] = key.split(".");
            let cur: unknown = root === "price" ? manifest.price : manifest.score;
            for (const seg of path) {
                if (cur == null || typeof cur !== "object") return undefined;
                cur = (cur as Record<string, unknown>)[seg];
            }
            return typeof cur === "number" || typeof cur === "string" ? cur : undefined;
        }
        return undefined;
    }
    return undefined;
}

function datasetOf(manifest: OpenUiManifest, ref: string | null | undefined): OpenUiDataset | undefined {
    return resolveRef(manifest, ref) as OpenUiDataset | undefined;
}

function useLayoutTheme(): ResolvedTheme {
    const { colorMode } = useColorMode();
    return resolvedTheme(colorMode === "dark");
}

// ---------------------------------------------------------------------------
// Chart option helpers (ECharts, registered in lib/echarts.ts)
// ---------------------------------------------------------------------------

type Row = Record<string, number | string | null>;

function numeric(_col: string, v: unknown): number | null {
    return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
}

function vals(rows: Row[], col: string): (number | null)[] {
    return rows.map((r) => numeric(col, r[col]));
}

function dateAxis(rows: Row[]): string[] {
    return rows.map((r, i) => String(r.date ?? r.ds ?? r.timestamp ?? i));
}

const CARD: CSSProperties = {
    background: "var(--surface-panel)",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--radius-lg)",
    padding: "14px 16px",
};

function ChartCard({ title, children }: { title?: string | null; children: ReactNode }) {
    return (
        <Box style={CARD}>
            {title && (
                <Text fontSize="12px" fontWeight={600} letterSpacing="0.02em" color="var(--ink-secondary)" mb={2} textTransform="uppercase">
                    {title}
                </Text>
            )}
            {children}
        </Box>
    );
}

function lineOption(t: ResolvedTheme, x: string[], series: { name: string; data: (number | null)[] }[]): ECOption {
    return {
        tooltip: { trigger: "axis", ...tooltipStyle(t) },
        legend: { top: 0, textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 }, data: series.map((s) => s.name) },
        grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
        xAxis: {
            type: "category",
            data: x,
            axisLine: { lineStyle: { color: t.hairline } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 },
        },
        yAxis: {
            type: "value",
            scale: true,
            splitLine: { lineStyle: { color: t.gridLine } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 },
        },
        series: series.map((s, i) => ({
            name: s.name,
            type: "line",
            showSymbol: false,
            smooth: true,
            data: s.data,
            lineStyle: { width: i === 0 ? 2 : 1.25, color: i === 0 ? t.accent : t.chart[i % t.chart.length] },
            itemStyle: { color: i === 0 ? t.accent : t.chart[i % t.chart.length] },
        })),
    };
}

function barOption(t: ResolvedTheme, cats: string[], name: string, data: (number | null)[]): ECOption {
    return {
        tooltip: { trigger: "axis", ...tooltipStyle(t) },
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        xAxis: {
            type: "category",
            data: cats,
            axisLabel: {
                color: t.ink.tertiary,
                fontFamily: t.fonts.tabular,
                fontSize: 10.5,
                interval: Math.max(0, Math.ceil(cats.length / 12) - 1),
                rotate: cats.length > 8 ? 24 : 0,
            },
            axisLine: { lineStyle: { color: t.hairline } },
        },
        yAxis: {
            type: "value",
            splitLine: { lineStyle: { color: t.gridLine } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 },
        },
        series: [{ name, type: "bar", data, itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 }],
    };
}

function pieOption(t: ResolvedTheme, items: { name: string; value: number }[]): ECOption {
    return {
        tooltip: { trigger: "item", ...tooltipStyle(t) },
        legend: { bottom: 0, type: "scroll", textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 } },
        series: [
            {
                type: "pie",
                radius: ["42%", "68%"],
                center: ["50%", "44%"],
                itemStyle: { borderColor: t.surface.panel, borderWidth: 2, borderRadius: 4 },
                label: { color: t.ink.primary, fontFamily: t.fonts.tabular, fontSize: 11 },
                data: items.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: t.chart[i % t.chart.length] } })),
            },
        ],
    };
}

function fiveNum(valsIn: number[]): number[] {
    const s = [...valsIn].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    return [q(0), q(0.25), q(0.5), q(0.75), q(1)];
}

function numericCols(d: OpenUiDataset): { col: string; values: number[] }[] {
    return d.cols
        .filter((c) => !/^(date|ds|timestamp|id)$/i.test(c))
        .map((col) => ({ col, values: vals(d.rows, col).filter((v): v is number => v != null) }))
        .filter((c) => c.values.length > 0)
        .slice(0, 10);
}

function boxOption(t: ResolvedTheme, boxes: { name: string; data: number[] }[]): ECOption {
    return {
        tooltip: { trigger: "item", ...tooltipStyle(t) },
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        xAxis: {
            type: "category",
            data: boxes.map((b) => b.name),
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5, interval: 0, rotate: 24 },
            axisLine: { lineStyle: { color: t.hairline } },
        },
        yAxis: {
            type: "value",
            scale: true,
            splitLine: { lineStyle: { color: t.gridLine } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 },
        },
        series: [
            {
                type: "boxplot",
                data: boxes.map((b) => fiveNum(b.data)),
                itemStyle: { color: t.accent, borderColor: t.ink.primary },
            },
        ],
    };
}

function heatOption(t: ResolvedTheme, x: string[], y: string[], cells: [number, number, number][], min: number, max: number): ECOption {
    return {
        tooltip: { ...tooltipStyle(t) },
        grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: "category", data: x, axisLabel: { color: t.ink.tertiary, fontSize: 10 } },
        yAxis: { type: "category", data: y, axisLabel: { color: t.ink.tertiary, fontSize: 10 } },
        visualMap: {
            min,
            max,
            calculable: false,
            orient: "horizontal",
            left: "center",
            bottom: 0,
            inRange: { color: [t.surface.recessed, t.accent] },
            textStyle: { color: t.ink.tertiary, fontSize: 10 },
        },
        series: [{ type: "heatmap", data: cells, label: { show: false } }],
    };
}

function fmt(v: unknown): string {
    if (v == null) return "—";
    return typeof v === "number" ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v) : String(v);
}

// ---------------------------------------------------------------------------
// The component library (positional, zod-first — must stay in sync with the
// api's LAYOUT_AGENT_SYSTEM_PROMPT catalog and `src/lib/openui.spec.json`).
// ---------------------------------------------------------------------------

const StatHero = defineComponent({
    name: "StatHero",
    description: "One hero metric in the top stat strip: label, formatted value, optional sublabel.",
    props: z.object({
        label: z.string(),
        value: z.string(),
        sublabel: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const lit = (v: string | undefined) =>
            typeof v === "string" && v.includes("@lit:")
                ? v.replace(/@lit:[\w.]+/g, (ref) => {
                      const r = resolveRef(m, ref);
                      return typeof r === "string" || typeof r === "number" ? String(r) : ref;
                  })
                : v;
        return (
            <Box style={{ ...CARD, minWidth: 0, flex: "1 1 0" }}>
                <Text fontSize="11px" fontWeight={600} letterSpacing="0.06em" textTransform="uppercase" color="var(--ink-tertiary)">
                    {props.label}
                </Text>
                <Text mt={1} fontSize="22px" fontWeight={700} fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" color="var(--ink-primary)" lineHeight={1.15}>
                    {lit(props.value)}
                </Text>
                {props.sublabel && (
                    <Text mt={1} fontSize="12px" color="var(--ink-secondary)">
                        {lit(props.sublabel)}
                    </Text>
                )}
            </Box>
        );
    },
});

const PriceChart = defineComponent({
    name: "PriceChart",
    description: "Interactive price line for the company, plus optional moving-average overlay lines. All data props are @ds refs to series datasets.",
    props: z.object({
        data: z.string().optional(),
        ma20: z.string().optional(),
        ma50: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const main = datasetOf(m, props.data ?? "@ds:price_candles");
        if (!main) return null;
        const closeIdx = main.cols.findIndex((c) => /close/i.test(c));
        const series: { name: string; data: (number | null)[] }[] = [];
        if (closeIdx >= 0) series.push({ name: "Close", data: vals(main.rows, main.cols[closeIdx]) });
        for (const [ref, name] of [
            [props.ma20, "SMA20"],
            [props.ma50, "SMA50"],
        ] as const) {
            const d = ref && datasetOf(m, ref);
            if (d && d.rows.length) series.push({ name, data: vals(d.rows, "value") });
        }
        if (!series.length) return null;
        return (
            <ChartCard title={props.title}>
                <Echart option={lineOption(t, dateAxis(main.rows), series)} height={260} ariaLabel={props.title ?? "Price chart"} />
            </ChartCard>
        );
    },
});

const MultiLineChart = defineComponent({
    name: "MultiLineChart",
    description: "Up to 3 time series over dates. data is an @ds ref; every numeric column except the date column becomes a line.",
    props: z.object({
        data: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d || d.rows.length === 0) return null;
        const cols = numericCols(d).slice(0, 3);
        if (!cols.length) return null;
        return (
            <ChartCard title={props.title}>
                <Echart
                    option={lineOption(t, dateAxis(d.rows), cols.map((c) => ({ name: c.col, data: vals(d.rows, c.col) })))}
                    height={240}
                    ariaLabel={props.title ?? "Multi-line chart"}
                />
            </ChartCard>
        );
    },
});

const BarChart = defineComponent({
    name: "BarChart",
    description: "Categorical bar chart. data is an @ds ref, x is the category column, y is the numeric column, title is a display string.",
    props: z.object({
        data: z.string().optional(),
        x: z.string().optional(),
        y: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d || d.rows.length === 0) return null;
        const yCandidates = numericCols(d);
        const xCol = props.x && d.cols.includes(props.x) ? props.x : d.cols.find((c) => !yCandidates.some((n) => n.col === c)) ?? d.cols[0];
        const yCol = props.y && d.cols.includes(props.y) ? props.y : yCandidates[0]?.col;
        if (!xCol || !yCol) return null;
        return (
            <ChartCard title={props.title}>
                <Echart option={barOption(t, d.rows.map((r) => fmt(r[xCol])), yCol, vals(d.rows, yCol))} height={240} ariaLabel={props.title ?? `${yCol} bar chart`} />
            </ChartCard>
        );
    },
});

const PieChart = defineComponent({
    name: "PieChart",
    description: "Share breakdown. data is an @ds ref, name is the label column, value is the numeric column, title is a display string.",
    props: z.object({
        data: z.string().optional(),
        name: z.string().optional(),
        value: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d) return null;
        const yCandidates = numericCols(d);
        const nameCol = props.name && d.cols.includes(props.name) ? props.name : d.cols.find((c) => !yCandidates.some((n) => n.col === c)) ?? d.cols[0];
        const valueCol = props.value && d.cols.includes(props.value) ? props.value : yCandidates[0]?.col;
        if (!nameCol || !valueCol) return null;
        const items = d.rows
            .map((r) => ({ name: fmt(r[nameCol]), value: numeric(valueCol, r[valueCol]) }))
            .filter((i): i is { name: string; value: number } => i.value != null)
            .slice(0, 12);
        if (!items.length) return null;
        return (
            <ChartCard title={props.title}>
                <Echart option={pieOption(t, items)} height={240} ariaLabel={props.title ?? "Share breakdown"} />
            </ChartCard>
        );
    },
});

const BoxPlotChart = defineComponent({
    name: "BoxPlotChart",
    description: "Distribution of one or more numeric columns of a table (@ds ref). A five-number box per numeric column.",
    props: z.object({
        data: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d) return null;
        const cols = numericCols(d);
        if (!cols.length) return null;
        return (
            <ChartCard title={props.title}>
                <Echart option={boxOption(t, cols.map((c) => ({ name: c.col, data: c.values })))} height={240} ariaLabel={props.title ?? "Distribution boxes"} />
            </ChartCard>
        );
    },
});

const HeatmapChart = defineComponent({
    name: "HeatmapChart",
    description: "Numeric columns of a table (@ds ref) as a colored heatmap grid. For broad comparisons at a glance.",
    props: z.object({
        data: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d) return null;
        const cols = numericCols(d).slice(0, 8);
        if (!cols.length) return null;
        const rows = d.rows.slice(0, 60);
        const cells: [number, number, number][] = [];
        let min = Infinity;
        let max = -Infinity;
        for (let ri = 0; ri < rows.length; ri++) {
            for (let ci = 0; ci < cols.length; ci++) {
                const v = numeric(cols[ci].col, rows[ri][cols[ci].col]);
                if (v == null) continue;
                cells.push([ri, ci, v]);
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }
        if (!cells.length) return null;
        const xs = rows.map((_, i) => String(i + 1));
        return (
            <ChartCard title={props.title}>
                <Echart
                    option={heatOption(t, xs, cols.map((c) => c.col), cells, min, max)}
                    height={Math.max(150, 64 + rows.length * 6 + cols.length * 20)}
                    ariaLabel={props.title ?? "Heatmap"}
                />
            </ChartCard>
        );
    },
});

const DataTable = defineComponent({
    name: "DataTable",
    description: "Renders any table dataset (@ds ref) as a plain table. maxRows caps rows (default 12).",
    props: z.object({
        data: z.string().optional(),
        maxRows: z.number().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const d = datasetOf(m, props.data);
        if (!d || !d.cols.length) return null;
        const rows = d.rows.slice(0, props.maxRows ?? 12);
        return (
            <Box style={{ ...CARD, overflowX: "auto" }}>
                <Text fontSize="12px" fontWeight={600} letterSpacing="0.02em" color="var(--ink-secondary)" mb={2} textTransform="uppercase">
                    {d.label}
                </Text>
                <Box as="table" w="full" fontSize="12px" borderCollapse="collapse">
                    <Box as="thead">
                        <Box as="tr">
                            {d.cols.map((c) => (
                                <Box
                                    as="th"
                                    key={c}
                                    textAlign="left"
                                    fontWeight={600}
                                    color="var(--ink-tertiary)"
                                    pb={2}
                                    pr={3}
                                    borderBottom="1px solid var(--hairline)"
                                    whiteSpace="nowrap"
                                    fontSize="11px"
                                    textTransform="uppercase"
                                    letterSpacing="0.04em"
                                >
                                    {c}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                    <Box as="tbody">
                        {rows.map((r, i) => (
                            <Box as="tr" key={i} borderBottom="1px solid var(--hairline)">
                                {d.cols.map((c) => (
                                    <Box as="td" key={c} py={1.5} pr={3} color="var(--ink-primary)" fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" fontSize="12px" whiteSpace="nowrap">
                                        {fmt(r[c])}
                                    </Box>
                                ))}
                            </Box>
                        ))}
                    </Box>
                </Box>
            </Box>
        );
    },
});

const SkillScoreCard = defineComponent({
    name: "SkillScoreCard",
    description: "The scored skill breakdown, one bar per skill. data defaults to @ds:score_skills.",
    props: z.object({
        data: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data ?? "@ds:score_skills");
        if (!d) return null;
        const rows = d.rows.slice(0, 20);
        return (
            <Box style={CARD}>
                <Text fontSize="12px" fontWeight={600} letterSpacing="0.02em" color="var(--ink-secondary)" mb={3} textTransform="uppercase">
                    {props.title ?? "Skill scores"}
                </Text>
                <Flex direction="column" gap={2.5}>
                    {rows.map((r, i) => {
                        const name = String(r.name ?? r.id ?? `#${i + 1}`);
                        const score = numeric("score", r.score);
                        const cat = r.category ? String(r.category) : "";
                        return (
                            <Box key={i}>
                                <Flex justify="space-between" align="baseline" mb={1}>
                                    <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)">
                                        {name}
                                    </Text>
                                    <Text fontSize="12px" fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" color="var(--ink-secondary)">
                                        {score == null ? "n/a" : `${fmt(score)} / 100`}
                                        {cat ? ` · ${cat}` : ""}
                                    </Text>
                                </Flex>
                                <Box h="6px" borderRadius="full" background="var(--surface-recessed)" overflow="hidden">
                                    <Box h="full" borderRadius="full" width={`${Math.max(0, Math.min(100, score ?? 0))}%`} background={t.accent} transition="width .4s ease" />
                                </Box>
                            </Box>
                        );
                    })}
                </Flex>
            </Box>
        );
    },
});

const MarkdownBlock = defineComponent({
    name: "MarkdownBlock",
    description: "One skill's analyst prose. The single positional arg is a skill id from the manifest's skills list.",
    props: z.object({
        skill: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const skill = props.skill ? m.skills?.find((s) => s.id === props.skill || s.name === props.skill) : undefined;
        if (!skill) return null;
        return (
            <Box style={CARD}>
                {skill.markdown?.trim() ? (
                    <Box className="skill-md" sx={{ "& h1,& h2,& h3": { mt: 2, mb: 1 } }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.markdown}</ReactMarkdown>
                    </Box>
                ) : (
                    <Flex justify="space-between" align="baseline">
                        <Box>
                            <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">
                                {skill.name}
                            </Text>
                            {skill.category && (
                                <Text fontSize="11px" color="var(--ink-tertiary)">
                                    {skill.category} · weight {fmt(skill.weight)}
                                </Text>
                            )}
                        </Box>
                        <Text fontSize="12px" fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" color="var(--ink-secondary)">
                            {skill.score == null ? "no score" : `${fmt(skill.score)} / 100`}
                        </Text>
                    </Flex>
                )}
            </Box>
        );
    },
});

const LEAF_REFS = z.array(
    z.union([
        StatHero.ref,
        PriceChart.ref,
        MultiLineChart.ref,
        BarChart.ref,
        PieChart.ref,
        BoxPlotChart.ref,
        HeatmapChart.ref,
        DataTable.ref,
        SkillScoreCard.ref,
        MarkdownBlock.ref,
    ]),
);

const AnalysisPage = defineComponent({
    name: "AnalysisPage",
    description: "The single root wrapper for the whole report. Exactly one per page. Positional: symbol then children.",
    props: z.object({
        symbol: z.string().optional(),
        children: LEAF_REFS.optional(),
    }),
    component: ({ props, renderNode }) => {
        const kids = props.children ? (Array.isArray(props.children) ? props.children : [props.children]) : [];
        return (
            <Flex direction="column" gap={5}>
                {props.symbol && (
                    <Text fontSize="20px" fontWeight={700} color="var(--ink-primary)">
                        {props.symbol}
                    </Text>
                )}
                {kids.map((c, i) => (
                    <Box key={(c as { statementId?: string }).statementId ?? i}>{renderNode(c)}</Box>
                ))}
            </Flex>
        );
    },
});

export const openUiLibrary = createLibrary({
    components: [StatHero, PriceChart, MultiLineChart, BarChart, PieChart, BoxPlotChart, HeatmapChart, DataTable, SkillScoreCard, MarkdownBlock, AnalysisPage],
    root: "AnalysisPage",
});

// ---------------------------------------------------------------------------
// Report wrapper: provider + Renderer with a genuine fallback on bad input
// ---------------------------------------------------------------------------

class LangBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state: { failed: boolean } = { failed: false };
    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

/**
 * Renders a stored layout-agent Lang string against its manifest. Returns the
 * `fallback` report when there is no usable Lang or the manifest is empty —
 * keeping the deterministic ReportBlockRenderer path for old/edge cases.
 */
export function OpenUiReport({ lang, manifest, fallback = null }: { lang: string; manifest?: OpenUiManifest; fallback?: ReactNode }) {
    const hasLang = typeof lang === "string" && lang.trim().length > 0;
    const hasManifest = !!manifest && (manifest.datasets?.length ?? 0) > 0;
    if (!hasLang || !hasManifest) return fallback;
    return (
        <LangBoundary fallback={fallback}>
            <ManifestProvider manifest={manifest}>
                <Renderer response={lang} library={openUiLibrary} isStreaming={false} />
            </ManifestProvider>
        </LangBoundary>
    );
}