import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowUpward, MdArrowDownward, MdExpandMore, MdChevronRight } from "react-icons/md";
import { AnalysisService, AgentService, SkillService } from "@/db";
import { agentDisplayName } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import SkillAvatar from "@/components/shared/SkillAvatar";
import Echart from "@/components/shared/Echart";
import { resolveAgent } from "@/lib/agentIdentity";
import { ModelLogo, modelLogoAsset } from "@/lib/modelLogos";
import { TickerLogo } from "@/lib/sourceLogos";
import { mixHex, resolvedTheme, tooltipStyle, type ECOption, type ResolvedTheme } from "@/lib/echarts";
import { useColorMode } from "@/components/ui/color-mode";
import { motion, AnimatePresence } from "motion/react";
import { stagger, staggerItem, dur } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ConfirmDialog from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { verdictForScore } from "@/lib/analysisFormat";
import { CirclePlus, Search } from "lucide-react";

/** Harness quality verdicts (CLI's five-band grade) → the table's signal dot. */
const QUALITY_SIGNAL: Record<string, "positive" | "caution" | "negative"> = {
    "Very Poor": "negative",
    "Poor": "negative",
    "Fair": "caution",
    "Good": "positive",
    "Excellent": "positive",
};

type SortKey = "share" | "created_at" | "score" | "status" | "agent" | "model" | "duration";

interface AnalysisItem {
    analysis_id?: string;
    _id?: string;
    id?: string;
    share_name?: string;
    symbol?: string;
    agent_name?: string;
    agent?: string;
}

function scoreSignal(score: number): "positive" | "caution" | "negative" {
    if (score >= 70) return "positive";
    if (score >= 40) return "caution";
    return "negative";
}

function signalColor(signal: "positive" | "caution" | "negative"): string {
    if (signal === "positive") return "var(--signal-positive)";
    if (signal === "caution") return "var(--signal-caution)";
    return "var(--signal-negative)";
}

function formatDuration(sec: number): string {
    if (sec == null) return "";
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }
    return `${sec.toFixed(1)}s`;
}

function timeAgo(dateStr: string): string {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

/** Insight labels: light Anek Latin, sentence case — no caps, no box. */
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="font-app-body text-[12.5px] leading-none font-light text-[var(--ink-secondary)]">
            {children}
        </div>
    );
}

/** Two loading states use it; not worth a shadcn wrapper. */
function Spinner({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
        />
    );
}

const OTHER_KEY = "__other__";

/** Escape untrusted labels before they go into ECharts tooltip HTML. */
function esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * Monochrome ramp for a donut: every slice is a shade of one anchor color,
 * ordered by rank so magnitude reads without a legend lookup. The mix runs
 * toward ink-primary rather than the surface, so the ramp always moves AWAY
 * from the card background — mixing toward the panel would drop the low ranks
 * into the surface in dark mode.
 */
function shadeRamp(t: ResolvedTheme, anchor: string, i: number, n: number): string {
    const k = n > 1 ? i / (n - 1) : 0;
    return mixHex(anchor, t.ink.primary, 0.18 + 0.56 * k);
}

/**
 * Legends are HTML, not ECharts': a canvas legend eats the strip's width and
 * pushes the plots out of line. Every item is capped so a long name truncates
 * instead of claiming a whole row — the count/tooltip stays the source of
 * truth, the legend just names the slice.
 */
function LogoLegend({ items }: { items: { key: string; label: string; model: string }[] }) {
    return (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
            {items.map((it) => (
                <div key={it.key} className="flex min-w-0 max-w-[112px] items-center gap-1.5">
                    <ModelLogo model={it.model} size={12} />
                    <div
                        title={it.label}
                        className="truncate font-app-body text-[11px] font-light text-[var(--ink-secondary)]"
                    >
                        {it.label}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Same legend treatment as LogoLegend, with a colour dot instead of a logo. */
function DotLegend({ items }: { items: { key: string; label: string; color: string; title?: string }[] }) {
    return (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
            {items.map((it) => (
                <div key={it.key} className="flex min-w-0 max-w-[112px] items-center gap-1.5">
                    <span
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ background: it.color }}
                    />
                    <span
                        title={it.title ?? it.label}
                        className="truncate font-app-body text-[11px] font-light text-[var(--ink-secondary)]"
                    >
                        {it.label}
                    </span>
                </div>
            ))}
        </div>
    );
}

/**
 * Rounded pie/donut shared by the model and stock plots: same slice rounding,
 * no canvas legend (the HTML legend sits under the plot), only the data and
 * tooltip body differ.
 */
function donutOption(
    t: ResolvedTheme,
    anim: ECOption["animation"],
    slices: { name: string; value: number; itemStyle: { color: string } }[],
    tooltipBody: (index: number, percent: number) => string,
    radius: [string, string] = ["48%", "72%"]
): ECOption {
    return {
        animation: anim,
        legend: { show: false },
        tooltip: {
            ...tooltipStyle(t),
            trigger: "item",
            confine: true,
            formatter: (params: any) => {
                const p = Array.isArray(params) ? params[0] : params;
                return tooltipBody(p.dataIndex, p.percent);
            },
        },
        series: [
            {
                type: "pie",
                radius,
                center: ["50%", "50%"],
                label: { show: false },
                labelLine: { show: false },
                // No slice borders — the plots sit flush on the canvas like
                // everything else on the page.
                data: slices,
            },
        ],
    };
}

type GroupMode = "individual" | "date" | "agent" | "stock" | "model";

const GROUP_VIEWS: { key: GroupMode; label: string }[] = [
    { key: "individual", label: "All runs" },
    { key: "date", label: "By date" },
    { key: "agent", label: "By agent" },
    { key: "stock", label: "By stock" },
    { key: "model", label: "By model" },
];

function groupAverage(items: any[]): number | null {
    const v = items.map((i) => i.total_score).filter((x: any) => typeof x === "number");
    return v.length ? v.reduce((s: number, x: number) => s + x, 0) / v.length : null;
}

function formatGroupDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(+d)) return iso === "undated" ? "Undated" : iso;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((+d - +today) / 86400000);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
    const base = d.toLocaleDateString(undefined, opts);
    if (diff === 0) return `Today, ${base}`;
    if (diff === -1) return `Yesterday, ${base}`;
    return d.toLocaleDateString(undefined, { ...opts, weekday: "short" });
}

function GroupHeaderRow({
    avatar,
    label,
    count,
    avg,
    expanded,
    onToggle,
}: {
    avatar?: React.ReactNode;
    label: string;
    count: number;
    avg: number | null;
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <tr
            className="cursor-pointer bg-[var(--surface-recessed)]"
            onClick={onToggle}
            aria-expanded={expanded}
        >
            <td colSpan={8} className="px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0">
                        {expanded ? (
                            <MdExpandMore size={15} color="var(--ink-tertiary)" />
                        ) : (
                            <MdChevronRight size={15} color="var(--ink-tertiary)" />
                        )}
                    </span>
                    {avatar}
                    <span className="truncate text-[12.5px] font-semibold text-[var(--ink-primary)]">{label}</span>
                    <span className="shrink-0 font-app-tabular text-[11px] text-[var(--ink-tertiary)]">
                        {count} {count === 1 ? "run" : "runs"}
                    </span>
                    {avg != null && (
                        <span className="ml-auto shrink-0 font-app-tabular text-[11.5px] tabular-nums text-[var(--ink-secondary)]">
                            avg score {avg.toFixed(0)}%
                        </span>
                    )}
                </div>
            </td>
        </tr>
    );
}

export default function AnalysisList() {
    const navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey | null>("created_at");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [deleteTarget, setDeleteTarget] = useState<AnalysisItem | null>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [viewMode, setViewMode] = useState<GroupMode>("individual");
    const [query, setQuery] = useState("");
    // Groups start collapsed — the headers themselves are the summary.
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const toggleGroup = (key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => {
                if (Array.isArray(data)) setAgents(data);
            })
            .catch(() => {});
    }, []);

    // Skill runs badge with the skill's name; built from the skill library.
    const [skills, setSkills] = useState<any[]>([]);
    useEffect(() => {
        SkillService.listSkills()
            .then((data) => {
                if (Array.isArray(data)) setSkills(data);
            })
            .catch(() => {});
    }, []);
    const skillName = (id: string | undefined) => skills.find((s) => s.id === id)?.name || id || "—";

    const agentName = (raw: string | undefined) => agentDisplayName(raw, agents) || "—";

    const fetchUniqueAnalysis = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await AnalysisService.listAnalyses();
            if (Array.isArray(data)) {
                setUniqueAnalysis(data);
                setFetchError(false);
            } else {
                setUniqueAnalysis([]);
                setFetchError(true);
            }
        } catch (error) {
            console.log("Analysis fetch error:", error);
            setUniqueAnalysis([]);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUniqueAnalysis();
    }, []);

    const handleDelete = async (id: string | undefined) => {
        if (!id) return;
        try {
            await AnalysisService.deleteAnalysis(id);
            setDeleteTarget(null);
            setUniqueAnalysis((prev) => prev.filter((a) => (a.analysis_id || a._id || a.id) !== id));
            fetchUniqueAnalysis(true);
        } catch (error) {
            console.error("Delete analysis error:", error);
        }
    };

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "created_at" ? "desc" : "asc");
        }
    };

    const sorted = useMemo(() => {
        // Free-text search across share, agent, skill and model.
        const q = query.trim().toLowerCase();
        const base = q
            ? uniqueAnalysis.filter((a) =>
                  [
                      a.symbol,
                      a.share_name,
                      a.model,
                      agentName(a.agent_name || a.agent),
                      skillName(a.skill_id),
                  ].some((v) => String(v ?? "").toLowerCase().includes(q))
              )
            : uniqueAnalysis;
        if (!sortKey) return [...base];
        return [...base].sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortKey) {
                case "share":
                    aVal = (a.symbol || a.share_name || "").toLowerCase();
                    bVal = (b.symbol || b.share_name || "").toLowerCase();
                    break;
                case "created_at":
                    aVal = new Date(a.created_at || 0).getTime();
                    bVal = new Date(b.created_at || 0).getTime();
                    break;
                case "score":
                    aVal = a.total_score ?? -1;
                    bVal = b.total_score ?? -1;
                    break;
                case "agent":
                    aVal = agentName(a.agent_name || a.agent).toLowerCase();
                    bVal = agentName(b.agent_name || b.agent).toLowerCase();
                    break;
                case "model":
                    aVal = (a.model || "").toLowerCase();
                    bVal = (b.model || "").toLowerCase();
                    break;
                case "duration":
                    aVal = a.duration ?? -1;
                    bVal = b.duration ?? -1;
                    break;
                case "status":
                    aVal = (a.status || "").toLowerCase();
                    bVal = (b.status || "").toLowerCase();
                    break;
                default:
                    return 0;
            }
            if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
            if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
            return 0;
        });
    }, [uniqueAnalysis, sortKey, sortDir, query, agents, skills]);

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return null;
        return sortDir === "asc" ? (
            <MdArrowUpward size={11} color="var(--ink-tertiary)" />
        ) : (
            <MdArrowDownward size={11} color="var(--ink-tertiary)" />
        );
    };

    // Grouped sections for the non-individual views. Within each group the
    // current sort order is preserved; groups themselves sort by name (or
    // newest-first for dates).
    const sections = useMemo(() => {
        if (viewMode === "individual") return [{ key: "all", items: sorted }];
        const keyOf = (a: any): string => {
            switch (viewMode) {
                case "date":
                    return a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : "undated";
                case "agent":
                    return agentName(a.agent_name || a.agent);
                case "stock":
                    return String(a.share_name || a.symbol || "Unknown stock");
                case "model":
                    return a.model || "unknown";
                default:
                    return "";
            }
        };
        const map = new Map<string, any[]>();
        for (const a of sorted) {
            const k = keyOf(a);
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(a);
        }
        const keys = Array.from(map.keys()).sort((x, y) =>
            viewMode === "date" ? y.localeCompare(x) : x.localeCompare(y)
        );
        return keys.map((k) => ({ key: k, items: map.get(k)! }));
    }, [viewMode, sorted]);

    // Collapsed groups render only their header row.
    const visibleSections = useMemo(
        () =>
            viewMode === "individual"
                ? sections
                : sections.map((s) => (expanded.has(s.key) ? s : { ...s, items: [] })),
        [viewMode, sections, expanded]
    );

    const completed = useMemo(() => {
        return uniqueAnalysis.filter(
            (a) =>
                a.total_score != null &&
                (a.status || "").toLowerCase() !== "failed" &&
                (a.status || "").toLowerCase() !== "error"
        );
    }, [uniqueAnalysis]);

    const failed = useMemo(() => {
        const f = (a: any) => (a.status || "").toLowerCase();
        return uniqueAnalysis.filter((a) => f(a) === "failed" || f(a) === "error");
    }, [uniqueAnalysis]);

    // Top 5 models by run count; everything past the top 5 is one "Other"
    // slice so the pie never silently drops runs.
    const modelUsage = useMemo(() => {
        const map = new Map<string, number>();
        uniqueAnalysis.forEach((a) => {
            const m = a.model || "unknown";
            map.set(m, (map.get(m) || 0) + 1);
        });
        const all = Array.from(map.entries())
            .map(([model, count]) => ({ model, count }))
            .sort((a, b) => b.count - a.count);
        const top = all.slice(0, 5);
        const rest = all.slice(5).reduce((s, m) => s + m.count, 0);
        return rest > 0 ? [...top, { model: OTHER_KEY, count: rest }] : top;
    }, [uniqueAnalysis]);

    // Top 5 stocks by run count — the pie ranks how often each name is run.
    // The symbol rides along so the legend can show the ticker under the plot.
    const topStocks = useMemo(() => {
        const map = new Map<string, { label: string; symbol: string; count: number }>();
        uniqueAnalysis.forEach((a) => {
            const label = String(a.share_name || a.symbol || "").trim();
            if (!label) return;
            const entry = map.get(label) ?? { label, symbol: "", count: 0 };
            entry.count += 1;
            if (!entry.symbol) {
                const sym = String(a.symbol || "").trim();
                if (sym) entry.symbol = sym;
            }
            map.set(label, entry);
        });
        return Array.from(map.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [uniqueAnalysis]);

    const modelRuns = useMemo(() => modelUsage.reduce((s, m) => s + m.count, 0), [modelUsage]);

    // Completed vs failed share of all runs; counts live in the tooltip only.
    const healthTotal = completed.length + failed.length;

    const colSpan = 8;

    const { colorMode } = useColorMode();
    const chartTheme = useMemo(() => resolvedTheme(colorMode === "dark"), [colorMode]);
    const chartAnim = useMemo(
        () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? false : { duration: dur.base, easing: "cubicOut" }),
        []
    );

    const modelPie = useMemo(() => {
        const t = chartTheme;
        const n = modelUsage.length;
        return donutOption(
            t,
            chartAnim,
            modelUsage.map((m, i) => ({
                name: m.model === OTHER_KEY ? "Other models" : m.model,
                value: m.count,
                itemStyle: { color: shadeRamp(t, t.accent, i, n) },
            })),
            (i, percent) => {
                const m = modelUsage[i];
                if (!m) return "";
                const other = m.model === OTHER_KEY;
                const asset = other ? null : modelLogoAsset(m.model);
                const mark = asset
                    ? `<img src="${asset.src}"${asset.invert ? ' class="llm-mark"' : ""} style="width:14px;height:14px;object-fit:contain;vertical-align:-3px;margin-right:6px;" alt="" />`
                    : "";
                return `${mark}<b>${other ? "Other models" : esc(m.model)}</b><br/><span style="color:${t.ink.tertiary}">${percent}% · ${m.count}${other ? "" : " runs"}</span>`;
            }
        );
    }, [modelUsage, chartTheme, chartAnim]);

    /**
     * Completed vs failed as one stacked horizontal bar. No segment labels —
     * the counts only surface in the tooltip, so the strip stays a shape.
     * The colours are deliberately punchier than the muted signal tokens:
     * the band has to read as red and green at a glance.
     */
    const healthSegments = useMemo(
        () => [
            { name: "Completed", value: completed.length, color: "#16A34A" },
            { name: "Failed", value: failed.length, color: "#DC2626" },
        ],
        [completed, failed]
    );

    const runHealthBar = useMemo(() => {
        const t = chartTheme;
        const segments = healthSegments;
        return {
            animation: chartAnim,
            grid: { left: 0, right: 0, top: 8, bottom: 8 },
            tooltip: {
                ...tooltipStyle(t),
                trigger: "item",
                confine: true,
                formatter: (params: any) => {
                    const p = Array.isArray(params) ? params[0] : params;
                    const s = segments[p.seriesIndex ?? p.dataIndex];
                    if (!s) return "";
                    return `<b>${s.name}</b><br/><span style="color:${t.ink.tertiary}">${s.value} run${s.value === 1 ? "" : "s"}</span>`;
                },
            },
            xAxis: { type: "value", max: healthTotal, show: false, splitLine: { show: false } },
            yAxis: { type: "category", data: [""], show: false },
            series: segments.map((s) => ({
                name: s.name,
                type: "bar",
                stack: "health",
                barWidth: 48,
                itemStyle: { color: s.color },
                label: { show: false },
                data: [s.value],
            })),
        };
    }, [healthSegments, healthTotal, chartTheme, chartAnim]);

    /**
     * Most run stocks — a pie of run counts for the top 5 names. Slice shades
     * ramp by rank so magnitude still reads without looking up the legend.
     */
    /**
     * Slice colours for the stock pie, computed once so the HTML legend and
     * the chart can never drift apart. Shades ramp by rank so magnitude still
     * reads without looking up the legend.
     */
    const stockSlices = useMemo(
        () =>
            topStocks.map((s, i) => ({
                ...s,
                color: shadeRamp(chartTheme, chartTheme.accent, i, topStocks.length),
            })),
        [topStocks, chartTheme]
    );

    const stockPie = useMemo(() => {
        const t = chartTheme;
        return donutOption(
            t,
            chartAnim,
            stockSlices.map((s) => ({
                name: s.label,
                value: s.count,
                itemStyle: { color: s.color },
            })),
            (i, percent) => {
                const s = stockSlices[i];
                if (!s) return "";
                const head =
                    s.symbol && s.symbol !== s.label
                        ? `${esc(s.symbol)} <span style="color:${t.ink.tertiary}">· ${esc(s.label)}</span>`
                        : esc(s.label);
                return `<b>${head}</b><br/><span style="color:${t.ink.tertiary}">${percent}% · ${s.count} run${s.count === 1 ? "" : "s"}</span>`;
            },
            ["0%", "70%"]
        );
    }, [stockSlices, chartTheme, chartAnim]);

    const onRowClick = (id: string) => {
        navigate("/analysis-result/" + id);
    };

    return (
        <div className="min-h-full bg-[var(--surface-canvas)]">
            {/*
             * Masthead. The App wrapper already carries the navbar's 1.5rem
             * gutter, so this page adds no horizontal padding of its own —
             * the title lines up with the nav above it.
             */}
            <div className="flex w-full flex-col gap-6 py-6">
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <h1 className="font-app-display text-[26px] leading-[1.1] font-normal tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        Past Runs
                    </h1>
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} className="shrink-0">
                        <Button
                            variant="ghost"
                            onClick={() => navigate("/new-analysis")}
                            className="h-12 gap-2.5 rounded-[3px] bg-transparent px-6 font-normal text-[15.5px] text-[var(--ink-primary)] hover:bg-transparent"
                        >
                            <CirclePlus className="size-6" strokeWidth={1.5} />
                            New Run
                        </Button>
                    </motion.div>
                </header>

                {/*
                 * Insights — a flat horizontal strip above the table. No card,
                 * no borders, no dividers between the plots: a responsive grid
                 * and whitespace do the separating.
                 */}
                <motion.section
                    variants={stagger}
                    initial="initial"
                    animate="animate"
                    className="flex flex-col gap-3"
                >
                    <SectionLabel>Insights</SectionLabel>
                    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
                        {/* Most run stocks — headline insight */}
                        <motion.div variants={staggerItem} className="flex min-w-0 flex-col gap-3">
                            <SectionLabel>Most run stocks</SectionLabel>
                            {topStocks.length === 0 ? (
                                <p className="font-app-body text-[12px] font-light text-[var(--ink-tertiary)]">
                                    No runs yet
                                </p>
                            ) : (
                                <div>
                                    <Echart
                                        height={160}
                                        aria-label={`Top ${topStocks.length} most run stocks. ${topStocks
                                            .map((s) => `${s.symbol || s.label} ${s.count} runs`)
                                            .join(", ")}`}
                                        option={stockPie}
                                    />
                                    <DotLegend
                                        items={stockSlices.map((s) => ({
                                            key: s.label,
                                            label: s.symbol || s.label,
                                            title: s.label,
                                            color: s.color,
                                        }))}
                                    />
                                </div>
                            )}
                        </motion.div>

                        {/* Run health — one stacked strip, counts on hover only */}
                        <motion.div variants={staggerItem} className="flex min-w-0 flex-col gap-3">
                            <SectionLabel>Run health</SectionLabel>
                            {healthTotal === 0 ? (
                                <p className="font-app-body text-[12px] font-light text-[var(--ink-tertiary)]">
                                    No runs yet
                                </p>
                            ) : (
                                <div>
                                    <Echart
                                        height={160}
                                        aria-label={`Run outcomes: ${completed.length} completed, ${failed.length} failed.`}
                                        option={runHealthBar}
                                    />
                                    <DotLegend
                                        items={healthSegments.map((s) => ({
                                            key: s.name,
                                            label: s.name,
                                            color: s.color,
                                        }))}
                                    />
                                </div>
                            )}
                        </motion.div>

                        {/* Most used models */}
                        <motion.div variants={staggerItem} className="flex min-w-0 flex-col gap-3">
                            <SectionLabel>Most used models</SectionLabel>
                            {modelUsage.length === 0 ? (
                                <p className="font-app-body text-[12px] font-light text-[var(--ink-tertiary)]">
                                    No runs yet
                                </p>
                            ) : (
                                <div>
                                    <Echart
                                        height={160}
                                        aria-label={`Runs by model across ${modelRuns} runs. ${modelUsage
                                            .map((m) => `${m.model} ${m.count}`)
                                            .join(", ")}`}
                                        option={modelPie}
                                    />
                                    <LogoLegend
                                        items={modelUsage.map((m) => ({
                                            key: m.model,
                                            label: m.model === OTHER_KEY ? "Other models" : m.model,
                                            model: m.model,
                                        }))}
                                    />
                                </div>
                            )}
                        </motion.div>
                    </div>
                </motion.section>

                {/* Main table */}
                <div className="min-w-0 flex-1">
                    {/* Filters + search — one line above the table */}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <ToggleGroup
                            type="single"
                            value={viewMode}
                            onValueChange={(v) => v && setViewMode(v as GroupMode)}
                            className="h-auto flex-wrap gap-1 rounded-[3px] border-0 bg-transparent p-0"
                        >
                            {GROUP_VIEWS.map((v) => (
                                <ToggleGroupItem
                                    key={v.key}
                                    value={v.key}
                                    className="h-auto flex-none rounded-[2px] border px-2.5 py-1 text-[11.5px] font-normal whitespace-nowrap hover:bg-transparent hover:text-[var(--ink-primary)] data-[state=on]:border-[var(--hairline)] data-[state=on]:bg-[var(--surface-recessed)] data-[state=on]:font-semibold data-[state=on]:text-[var(--ink-primary)] data-[state=on]:shadow-none"
                                >
                                    {v.label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                        <div className="relative ml-auto w-full sm:w-[240px]">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--ink-tertiary)]" />
                            {/*
                             * Same chrome as the new-analysis inputs: hairline
                             * border, subtle fill, square corners, 36px tall,
                             * 14px Anek Latin at 400.
                             */}
                            <input
                                type="text"
                                placeholder="Search share, agent, model…"
                                aria-label="Search runs"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="h-9 w-full min-w-0 rounded-none border border-[var(--hairline)] bg-[var(--surface-recessed)] py-1 pr-2 pl-8 font-app-body text-[14px] font-normal text-[var(--ink-primary)] transition-colors outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--ink-secondary)]"
                            />
                        </div>
                    </div>
                    {loading && uniqueAnalysis.length === 0 ? (
                        <div className="flex justify-center gap-3 py-16 text-[var(--ink-secondary)]">
                            <Spinner />
                            <span className="text-[13px]">Loading runs…</span>
                        </div>
                    ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[1000px] border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-[var(--surface-recessed)]">
                                            {(
                                                [
                                                    ["share", "Share"],
                                                    ["agent", "Agent"],
                                                    ["model", "Model"],
                                                    ["score", "Verdict"],
                                                    ["duration", "Duration"],
                                                    ["created_at", "Created"],
                                                    ["status", "Status"],
                                                ] as const
                                            ).map(([key, label]) => (
                                                <th
                                                    key={key}
                                                    onClick={() => toggleSort(key)}
                                                    className="cursor-pointer px-4 py-3 text-left text-[10.5px] font-medium tracking-[0.06em] text-[var(--ink-tertiary)] uppercase select-none"
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        {label}
                                                        <SortIcon column={key} />
                                                    </span>
                                                </th>
                                            ))}
                                            <th className="w-[48px] px-4 py-3" />
                                        </tr>
                                    </thead>
                                    <motion.tbody variants={stagger} initial="initial" animate="animate">
                                        <AnimatePresence initial={false}>
                                        {loading ? (
                                            <motion.tr key="loading" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td colSpan={colSpan} className="py-12">
                                                    <div className="flex justify-center gap-3 text-[var(--ink-secondary)]">
                                                        <Spinner />
                                                        <span className="text-[13px]">Loading runs…</span>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ) : fetchError ? (
                                            <motion.tr key="error" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td colSpan={colSpan} className="px-4 py-8">
                                                    <div className="border-l-[3px] border-[var(--signal-negative)] pl-3">
                                                        <p className="text-[13px] text-[var(--ink-primary)]">
                                                            Failed to fetch runs.
                                                        </p>
                                                        <p className="mt-1 text-[12px] text-[var(--ink-secondary)]">
                                                            Check if the backend service is running.
                                                        </p>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ) : sorted.length === 0 && !loading ? (
                                            <motion.tr key="empty" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td
                                                    colSpan={colSpan}
                                                    className="py-12 text-center text-[13px] text-[var(--ink-tertiary)]"
                                                >
                                                    No runs found.
                                                </td>
                                            </motion.tr>
                                        ) : (
                                            visibleSections.flatMap((sec) => [
                                                ...(viewMode === "individual"
                                                    ? []
                                                    : [
                                                        <GroupHeaderRow
                                                            key={`h-${sec.key}`}
                                                            avatar={
                                                                viewMode === "agent" ? (
                                                                    <AgentAvatar agent={resolveAgent(sec.key, agents)} size={18} />
                                                                ) : viewMode === "model" ? (
                                                                    <ModelLogo model={sec.key} size={14} />
) : viewMode === "stock" ? (
                                                                <TickerLogo
                                                                    symbol={sections.find((s) => s.key === sec.key)?.items[0]?.symbol}
                                                                    size={18}
                                                                />
                                                            ) : null
                                                            }
                                                            label={viewMode === "date" ? formatGroupDate(sec.key) : sec.key}
                                                            count={sections.find((s) => s.key === sec.key)?.items.length ?? sec.items.length}
                                                            avg={groupAverage(sections.find((s) => s.key === sec.key)?.items || sec.items)}
                                                            expanded={expanded.has(sec.key)}
                                                            onToggle={() => toggleGroup(sec.key)}
                                                        />,
                                                    ]),
                                                ...sec.items.map((item) => {
                                                const id =
                                                    item.analysis_id || item._id || item.id;
                                                const itemScore: number | null =
                                                    item.total_score;
                                                const sig =
                                                    itemScore != null
                                                        ? scoreSignal(itemScore)
                                                        : null;
                                                const itemStatus = (
                                                    item.status || ""
                                                ).toLowerCase();
                                                const isItemError =
                                                    itemStatus === "error" ||
                                                    itemStatus === "failed";
                                                const isItemComplete =
                                                    itemStatus === "complete" ||
                                                    itemStatus === "completed" ||
                                                    itemStatus === "success";
                                                // Verdict: harness runs carry the CLI's quality
                                                // grade inside report.verdict (list selects it as
                                                // the flat `verdict` key via report->verdict);
                                                // skill-era rows fall back to the score-band label.
                                                const harnessVerdict: string | undefined =
                                                    item.verdict;
                                                const verdictLabel =
                                                    harnessVerdict ??
                                                    (itemScore != null
                                                        ? verdictForScore(itemScore).label
                                                        : null);
                                                const verdictSig = harnessVerdict
                                                    ? QUALITY_SIGNAL[harnessVerdict] ?? null
                                                    : sig;
                                                // duration is written by harness runs; older rows
                                                // fall back to created→updated wall time.
                                                const durSec =
                                                    item.duration != null
                                                        ? item.duration
                                                        : isItemComplete &&
                                                            item.created_at &&
                                                            item.updated_at
                                                          ? (+new Date(item.updated_at) -
                                                                +new Date(item.created_at)) /
                                                            1000
                                                          : null;

                                                return (
                                                    <motion.tr
                                                        variants={staggerItem}
                                                        exit={{ opacity: 0 }}
                                                        layout={false}
                                                        key={id}
                                                        onClick={(e) => {
                                                            // Modified click = open in a new tab
                                                            // (browser-style); plain click navigates.
                                                            if (
                                                                e.ctrlKey ||
                                                                e.metaKey ||
                                                                e.shiftKey ||
                                                                e.altKey
                                                            ) {
                                                                window.open(
                                                                    "/analysis-result/" + id,
                                                                    "_blank"
                                                                );
                                                                return;
                                                            }
                                                            onRowClick(id);
                                                        }}
                                                        className="cursor-pointer transition-colors duration-[160ms] hover:bg-[var(--surface-recessed)]"
                                                    >
                                                        {/* Share — plain text, not badge */}
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2.5">
                                                                <TickerLogo symbol={item.symbol} size={22} />
                                                                <div className="flex flex-col">
                                                                    <span className="text-[13.5px] leading-snug font-medium text-[var(--ink-primary)]">
                                                                        {item.share_name ||
                                                                            item.symbol ||
                                                                            "—"}
                                                                    </span>
                                                                    {item.share_name &&
                                                                        item.symbol && (
                                                                            <span className="font-app-mono text-[11px] text-[var(--ink-tertiary)]">
                                                                                {item.symbol}
                                                                            </span>
                                                                        )}
                                                                </div>
                                                            </div>
                                                        </td>

                                                        {/* Agent / Skill */}
                                                        <td className="max-w-[140px] overflow-hidden px-4 py-3">
                                                            {item.run_mode === "agent" ? (
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <AgentAvatar agent={resolveAgent(item.agent_name || item.agent, agents)} size={24} />
                                                                    <span className="truncate text-[13px] text-[var(--ink-secondary)]">
                                                                        {agentName(item.agent_name || item.agent)}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <SkillAvatar skill={{ id: item.skill_id, name: skillName(item.skill_id) }} size={24} />
                                                                    <span className="min-w-0">
                                                                        <span className="block truncate text-[13px] text-[var(--ink-secondary)]">
                                                                            {skillName(item.skill_id)}
                                                                        </span>
                                                                        <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--accent-primary)]">
                                                                            Skill run
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Model */}
                                                        <td
                                                            className="max-w-[200px] overflow-hidden px-4 py-3"
                                                            title={item.model || undefined}
                                                        >
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <ModelLogo model={item.model} size={13} />
                                                                <span className="truncate font-app-mono text-[13px] text-[var(--ink-secondary)]">
                                                                    {item.model || "—"}
                                                                </span>
                                                            </div>
                                                        </td>

                                                        {/* Verdict — word + signal dot */}
                                                        <td className="px-4 py-3">
                                                            {verdictLabel != null ? (
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    {verdictSig && (
                                                                        <span
                                                                            className="h-[5px] w-[5px] shrink-0 rounded-full"
                                                                            style={{ background: signalColor(verdictSig) }}
                                                                        />
                                                                    )}
                                                                    <span className="text-[13.5px] font-medium text-[var(--ink-primary)]">
                                                                        {verdictLabel}
                                                                    </span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-[13px] text-[var(--ink-tertiary)]">—</span>
                                                            )}
                                                        </td>

                                                        {/* Duration — tabular */}
                                                        <td className="px-4 py-3 font-app-tabular text-[13px] tabular-nums text-[var(--ink-secondary)]">
                                                            {durSec != null && durSec >= 0
                                                                ? formatDuration(durSec)
                                                                : "—"}
                                                        </td>

                                                        {/* Created — relative time */}
                                                        <td
                                                            className="px-4 py-3 text-[13px] text-[var(--ink-secondary)]"
                                                            title={
                                                                item.created_at
                                                                    ? new Date(
                                                                          item.created_at
                                                                      ).toLocaleString()
                                                                    : undefined
                                                            }
                                                        >
                                                            {item.created_at
                                                                ? timeAgo(item.created_at)
                                                                : "—"}
                                                        </td>

                                                        {/* Status — dot + label */}
                                                        <td className="px-4 py-3">
                                                            <span className="inline-flex items-center gap-1.5">
                                                                <span
                                                                    className="h-[5px] w-[5px] shrink-0 rounded-full"
                                                                    style={{
                                                                        background: isItemError
                                                                            ? "var(--signal-negative)"
                                                                            : isItemComplete
                                                                            ? "var(--signal-positive)"
                                                                            : "var(--signal-caution)",
                                                                    }}
                                                                />
                                                                <span className="text-[12px] text-[var(--ink-secondary)]">
                                                                    {isItemError
                                                                        ? "Failed"
                                                                        : isItemComplete
                                                                        ? "Complete"
                                                                        : "Running"}
                                                                </span>
                                                            </span>
                                                        </td>

                                                        {/* Delete — hover-revealed */}
                                                        <td className="px-2 py-3">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDeleteTarget(item);
                                                                }}
                                                                aria-label="Delete run"
                                                                className="flex h-11 w-11 items-center justify-center text-[var(--ink-tertiary)] opacity-100 transition-[color,opacity] hover:text-[var(--signal-negative)] focus-visible:ring-[1px] focus-visible:ring-ring focus-visible:outline-none md:h-auto md:w-auto md:opacity-40 md:[tr:hover_&]:opacity-100"
                                                            >
                                                                <svg
                                                                    width="14"
                                                                    height="14"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="1.5"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                >
                                                                    <path d="M3 6h18" />
                                                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                                                </svg>
                                                            </button>
                                                        </td>
                                                    </motion.tr>
                                                );
                                            }),
                                        ])
                                        )}
</AnimatePresence>
                                    </motion.tbody>
                                </table>
                            </div>
                    )}
                </div>
            </div>

            {/* Delete confirmation */}
            <ConfirmDialog
                open={deleteTarget !== null}
                title="Delete run?"
                message={
                    deleteTarget
                        ? `"${deleteTarget.share_name || deleteTarget.symbol || "this run"}"${
deleteTarget.agent_name || deleteTarget.agent
                              ? ` by ${agentName(deleteTarget.agent_name || deleteTarget.agent)}`
                              : ""
                          } will be permanently removed and cannot be undone.`
                        : ""
                }
                onCancel={() => setDeleteTarget(null)}
                onConfirm={() =>
                    handleDelete(deleteTarget?.analysis_id || deleteTarget?._id || deleteTarget?.id)
                }
            />
        </div>
    );
}
