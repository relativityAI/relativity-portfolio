import { useMemo } from "react";
import { Box, Flex, Text } from "@/compat/ui";
import { useColorMode } from "@/compat/ui";
import Echart from "@/components/shared/Echart";
import { resolvedTheme, tooltipStyle, mixHex } from "@/lib/echarts";

/**
 * AgentPerformanceChart — ranked small multiples, one row per agent.
 *
 * History: this section spent two iterations as a single multi-line chart of
 * cumulative average fit. In a 280px sidebar that chart had structural
 * problems no styling could fix: three lines crossing in ~240px of plot
 * flatten into a braid where nobody leads; a cumulative average is domed
 * by construction (early runs move it violently, later runs barely at all),
 * so late-run collapses stayed invisible until they fully happened; and the
 * legend repeated names the tooltip already showed.
 *
 * The honest replacement: per-agent rows, each with its own sparkline of RAW
 * run scores (not the cumulative average — the raw series is where trends
 * actually live), the agent's current average fit as the anchor number, and
 * a delta chip reading the direction of the last three runs. Rows sort by
 * that average, so the ranking is the layout. One shared color per agent is
 * kept only as the row swatch, tying this section to the group-header
 * avatars elsewhere on the page.
 *
 * Agents appear once they have ≥2 completed runs; unscored runs don't exist
 * here (same contract as before).
 */

export interface AgentPerfItem {
    agent_name?: string;
    agent?: string;
    total_score?: number | null;
    created_at?: string;
}

interface AgentRow {
    name: string;
    color: string;
    /** Raw run scores, oldest → newest. */
    scores: number[];
    avg: number;
    /** Last 3 runs vs the runs before them; null when there aren't enough. */
    delta: number | null;
    /** Last run time, for the "last ran" stamp. */
    lastTs: number;
}

const DELTA_WINDOW = 3;

export default function AgentPerformanceChart({
    analyses,
    agentDisplay,
}: {
    analyses: AgentPerfItem[];
    /** Resolve stored agent ids to display names (caller owns the lookup). */
    agentDisplay: (raw: string | undefined) => string;
}) {
    const { colorMode } = useColorMode();
    const t = resolvedTheme(colorMode === "dark");

    const rows = useMemo<AgentRow[]>(() => {
        const byAgent = new Map<string, { pts: { t: number; s: number }[] }>();
        for (const a of analyses) {
            const raw = a.agent_name || a.agent;
            if (!raw || a.total_score == null || !Number.isFinite(Number(a.total_score))) continue;
            const name = agentDisplay(raw) || raw;
            if (!byAgent.has(name)) byAgent.set(name, { pts: [] });
            byAgent.get(name)!.pts.push({ t: +new Date(a.created_at ?? 0), s: Number(a.total_score) });
        }
        return [...byAgent.entries()]
            .filter(([, v]) => v.pts.length >= 2)
            .map(([name, v], i) => {
                const pts = [...v.pts].sort((p, q) => p.t - q.t);
                const scores = pts.map((p) => p.s);
                const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
                const recent = scores.slice(-DELTA_WINDOW);
                const prior = scores.slice(0, -DELTA_WINDOW);
                const delta =
                    prior.length > 0
                        ? recent.reduce((s, x) => s + x, 0) / recent.length -
                          prior.reduce((s, x) => s + x, 0) / prior.length
                        : null;
                return {
                    name,
                    color: t.chart[i % t.chart.length],
                    scores,
                    avg,
                    delta,
                    lastTs: pts[pts.length - 1].t,
                };
            })
            .sort((a, b) => b.avg - a.avg);
    }, [analyses, agentDisplay, t]);

    if (rows.length === 0) {
        return (
            <Text fontSize="12px" color="var(--ink-tertiary)">
                Two completed runs from one agent make this section live. Run an analysis to start the series.
            </Text>
        );
    }

    return (
        <Flex direction="column" role="img" aria-label={`Agent performance, best first: ${rows.map((r) => `${r.name} average fit ${r.avg.toFixed(0)}`).join(", ")}`}>
            {rows.map((r) => (
                <AgentRowCard key={r.name} row={r} theme={t} />
            ))}
        </Flex>
    );
}

function AgentRowCard({ row, theme }: { row: AgentRow; theme: ReturnType<typeof resolvedTheme> }) {
    const { colorMode } = useColorMode();
    const t = theme;
    // Delta tone: toward better is the positive signal, worse the negative,
    // regardless of where the average sits.
    const deltaColor =
        row.delta == null
            ? t.ink.tertiary
            : row.delta >= 0.5
              ? t.signals.positive
              : row.delta <= -0.5
                ? t.signals.negative
                : t.ink.tertiary;
    const deltaText =
        row.delta == null
            ? `${row.scores.length} runs`
            : `${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(1)}`;
    const deltaGlyph =
        row.delta == null ? "" : row.delta >= 0.5 ? "▲" : row.delta <= -0.5 ? "▼" : "▬";

    return (
        <Flex
            align="center"
            gap={3}
            py={2}
            borderLeft="3px solid"
            borderColor={row.color}
            pl={2.5}
            _hover={{ bg: "var(--surface-recessed)" }}
            transition="background 160ms"
        >
            {/* Identity + rank number: the average is the anchor; name sits
                under it because the number is what the ranking is by. */}
            <Flex direction="column" w="86px" flexShrink={0} minW={0}>
                <Text fontSize="16px" fontWeight={600} fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-primary)" lineHeight="1">
                    {row.avg.toFixed(1)}
                </Text>
                <Text fontSize="11px" color="var(--ink-secondary)" truncate title={row.name}>
                    {row.name}
                </Text>
            </Flex>

            {/* Sparkline of raw run scores — each agent's own y-scale, so a
                quiet agent's trend is as legible as a volatile one's. */}
            <Box flex={1} minW={0} h={34}>
                <RunSparkline scores={row.scores} color={row.color} theme={t} colorMode={colorMode} />
            </Box>

            {/* Delta chip — direction of travel, not level. */}
            <Flex direction="column" align="flex-end" flexShrink={0} gap={0.5}>
                <Flex align="center" gap={1}>
                    <Text fontSize="8px" color={deltaColor} lineHeight="1">
                        {deltaGlyph}
                    </Text>
                    <Text fontSize="11.5px" fontWeight={600} fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color={deltaColor} lineHeight="1">
                        {deltaText}
                    </Text>
                </Flex>
                <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" lineHeight="1">
                    {row.delta == null
                        ? "no trend"
                        : `last ${Math.min(DELTA_WINDOW, row.scores.length)}`}
                </Text>
            </Flex>
        </Flex>
    );
}

/** Raw-score sparkline with a faint band to the agent's own mean. */
function RunSparkline({
    scores,
    color,
    theme,
    colorMode,
}: {
    scores: number[];
    color: string;
    theme: ReturnType<typeof resolvedTheme>;
    colorMode: string;
}) {
    const t = theme;
    const n = scores.length;
    const mean = scores.reduce((s, x) => s + x, 0) / n;
    // Personal band: ±(half the agent's own spread, floor 4) around its mean,
    // so every agent's context band is legible at the same visual weight.
    const spread = Math.max(...scores) - Math.min(...scores);
    const half = Math.max(4, spread / 2);
    const lo = Math.max(0, mean - half);
    const hi = Math.min(100, mean + half);

    return (
        <Echart
            height={34}
            aria-label={`${n} run scores, latest ${scores[n - 1].toFixed(0)}, average ${mean.toFixed(1)}`}
            option={{
                animation: false,
                grid: { left: 2, right: 2, top: 3, bottom: 3 },
                xAxis: {
                    type: "category",
                    data: scores.map((_, i) => String(i)),
                    show: false,
                    boundaryGap: false,
                },
                yAxis: {
                    type: "value",
                    min: Math.floor(lo / 5) * 5 - 2,
                    max: Math.ceil(hi / 5) * 5 + 2,
                    show: false,
                },
                tooltip: {
                    ...tooltipStyle(t),
                    trigger: "axis",
                    axisPointer: { type: "line", lineStyle: { color: t.hairline } },
                    confine: true,
                    formatter: (params: any) => {
                        const p = Array.isArray(params) ? params[0] : params;
                        const idx = p.dataIndex;
                        const d = new Date(Date.now() - (n - 1 - idx) * 86400000);
                        return `<b>${scores[idx].toFixed(1)}</b> <span style="color:${t.ink.tertiary}">run ${idx + 1} of ${n}</span>`;
                    },
                },
                series: [
                    // The mean band: quiet context behind the line.
                    {
                        type: "line",
                        data: scores.map(() => mean),
                        showSymbol: false,
                        lineStyle: { width: 0 },
                        areaStyle: { color: color, opacity: colorMode === "dark" ? 0.14 : 0.1 },
                        silent: true,
                        emphasis: { disabled: true },
                        // A flat series renders as a hairline; stack a band on
                        // top of it via the invisible second series below.
                    },
                    {
                        type: "line",
                        data: scores.map(() => mean + half),
                        showSymbol: false,
                        stack: "band",
                        lineStyle: { width: 0 },
                        areaStyle: { color: "transparent" },
                        silent: true,
                        emphasis: { disabled: true },
                    },
                    {
                        type: "line",
                        data: scores.map(() => Math.max(0, mean - half)),
                        showSymbol: false,
                        stack: "band",
                        lineStyle: { width: 0 },
                        areaStyle: { color: color, opacity: colorMode === "dark" ? 0.12 : 0.08 },
                        silent: true,
                        emphasis: { disabled: true },
                    },
                    {
                        type: "line",
                        data: scores,
                        showSymbol: n <= 12,
                        symbolSize: 3,
                        smooth: 0.35,
                        lineStyle: { width: 1.75, color },
                        itemStyle: { color, borderColor: t.surface.panel, borderWidth: 1 },
                        emphasis: { focus: "series" },
                        markLine:
                            n >= 4
                                ? {
                                      silent: true,
                                      symbol: "none",
                                      label: { show: false },
                                      lineStyle: { color: t.ink.tertiary, type: "dashed", opacity: 0.5, width: 1 },
                                      data: [{ yAxis: mean }],
                                  }
                                : undefined,
                    },
                ],
            }}
        />
    );
}
