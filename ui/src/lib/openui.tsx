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
import { Component, createContext, useContext, type ReactNode } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod";
import { Box, Flex, Text } from "@chakra-ui/react";
import { useColorMode } from "@/compat/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Echart from "@/components/shared/Echart";
import { resolvedTheme, tooltipStyle, type ResolvedTheme, type ECOption } from "@/lib/echarts";
import { scoreSignal } from "@/lib/analysisFormat";

// ---------------------------------------------------------------------------
// Manifest types — CANONICAL definitions live in api/src/types/layout.ts (the
// wire contract persisted to analysis_runs.artifacts). Type-only import: the
// alias never reaches vite because esbuild erases it, so the UI must never
// import runtime values from @api/.
// ---------------------------------------------------------------------------

import type {
    LayoutManifest as OpenUiManifest,
    ManifestDataset as OpenUiDataset,
    ManifestMetric as OpenUiMetric,
    ManifestMetricField as OpenUiMetricField,
    MetricUnit as OpenUiMetricUnit,
} from "@api/types/layout";

/** Re-exported because test fixtures type themselves against it. */
export type { OpenUiManifest };


// ---------------------------------------------------------------------------
// Manifest context + id resolution
// ---------------------------------------------------------------------------

// Default is never read — every render happens under ManifestProvider — but the
// context demands one, so cast rather than fabricate a fake manifest.
const ManifestContext = createContext<OpenUiManifest>({} as OpenUiManifest);

export function ManifestProvider({ manifest, children }: { manifest: OpenUiManifest; children: ReactNode }) {
    return <ManifestContext.Provider value={manifest}>{children}</ManifestContext.Provider>;
}

export function useManifest(): OpenUiManifest {
    return useContext(ManifestContext);
}

/** Resolve a `@ds:` / `@lit:` / `@mt:` ref against the manifest. */
function resolveRef(manifest: OpenUiManifest, ref: string | null | undefined): unknown {
    if (!ref) return undefined;
    if (ref.startsWith("@ds:")) return manifest.datasets?.find((d) => d.id === ref.slice(4));
    if (ref.startsWith("@mt:")) return manifest.metrics?.find((m) => m.id === ref.slice(4));
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

/**
 * Borderless figure — the report's only grouping device. A plain title sitting
 * above content that rides directly on the page canvas. No card, no lines.
 */
function Figure({ title, children }: { title?: string | null; children: ReactNode }) {
    return (
        <Box>
            {title && (
                <Text display="block" fontSize="13px" fontWeight={500} color="var(--ink-primary)" mb={3}>
                    {sentenceCase(title)}
                </Text>
            )}
            {children}
        </Box>
    );
}

function lineOption(
    t: ResolvedTheme,
    x: string[],
    series: { name: string; data: (number | null)[] }[],
    markPoint?: Record<string, unknown>,
    xName?: string,
    yName?: string,
    style: { step?: boolean; area?: boolean } = {},
): ECOption {
    const multi = series.length > 1;
    const axisName = { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 };
    return {
        tooltip: { trigger: "axis", valueFormatter: (v) => compactNumber(v), ...tooltipStyle(t) },
        legend: { top: 0, textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 }, data: series.map((s) => s.name) },
        dataZoom: { type: "inside" },
        grid: { left: 8, right: 8, top: yName || multi ? 44 : 30, bottom: xName ? 26 : 8, containLabel: true },
        xAxis: {
            type: "category",
            data: x,
            ...(xName ? { name: clip(xName, 22), nameLocation: "middle", nameGap: 22, nameTextStyle: axisName } : {}),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: t.hairline } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 },
        },
        yAxis: {
            type: "value",
            scale: true,
            ...(yName ? { name: clip(yName, 22), nameLocation: "end", nameRotate: 0, nameGap: 10, nameTextStyle: { ...axisName, align: "left" } } : {}),
            splitLine: { lineStyle: { color: t.gridLine } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5, formatter: (v) => compactNumber(v) },
        },
        series: series.map((s, i) => ({
            name: s.name,
            type: "line",
            showSymbol: false,
            smooth: !style.step,
            ...(style.step ? { step: "middle" as const } : {}),
            data: s.data,
            lineStyle: { width: i === 0 ? 2 : 1.25, color: i === 0 ? t.accent : t.chart[i % t.chart.length] },
            itemStyle: { color: i === 0 ? t.accent : t.chart[i % t.chart.length] },
            ...(style.area ? { areaStyle: { opacity: 0.12, color: i === 0 ? t.accent : t.chart[i % t.chart.length] } } : {}),
            // Label the last plotted point (first series) — the reader's "current" value.
            ...(i === 0 ? { endLabel: { show: true, formatter: (p: { value: number }) => compactNumber(p.value), color: t.ink.primary, fontFamily: t.fonts.tabular, fontSize: 10.5 } } : {}),
            ...(i === 0 && markPoint ? { markPoint } : {}),
        })),
    };
}

function barOption(
    t: ResolvedTheme,
    cats: string[],
    xName: string,
    yName: string,
    series: { name: string; data: (number | null)[] }[],
    opts: { horizontal?: boolean } = {},
): ECOption {
    const horizontal = !!opts.horizontal;
    const multi = series.length > 1;
    const axisName = { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5 };
    const rotate = horizontal || cats.length <= 8 ? 0 : 24;
    const catAxis = {
        type: "category" as const,
        data: cats,
        name: clip(xName, 22),
        nameLocation: "middle" as const,
        nameGap: horizontal ? 22 : rotate ? 44 : 22,
        nameTextStyle: axisName,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: t.hairline } },
        axisLabel: {
            color: t.ink.tertiary,
            fontFamily: t.fonts.tabular,
            fontSize: 10.5,
            interval: horizontal ? 0 : Math.max(0, Math.ceil(cats.length / 12) - 1),
            rotate,
            formatter: (v: string) => clip(String(v), 16),
        },
    };
    const valAxis = {
        type: "value" as const,
        name: clip(yName, 22),
        nameLocation: "end" as const,
        nameRotate: 0,
        nameGap: 10,
        nameTextStyle: { ...axisName, align: "left" as const },
        splitLine: { lineStyle: { color: t.gridLine } },
        axisLine: { lineStyle: { color: t.hairline } },
        axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5, formatter: (v: number) => compactNumber(v) },
    };
    return {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => compactNumber(v), ...tooltipStyle(t) },
        legend: { top: 0, textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 }, data: series.map((s) => s.name) },
        grid: { left: 8, right: 8, top: 30, bottom: horizontal ? 30 : rotate ? 56 : 34, containLabel: true },
        xAxis: horizontal ? valAxis : catAxis,
        yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
        series: series.map((s, i) => ({
            name: s.name,
            type: "bar",
            data: s.data,
            barMaxWidth: horizontal ? 22 : 26,
            barGap: "10%",
            itemStyle: { color: multi ? t.chart[i % t.chart.length] : t.accent, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
            label: {
                show: true,
                position: horizontal ? "right" : "top",
                // Only the last bar carries its value — a labelled end point, not a wall of numbers.
                formatter: (p: { value: number; dataIndex: number }) => (p.dataIndex === s.data.length - 1 ? compactNumber(p.value) : ""),
                color: t.ink.primary,
                fontFamily: t.fonts.tabular,
                fontSize: 10.5,
            },
        })),
    };
}

function stackedBarOption(t: ResolvedTheme, cats: string[], catName: string, segments: { name: string; data: (number | null)[] }[]): ECOption {
    const multi = segments.length > 1;
    const axisName = {
        color: t.ink.tertiary,
        fontFamily: t.fonts.tabular,
        fontSize: 10.5,
    };
    return {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => compactNumber(v), ...tooltipStyle(t) },
        ...(multi ? { legend: { top: 0, textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 }, data: segments.map((s) => s.name) } } : {}),
        grid: { left: 8, right: 8, top: multi ? 44 : 34, bottom: 8, containLabel: true },
        xAxis: {
            type: "value",
            splitLine: { lineStyle: { color: t.gridLine } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5, formatter: (v) => compactNumber(v) },
            axisLine: { lineStyle: { color: t.hairline } },
        },
        yAxis: {
            type: "category",
            inverse: true,
            data: cats,
            name: clip(catName, 22),
            nameLocation: "end",
            nameRotate: 0,
            nameGap: 10,
            nameTextStyle: { ...axisName, align: "left" },
            axisTick: { show: false },
            axisLine: { lineStyle: { color: t.hairline } },
            axisLabel: { color: t.ink.tertiary, fontFamily: t.fonts.tabular, fontSize: 10.5, formatter: (v) => clip(String(v), 16) },
        },
        series: segments.map((s, i) => ({
            name: s.name,
            type: "bar",
            stack: "total",
            data: s.data,
            barMaxWidth: 22,
            itemStyle: { color: t.chart[i % t.chart.length], borderRadius: i === segments.length - 1 ? [0, 3, 3, 0] : 0 },
        })),
    };
}

function pieOption(t: ResolvedTheme, items: { name: string; value: number }[], variant: "pie" | "donut" | "rose" = "pie"): ECOption {
    return {
        tooltip: { trigger: "item", valueFormatter: (v) => compactNumber(v), ...tooltipStyle(t) },
        legend: { bottom: 0, type: "scroll", textStyle: { color: t.ink.secondary, fontFamily: t.fonts.tabular, fontSize: 11 } },
        series: [
            {
                type: "pie",
                radius: variant === "donut" ? ["42%", "68%"] : variant === "rose" ? ["12%", "68%"] : ["0%", "66%"],
                ...(variant === "rose" ? { roseType: "area" as const } : {}),
                center: ["50%", "44%"],
                itemStyle: { borderColor: t.surface.canvas, borderWidth: 2, borderRadius: 4 },
                label: {
                    color: t.ink.primary,
                    fontFamily: t.fonts.tabular,
                    fontSize: 11,
                    formatter: (p: { name: string; value: number }) => `${p.name} ${compactNumber(p.value)}`,
                },
                labelLayout: { hideOverlap: true },
                data: items.map((d, i) => ({ name: clip(d.name, 24), value: d.value, itemStyle: { color: t.chart[i % t.chart.length] } })),
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

// snake_case / camelCase / kebab-case column keys → "Normal Words" for display. Already-spaced names pass through.
function columnLabel(c: string): string {
    return c
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

// Category/label column for a value series: the first text column whose values
// change across rows. A constant column (symbol, currency, source) would repeat
// on every axis tick, so it is only a last resort. Falls back to the first text
// column for single-row tables, which have nothing that varies.
function labelCol(d: OpenUiDataset, valueCols: string[]): string | undefined {
    const text = d.cols.filter((c) => !valueCols.includes(c));
    return text.find((c) => new Set(d.rows.map((r) => r[c])).size > 1) ?? text[0];
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
            axisTick: { show: false },
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
        xAxis: { type: "category", data: x, axisTick: { show: false }, axisLabel: { color: t.ink.tertiary, fontSize: 10 } },
        yAxis: { type: "category", data: y, axisTick: { show: false }, axisLabel: { color: t.ink.tertiary, fontSize: 10 } },
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

/** Compact axis/tooltip numbers: 1.2K, 3.4M, 5.6B, 7.8T. Values under 1000 render as-is. */
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export function compactNumber(v: unknown): string {
    return typeof v === "number" && Number.isFinite(v) ? compactFmt.format(v) : "—";
}

/** Truncate long display strings with an ellipsis so axis labels never clip. */
function clip(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Display label style: sentence case (first letter up, rest down). Never bold. */
function sentenceCase(v: string | null | undefined): string {
    if (v == null) return "";
    const s = String(v).trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Argmax/argmin over a (possibly null) series; returns -1 when empty. */
function extremeIndex(data: (number | null)[], dir: 1 | -1): number {
    let idx = -1;
    let best = dir === 1 ? -Infinity : Infinity;
    data.forEach((v, i) => {
        if (v == null) return;
        if (dir === 1 ? v > best : v < best) {
            best = v;
            idx = i;
        }
    });
    return idx;
}

/**
 * Price x-axis labels: day-month for spans ≤ ~3 months, month-year up to
 * ~2 years, year beyond. Unparseable dates fall back to their raw string.
 */
function priceAxisLabels(rows: Row[]): string[] {
    const raw = dateAxis(rows);
    const times = raw.map((s) => Date.parse(s));
    const valid = times.filter((n) => Number.isFinite(n));
    if (valid.length < 2) return raw;
    const spanDays = (Math.max(...valid) - Math.min(...valid)) / 86_400_000;
    const out = (d: Date) =>
        spanDays <= 92
            ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : spanDays <= 730
              ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
              : String(d.getFullYear());
    return raw.map((s, i) => (Number.isFinite(times[i]) ? out(new Date(times[i])) : s));
}

/** ₹ when the manifest source is an Indian exchange, $ otherwise. */
function currencyFor(source: string | undefined): string {
    return source && /sec|nasdaq|nyse|amex/i.test(source) ? "$" : "₹";
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
            <Box minWidth={0} flex="1 1 0">
                <Text fontSize="12px" fontWeight={500} color="var(--ink-tertiary)">
                    {sentenceCase(props.label)}
                </Text>
                <Text
                    mt={1}
                    fontSize="36px"
                    fontWeight={500}
                    fontFamily="var(--font-display, 'Newsreader', Georgia, serif)"
                    color="var(--accent-primary)"
                    letterSpacing="-0.01em"
                    lineHeight="1.05"
                >
                    {lit(props.value)}
                </Text>
                {props.sublabel && (
                    <Text mt={1} fontSize="12px" color="var(--ink-secondary)">
                        {sentenceCase(lit(props.sublabel))}
                    </Text>
                )}
            </Box>
        );
    },
});

/** Format a metric value for its unit. Currency abbreviates large magnitudes so
 *  a raw enterprise value doesn't render as a 13-digit wall. */
function formatMetric(v: number | string, unit: OpenUiMetricUnit, cur: string): string {
    if (typeof v !== "number") return String(v);
    if (unit === "pct") return `${fmt(v)}%`;
    if (unit === "x") return `${fmt(v)}x`;
    if (unit === "cur") {
        const a = Math.abs(v);
        if (cur === "₹") {
            if (a >= 1e7) return `₹${fmt(v / 1e7)} Cr`;
            if (a >= 1e5) return `₹${fmt(v / 1e5)} L`;
        } else {
            if (a >= 1e9) return `$${fmt(v / 1e9)}B`;
            if (a >= 1e6) return `$${fmt(v / 1e6)}M`;
            if (a >= 1e3) return `$${fmt(v / 1e3)}K`;
        }
    }
    return fmt(v);
}

const MetricGrid = defineComponent({
    name: "MetricGrid",
    description: "A compact embedded grid of measured numbers (small label above, large value below). data is an @mt ref; keys is an optional comma-separated subset of field keys to show, in order; title is an optional heading.",
    props: z.object({
        data: z.string().optional(),
        keys: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const group = resolveRef(m, props.data) as OpenUiMetric | undefined;
        if (!group?.fields?.length) return null;
        const byKey = new Map(group.fields.map((f) => [f.key, f]));
        const want = (props.keys ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const fields = (want.length ? want.map((k) => byKey.get(k)).filter((f): f is OpenUiMetricField => !!f) : group.fields).slice(0, 12);
        if (!fields.length) return null;
        const cur = currencyFor(m.identity?.source);
        const size = fields.length > 8 ? "22px" : fields.length > 4 ? "26px" : "32px";
        return (
            <Box>
                {props.title && (
                    <Text mb={3} fontSize="12px" fontWeight={500} color="var(--ink-tertiary)">
                        {sentenceCase(props.title)}
                    </Text>
                )}
                <Flex wrap="wrap" columnGap={8} rowGap={5}>
                    {fields.map((f) => (
                        <Box key={f.key} flex="1 1 110px" minWidth="90px">
                            <Text
                                fontSize="10.5px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                fontFamily="var(--font-body, 'Anek Latin', 'Inter', sans-serif)"
                                lineHeight="1.3"
                            >
                                {f.label}
                            </Text>
                            <Text
                                mt={1}
                                fontSize={size}
                                fontWeight={300}
                                fontFamily="var(--font-display, 'Newsreader', Georgia, serif)"
                                color="var(--ink-primary)"
                                letterSpacing="-0.01em"
                                lineHeight="1.1"
                            >
                                {formatMetric(f.value, f.unit, cur)}
                            </Text>
                        </Box>
                    ))}
                </Flex>
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
        const axis = priceAxisLabels(main.rows);
        // ponytail: label max/min of the plotted close line — price_candles has
        // no OHLC, so true day-high/low would need an upstream data change.
        const cur = currencyFor(m.identity?.source);
        const point = (i: number, name: string, color: string) =>
            i < 0 || series[0].data[i] == null
                ? null
                : {
                      name,
                      coord: [i, series[0].data[i]],
                      value: series[0].data[i],
                      symbol: "circle",
                      symbolSize: 6,
                      itemStyle: { color },
                      label: {
                          show: true,
                          position: name === "High" ? "top" : "bottom",
                          formatter: `${cur}${fmt(series[0].data[i])}\n${String(main.rows[i]?.date ?? axis[i])}`,
                          color: t.ink.primary,
                          fontFamily: t.fonts.tabular,
                          fontSize: 10.5,
                          lineHeight: 14,
                      },
                  };
        const markPoint = closeIdx >= 0
            ? { data: [point(extremeIndex(series[0].data, 1), "High", t.chart[4]), point(extremeIndex(series[0].data, -1), "Low", t.chart[3])].filter(Boolean) }
            : undefined;
        const dateCol = main.cols.find((c) => /date|ds|timestamp/i.test(c));
        return (
            <Figure title={props.title}>
                <Echart
                    option={lineOption(t, axis, series, markPoint, dateCol ? columnLabel(dateCol) : undefined, series[0]?.name)}
                    height={260}
                    ariaLabel={props.title ?? "Price chart"}
                />
            </Figure>
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
        const dateCol = d.cols.find((c) => /date|ds|timestamp/i.test(c));
        return (
            <Figure title={props.title}>
                <Echart
                    option={lineOption(t, dateAxis(d.rows), cols.map((c) => ({ name: c.col, data: vals(d.rows, c.col) })), undefined, dateCol ? columnLabel(dateCol) : undefined, columnLabel(cols[0].col))}
                    height={240}
                    ariaLabel={props.title ?? "Multi-line chart"}
                />
            </Figure>
        );
    },
});

// Fresh instance per component — the library names each $defs entry by schema
// identity, so a shared object would collapse Area/Step/Smooth under one def.
const timeSeriesSchema = () =>
    z.object({
        data: z.string().optional(),
        value: z.string().optional(),
        title: z.string().optional(),
    });

/** Shared body for the single-series line variants (Area / Step / Smooth). */
function TimeSeries({ props, style }: { props: { data?: string; value?: string; title?: string }; style: { step?: boolean; area?: boolean } }) {
    const m = useManifest();
    const t = useLayoutTheme();
    const d = datasetOf(m, props.data);
    if (!d || d.rows.length === 0) return null;
    const yCol = (props.value && d.cols.includes(props.value) ? props.value : undefined) ?? numericCols(d)[0]?.col;
    if (!yCol) return null;
    const dateCol = d.cols.find((c) => /date|ds|timestamp/i.test(c));
    return (
        <Figure title={props.title}>
            <Echart
                option={lineOption(t, dateAxis(d.rows), [{ name: columnLabel(yCol), data: vals(d.rows, yCol) }], undefined, dateCol ? columnLabel(dateCol) : undefined, columnLabel(yCol), style)}
                height={240}
                ariaLabel={props.title ?? "Line chart"}
            />
        </Figure>
    );
}

const AreaChart = defineComponent({
    name: "AreaChart",
    description: "Filled single-series line over dates (a trend where magnitude matters). data is an @ds ref, value is the optional numeric column (defaults to the first numeric column), title is a display string.",
    props: timeSeriesSchema(),
    component: ({ props }) => <TimeSeries props={props} style={{ area: true }} />,
});

const StepLineChart = defineComponent({
    name: "StepLineChart",
    description: "Single-series step line over dates — for values that hold then jump (rates, tiers, thresholds). data is an @ds ref, value is the optional numeric column, title is a display string.",
    props: timeSeriesSchema(),
    component: ({ props }) => <TimeSeries props={props} style={{ step: true }} />,
});

const SmoothLineChart = defineComponent({
    name: "SmoothLineChart",
    description: "Single smoothed series line over dates. data is an @ds ref, value is the optional numeric column, title is a display string.",
    props: timeSeriesSchema(),
    component: ({ props }) => <TimeSeries props={props} style={{}} />,
});

const barSchema = () =>
    z.object({
        data: z.string().optional(),
        x: z.string().optional(),
        y: z.string().optional(),
        title: z.string().optional(),
    });

/** Shared body for the bar variants (Bar / Grouped / Horizontal). y may be a
 *  comma-separated list of numeric columns → one clustered series per column. */
function Bar({ props, horizontal }: { props: { data?: string; x?: string; y?: string; title?: string }; horizontal?: boolean }) {
    const m = useManifest();
    const t = useLayoutTheme();
    const d = datasetOf(m, props.data);
    if (!d || d.rows.length === 0) return null;
    const yCandidates = numericCols(d);
    const xCol = props.x && d.cols.includes(props.x) ? props.x : labelCol(d, yCandidates.map((n) => n.col)) ?? d.cols[0];
    const requested = (props.y ?? "").split(",").map((s) => s.trim()).filter((c) => c && d.cols.includes(c));
    const yCols = (requested.length ? requested : [yCandidates[0]?.col]).filter((c): c is string => !!c).slice(0, 4);
    if (!xCol || !yCols.length) return null;
    return (
        <Figure title={props.title}>
            <Echart
                option={barOption(t, d.rows.map((r) => fmt(r[xCol])), columnLabel(xCol), yCols.length === 1 ? columnLabel(yCols[0]) : "Value", yCols.map((c) => ({ name: columnLabel(c), data: vals(d.rows, c) })), { horizontal })}
                height={240}
                ariaLabel={props.title ?? `${yCols.join(", ")} bar chart`}
            />
        </Figure>
    );
}

const BarChart = defineComponent({
    name: "BarChart",
    description: "Categorical bar chart. data is an @ds ref, x is the category column, y is the numeric column — or several comma-separated numeric columns for grouped bars — title is a display string.",
    props: barSchema(),
    component: ({ props }) => <Bar props={props} />,
});

const GroupedBarChart = defineComponent({
    name: "GroupedBarChart",
    description: "Clustered bar chart comparing 2+ numeric columns across categories. data is an @ds ref, x is the category column, y is a comma-separated list of 2+ numeric columns, title is a display string.",
    props: barSchema(),
    component: ({ props }) => <Bar props={props} />,
});

const HorizontalBarChart = defineComponent({
    name: "HorizontalBarChart",
    description: "Horizontal categorical bars, best when category labels are long or there are many categories. data is an @ds ref, x is the category column, y is the numeric column — or a comma-separated list for grouped bars — title is a display string.",
    props: barSchema(),
    component: ({ props }) => <Bar props={props} horizontal />,
});

const pieSchema = () =>
    z.object({
        data: z.string().optional(),
        name: z.string().optional(),
        value: z.string().optional(),
        title: z.string().optional(),
    });

/** Shared body for the pie variants (Pie / Donut / Rose). */
function Pie({ props, variant }: { props: { data?: string; name?: string; value?: string; title?: string }; variant: "pie" | "donut" | "rose" }) {
    const m = useManifest();
    const t = useLayoutTheme();
    const d = datasetOf(m, props.data);
    if (!d) return null;
    const yCandidates = numericCols(d);
    const nameCol = props.name && d.cols.includes(props.name) ? props.name : labelCol(d, yCandidates.map((n) => n.col)) ?? d.cols[0];
    const valueCol = props.value && d.cols.includes(props.value) ? props.value : yCandidates[0]?.col;
    if (!nameCol || !valueCol) return null;
    const items = d.rows
        .map((r) => ({ name: fmt(r[nameCol]), value: numeric(valueCol, r[valueCol]) }))
        .filter((i): i is { name: string; value: number } => i.value != null)
        .slice(0, 12);
    if (!items.length) return null;
    return (
        <Figure title={props.title}>
            <Echart option={pieOption(t, items, variant)} height={240} ariaLabel={props.title ?? "Share breakdown"} />
        </Figure>
    );
}

const PieChart = defineComponent({
    name: "PieChart",
    description: "Share breakdown as a full pie. data is an @ds ref, name is the label column, value is the numeric column, title is a display string.",
    props: pieSchema(),
    component: ({ props }) => <Pie props={props} variant="pie" />,
});

const DonutChart = defineComponent({
    name: "DonutChart",
    description: "Share breakdown as a ring (donut). data is an @ds ref, name is the label column, value is the numeric column, title is a display string.",
    props: pieSchema(),
    component: ({ props }) => <Pie props={props} variant="donut" />,
});

const RoseChart = defineComponent({
    name: "RoseChart",
    description: "Share breakdown as a rose (equal-angle, radius by value) — for comparing many similar-sized slices. data is an @ds ref, name is the label column, value is the numeric column, title is a display string.",
    props: pieSchema(),
    component: ({ props }) => <Pie props={props} variant="rose" />,
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
            <Figure title={props.title}>
                <Echart option={boxOption(t, cols.map((c) => ({ name: c.col, data: c.values })))} height={240} ariaLabel={props.title ?? "Distribution boxes"} />
            </Figure>
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
            <Figure title={props.title}>
                <Echart
                    option={heatOption(t, xs, cols.map((c) => c.col), cells, min, max)}
                    height={Math.max(150, 64 + rows.length * 6 + cols.length * 20)}
                    ariaLabel={props.title ?? "Heatmap"}
                />
            </Figure>
        );
    },
});

const DataTable = defineComponent({
    name: "DataTable",
    description: "Renders a table dataset (@ds ref) as a plain table. maxRows caps rows (default 12); columns is an optional comma-separated list selecting which columns to show, in that order.",
    props: z.object({
        data: z.string().optional(),
        maxRows: z.number().optional(),
        columns: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const d = datasetOf(m, props.data);
        if (!d || !d.cols.length) return null;
        const picked = props.columns?.split(",").map((c) => c.trim()).filter((c) => d.cols.includes(c)) ?? [];
        // ponytail: bad/empty selection falls back to all columns rather than a blank table — tighten if the model needs a hard failure
        const cols = picked.length ? picked : d.cols;
        const rows = d.rows.slice(0, props.maxRows ?? 12);
        return (
            <Figure title={d.label}>
                <Box overflowX="auto">
                    <Box as="table" w="full" fontSize="12px" borderCollapse="collapse">
                        <Box as="thead">
                            <Box as="tr">
                                {cols.map((c) => (
                                    <Box
                                        as="th"
                                        key={c}
                                        textAlign="left"
                                        color="var(--ink-tertiary)"
                                        pb={2}
                                        pr={3}
                                        borderBottom="1px solid var(--hairline)"
                                        whiteSpace="nowrap"
                                        fontSize="11px"
                                    >
                                        {columnLabel(c)}
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                        <Box as="tbody">
                            {rows.map((r, i) => (
                                <Box as="tr" key={i}>
                                    {cols.map((c) => (
                                        <Box as="td" key={c} py={1.5} pr={3} color="var(--ink-primary)" fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" fontSize="12px" whiteSpace="nowrap">
                                            {fmt(r[c])}
                                        </Box>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>
            </Figure>
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
        const d = datasetOf(m, props.data ?? "@ds:score_skills");
        if (!d) return null;
        const rows = d.rows.slice(0, 20);
        return (
            <Figure title={props.title ?? "Skill scores"}>
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
                                    <Box
                                        h="full"
                                        borderRadius="full"
                                        width={`${Math.max(0, Math.min(100, score ?? 0))}%`}
                                        background={`var(--signal-${scoreSignal(score ?? 0)})`}
                                        transition="width .4s ease"
                                    />
                                </Box>
                            </Box>
                        );
                    })}
                </Flex>
            </Figure>
        );
    },
});

const MarkdownBlock = defineComponent({
    name: "MarkdownBlock",
    description: "One block of analyst prose. The single positional arg is either a skill id (whole skill) or a section ref \"@md:<section-id>\" (one section of a skill's prose).",
    props: z.object({
        skill: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const arg = props.skill ?? "";
        if (arg.startsWith("@md:")) {
            const id = arg.slice(4);
            const section = m.skills?.flatMap((s) => s.sections ?? []).find((sec) => sec.id === id);
            if (!section?.markdown?.trim()) return null;
            return (
                <Box className="skill-md" sx={{ "& h1,& h2,& h3": { mt: 2, mb: 1 } }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.markdown}</ReactMarkdown>
                </Box>
            );
        }
        const skill = arg ? m.skills?.find((s) => s.id === arg || s.name === arg) : undefined;
        if (!skill) return null;
        if (skill.markdown?.trim()) {
            return (
                <Box className="skill-md" sx={{ "& h1,& h2,& h3": { mt: 2, mb: 1 } }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.markdown}</ReactMarkdown>
                </Box>
            );
        }
        return (
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
        );
    },
});

const Divider = defineComponent({
    name: "Divider",
    description: "A horizontal rule separating major sections of the report. Takes no arguments.",
    props: z.object({}),
    component: () => <Box h="1px" w="full" background="var(--hairline)" role="separator" aria-orientation="horizontal" />,
});

const StackedBarChart = defineComponent({
    name: "StackedBarChart",
    description: "Horizontal stacked bar chart. data is an @ds ref; x is the category column; every other numeric column becomes a stacked segment.",
    props: z.object({
        data: z.string().optional(),
        x: z.string().optional(),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const m = useManifest();
        const t = useLayoutTheme();
        const d = datasetOf(m, props.data);
        if (!d || d.rows.length === 0) return null;
        const segs = numericCols(d);
        if (!segs.length) return null;
        const xCol =
            (props.x && d.cols.includes(props.x) ? props.x : undefined) ??
            labelCol(d, segs.map((s) => s.col)) ??
            d.cols[0];
        const segments = segs
            .filter((s) => s.col !== xCol)
            .slice(0, 6)
            .map((s) => ({ name: s.col, data: vals(d.rows, s.col) }));
        if (!segments.length) return null;
        const cats = d.rows.map((r) => fmt(r[xCol]));
        return (
            <Figure title={props.title}>
                <Echart
                    option={stackedBarOption(t, cats, columnLabel(xCol), segments)}
                    height={Math.max(180, 60 + cats.length * 22)}
                    ariaLabel={props.title ?? "Stacked bar chart"}
                />
            </Figure>
        );
    },
});

const LEAF_REFS = z.array(
    z.union([
        StatHero.ref,
        PriceChart.ref,
        MultiLineChart.ref,
        AreaChart.ref,
        StepLineChart.ref,
        SmoothLineChart.ref,
        BarChart.ref,
        GroupedBarChart.ref,
        HorizontalBarChart.ref,
        StackedBarChart.ref,
        Divider.ref,
        PieChart.ref,
        DonutChart.ref,
        RoseChart.ref,
        BoxPlotChart.ref,
        HeatmapChart.ref,
        DataTable.ref,
        MetricGrid.ref,
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
        const m = useManifest();
        const kids = props.children ? (Array.isArray(props.children) ? props.children : [props.children]) : [];
        // Collapse consecutive StatHero leaves into one horizontal strip, so a
        // run of metrics reads as a row instead of a stack of full-width cards.
        const groups: unknown[][] = [];
        for (const c of kids) {
            const isHero = (c as { typeName?: string }).typeName === "StatHero";
            const last = groups[groups.length - 1];
            if (isHero && last && (last[0] as { typeName?: string }).typeName === "StatHero") last.push(c);
            else groups.push([c]);
        }
        let n = 0;
        return (
            <Flex className="report-container" direction="column" gap={7}>
                {props.symbol && (
                    <Flex align="baseline" gap={3} flexWrap="wrap">
                        <Text
                            fontFamily="var(--font-display, 'Newsreader', Georgia, serif)"
                            fontSize="27px"
                            fontWeight={600}
                            letterSpacing="-0.01em"
                            lineHeight={1.25}
                            color="var(--ink-primary)"
                        >
                            {props.symbol}
                        </Text>
                        {m.identity?.shareName && (
                            <Text fontSize="13px" fontWeight={500} color="var(--ink-secondary)">
                                {m.identity.shareName}
                            </Text>
                        )}
                        {m.identity?.asOf && (
                            <Text ml="auto" fontSize="12px" fontFamily="var(--font-mono, 'JetBrains Mono', monospace)" color="var(--ink-tertiary)">
                                as of {m.identity.asOf}
                            </Text>
                        )}
                    </Flex>
                )}
                {groups.map((g) => {
                    const key = (g[0] as { statementId?: string }).statementId ?? `g${n++}`;
                    if (g.length > 1) {
                        return (
                            <Flex key={key} data-hero-row="" gap={6} wrap="wrap" align="stretch">
                                {g.map((c, i) => (
                                    <Box
                                        key={(c as { statementId?: string }).statementId ?? i}
                                        flex="1 1 160px"
                                        minWidth="160px"
                                    >
                                        {renderNode(c)}
                                    </Box>
                                ))}
                            </Flex>
                        );
                    }
                    return <Box key={key}>{renderNode(g[0])}</Box>;
                })}
            </Flex>
        );
    },
});

export const openUiLibrary = createLibrary({
    components: [StatHero, PriceChart, MultiLineChart, AreaChart, StepLineChart, SmoothLineChart, BarChart, GroupedBarChart, HorizontalBarChart, StackedBarChart, Divider, PieChart, DonutChart, RoseChart, BoxPlotChart, HeatmapChart, DataTable, MetricGrid, SkillScoreCard, MarkdownBlock, AnalysisPage],
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
    const hasManifest = !!manifest && ((manifest.datasets?.length ?? 0) > 0 || (manifest.metrics?.length ?? 0) > 0);
    if (!hasLang || !hasManifest) return fallback;
    return (
        <LangBoundary fallback={fallback}>
            <ManifestProvider manifest={manifest}>
                <Renderer response={lang} library={openUiLibrary} isStreaming={false} />
            </ManifestProvider>
        </LangBoundary>
    );
}