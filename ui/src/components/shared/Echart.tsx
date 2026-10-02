import { useEffect, useRef } from "react";
import { Box } from "@/compat/ui";
import { useColorMode } from "@/compat/ui";
import { echarts, type ECOption, type EchartsInstance } from "@/lib/echarts";

/**
 * App-wide ECharts wrapper — a minimal React binding written directly on
 * echarts/core (init / setOption / dispose / resize).
 *
 * History: this first used `echarts-for-react`, but its CJS build breaks
 * under this project's Vite 8 (rolldown) CJS-ESM interop — the default export
 * arrived as a namespace object and React threw "Element type is invalid".
 * The binding it provides is ~40 lines, so we own it instead.
 *
 * - Theme-aware: charts re-mount on color-mode change so token colors baked
 *   into the SVG re-resolve (see lib/echarts.ts resolvedTheme).
 * - a11y: renders with role="img" + caller's label. The old chart library
 *   exposed nothing to AT; that pattern is now the default for every chart.
 * - notMerge: option objects here are rebuilt per render; merging would leave
 *   stale series/axis state behind on data changes.
 */
export default function Echart({
    option,
    height,
    ariaLabel,
    className,
    style,
    onEvents,
}: {
    option: ECOption;
    height: number | string;
    ariaLabel?: string;
    className?: string;
    style?: React.CSSProperties;
    onEvents?: Record<string, (params: unknown) => void>;
}) {
    const { colorMode } = useColorMode();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<EchartsInstance | null>(null);
    const eventsRef = useRef(onEvents);
    eventsRef.current = onEvents;

    // Init once per mount (mounts are keyed on colorMode, so a theme switch
    // re-runs this with freshly resolved CSS tokens).
    useEffect(() => {
        if (!containerRef.current) return;
        const chart = echarts.init(containerRef.current, undefined, { renderer: "svg" });
        chartRef.current = chart;
        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(containerRef.current);
        return () => {
            ro.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, [colorMode]);

    // Push option updates into the live instance without re-creating it.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.setOption(option, { notMerge: true });
        // onEvents are rebound by identity so handlers always see fresh state.
        const groups = Object.entries(eventsRef.current ?? {}) as [string, (p: unknown) => void][];
        for (const [event, handler] of groups) {
            chart.on(event, (p: unknown) => handler(p));
        }
        return () => {
            for (const [event] of groups) chart.off(event);
        };
    }, [option, colorMode]);

    return (
        <Box
            ref={containerRef}
            w="full"
            role="img"
            aria-label={ariaLabel}
            className={className}
            style={{ height, ...style }}
        />
    );
}
