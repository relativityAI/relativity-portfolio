/**
 * Central ECharts registration + shared design-token access.
 *
 * The app charts were previously rendered with recharts; this module replaces
 * it with Apache ECharts (v6). Import ECharts ONLY through this file: it
 * registers the minimal set of components each chart needs from
 * `echarts/core`, so the bundle stays small and every chart shares one
 * registration (double registration is a no-op, so any entry-point import is
 * safe).
 *
 * Colors: ECharts renders into SVG/canvas where `var(--x)` strings do NOT
 * resolve. ResolvedTheme reads the computed CSS custom properties at render
 * time — so themes (html.dark) and future token changes flow through without
 * any duplicated hex palette here.
 */
import * as echarts from "echarts/core";
import {
    BarChart,
    BoxplotChart,
    CustomChart,
    HeatmapChart,
    LineChart,
    PieChart,
    RadarChart,
    ScatterChart,
} from "echarts/charts";
import {
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    PolarComponent,
    TooltipComponent,
    VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import type { EChartsType } from "echarts/core";

// The instance type, re-exported for components holding chart refs.
export type EchartsInstance = EChartsType;

export { echarts };

echarts.use([
    BarChart,
    BoxplotChart,
    CustomChart,
    HeatmapChart,
    LineChart,
    PieChart,
    RadarChart,
    ScatterChart,
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    PolarComponent,
    TooltipComponent,
    VisualMapComponent,
    CanvasRenderer,
    SVGRenderer,
]);

type InitReturn = ReturnType<typeof echarts.init>;
export type ECOption = Parameters<InitReturn["setOption"]>[0];

/** Mix two hex colors; t=0 → a, t=1 → b. Used for value-driven color ramps. */
export function mixHex(a: string, b: string, t: number): string {
    const pa = parseHex(a);
    const pb = parseHex(b);
    const k = Math.max(0, Math.min(1, t));
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] {
    const h = hex.trim().replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Design tokens → concrete color strings for ECharts.
 *
 * `dark` switches to the html.dark overrides. Callers pass the value from
 * `useColorMode().colorMode` (next-themes) so charts re-render on theme
 * switch; re-render recomputes, keeping charts in sync with the CSS.
 */
export function resolvedTheme(dark: boolean) {
    const read = (name: string, fallback: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

    const surfacePanel = read("--surface-panel", "#FFFFFF");
    const hairline = read("--hairline", "#D9D9D5");
    const accent = read("--accent-primary", "#5B7FDE");
    return {
        accent,
        ink: {
            primary: read("--ink-primary", "#16181B"),
            secondary: read("--ink-secondary", "#6B7280"),
            tertiary: read("--ink-tertiary", "#676E79"),
        },
        surface: {
            canvas: read("--surface-canvas", "#FAFAF9"),
            panel: surfacePanel,
            floating: read("--surface-floating", "#FFFFFF"),
            recessed: read("--surface-recessed", "#F4F4F3"),
        },
        hairline,
        gridLine: read("--grid-line", "#C7C7C2"),
        signals: {
            positive: read("--signal-positive", "#3A7258"),
            caution: read("--signal-caution", "#8A6B3B"),
            negative: read("--signal-negative", "#A64D4D"),
        },
        chart: [
            read("--chart-1", "#23747D"),
            read("--chart-2", "#8A6B3B"),
            read("--chart-3", "#5B7FDE"),
            read("--chart-4", "#A64D4D"),
            read("--chart-5", "#3A7258"),
        ],
        fonts: {
            mono: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
            body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            tabular: "'JetBrains Mono', 'Inter', monospace",
        },
        // Chart-internal derived tokens, matched to the app's surface system.
        barTrack: dark ? "#1F232A" : "#E4E4E1",
        tooltipBg: surfacePanel,
    };
}

export type ResolvedTheme = ReturnType<typeof resolvedTheme>;

/** Shared tooltip visuals — every chart tooltip should read identically. */
export function tooltipStyle(t: ResolvedTheme) {
    return {
        backgroundColor: t.tooltipBg,
        borderColor: t.hairline,
        borderWidth: 1,
        padding: [7, 10] as [number, number],
        textStyle: {
            color: t.ink.primary,
            fontFamily: t.fonts.mono,
            fontSize: 11.5,
        },
        extraCssText:
            "border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,0.14);white-space:nowrap;",
    };
}

/**
 * React key for chart elements that must survive theme switches.
 *
 * Why: ECharts bakes colors into the rendered SVG/canvas at setOption time.
 * echarts-for-react memoizes `option` by reference, so a `resolvedTheme()`
 * built inline produces a new option object but the same rendered colors.
 * Keying the chart element on colorMode forces a clean re-mount, which
 * re-resolves every token.
 */
export function themeKey(colorMode: string): string {
    return colorMode;
}
