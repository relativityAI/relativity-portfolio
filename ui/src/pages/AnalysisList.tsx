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
import { mixHex, resolvedTheme, tooltipStyle, type ECOption, type ResolvedTheme } from "@/lib/echarts";
import { useColorMode } from "@/components/ui/color-mode";
import { motion, AnimatePresence } from "motion/react";
import { ease, stagger, staggerItem, CountUp, dur } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ConfirmDialog from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10.5px] font-medium tracking-[0.06em] text-[var(--ink-tertiary)] uppercase">
            {children}
        </div>
    );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (
        <div className="h-6px min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[var(--surface-recessed)]">
            <motion.div
                className="h-full"
                style={{ background: color }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease }}
            />
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
 * An ECharts legend can't render images (legend text is rich-text, not HTML),
 * so the model plot carries its own logo legend instead. Names only — the
 * counts stay in the tooltip.
 */
function LogoLegend({ items }: { items: { key: string; label: string; model: string }[] }) {
    return (
        <div className="mt-2 flex flex-col gap-1.5">
            {items.map((it) => (
                <div key={it.key} className="flex min-w-0 items-center gap-1.5">
                    <ModelLogo model={it.model} size={12} />
                    <div
                        title={it.label}
                        className="truncate font-app-mono text-[10.5px] text-[var(--ink-secondary)]"
                    >
                        {it.label}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Rounded donut shared by the score-band and model plots: same slice rounding,
 * same legend treatment, only the data and tooltip body differ.
 */
function donutOption(
    t: ResolvedTheme,
    anim: ECOption["animation"],
    slices: { name: string; value: number; itemStyle: { color: string } }[],
    tooltipBody: (index: number, percent: number) => string,
    showLegend = true
): ECOption {
    return {
        animation: anim,
        legend: showLegend
            ? {
                  // Legend carries the labels; the counts live in the tooltip so
                  // the card isn't a table with a chart stuck to it.
                  type: "scroll",
                  bottom: 0,
                  left: "center",
                  itemWidth: 8,
                  itemHeight: 8,
                  itemGap: 10,
                  icon: "circle",
                  textStyle: { color: t.ink.secondary, fontSize: 10, fontFamily: t.fonts.mono },
                  formatter: (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name),
              }
            : { show: false },
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
                radius: ["48%", "72%"],
                // Sit higher when the legend owns the bottom strip.
                center: showLegend ? ["50%", "43%"] : ["50%", "50%"],
                label: { show: false },
                labelLine: { show: false },
                itemStyle: { borderColor: t.surface.panel, borderWidth: 2, borderRadius: 4 },
                data: slices,
            },
        ],
    };
}

function Sparkline({ data, agents, height = 40 }: { data: any[]; agents: any[]; height?: number }) {
    const [tip, setTip] = useState<number | null>(null);
    if (data.length < 2) {
        return (
            <div className="text-[11px] text-[var(--ink-tertiary)]">Not enough completed runs yet</div>
        );
    }
    const W = 100;
    const pts = data.map((item, i) => {
        const v = item.total_score;
        const x = (i / (data.length - 1)) * W;
        const y = height - ((Math.max(0, Math.min(100, v)) / 100) * height);
        return { x, y, item } as const;
    });
    const line = pts.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `0,${height} ${line} ${W},${height}`;
    return (
        <div className="relative w-full">
            <svg
                width="100%"
                height={height}
                viewBox={`0 0 ${W} ${height}`}
                preserveAspectRatio="none"
                style={{ display: "block" }}
            >
                <motion.polyline
                    points={line}
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease }}
                />
                <motion.polygon points={area} fill="var(--accent-primary)" initial={{ opacity: 0 }} animate={{ opacity: 0.08 }} transition={{ duration: 0.6, delay: 0.5 }} />
            </svg>
            {pts.map(({ x, y, item }, i) => {
                const symbol = item.share_name || item.symbol || "—";
                const date = item.created_at
                    ? new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    : "—";
                const agent = agentDisplayName(item.agent_name || item.agent, agents) || "—";
                const score = typeof item.total_score === "number" ? item.total_score.toFixed(0) : "—";
                return (
                    <div
                        key={i}
                        className="absolute h-[18px] w-[18px] cursor-default"
                        style={{ left: `${x}%`, top: `${y}px`, transform: "translate(-50%, -50%)" }}
                        onMouseEnter={() => setTip(i)}
                        onMouseLeave={() => setTip(null)}
                    >
                        <div
                            className="absolute h-[6px] w-[6px] rounded-full border-[1.5px] border-[var(--accent-primary)] bg-[var(--surface-panel)]"
                            style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
                        />
                        {tip === i && (
                            <div
                                className="pointer-events-none absolute z-20 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)] px-2.5 py-1.5 whitespace-nowrap shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
                                style={{
                                    bottom: "10px",
                                    left: i === 0 ? "0%" : i === pts.length - 1 ? "100%" : "50%",
                                    transform:
                                        i === 0 ? "none" : i === pts.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
                                }}
                            >
                                <div className="text-[11px] font-semibold text-[var(--ink-primary)]">{symbol}</div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--ink-tertiary)]">
                                    <span>{date}</span>
                                    <span>·</span>
                                    <AgentAvatar agent={resolveAgent(item.agent_name || item.agent, agents)} size={12} />
                                    <span>{agent}</span>
                                </div>
                                <div className="text-[11px] font-semibold text-[var(--signal-positive)]">
                                    Fit {score}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

type GroupMode = "individual" | "date" | "agent" | "stock" | "model";

/**
 * Masthead stat: a light, small-caps label under a tabular figure. The two
 * weights and two ink shades do the work a divider or a box would otherwise.
 */
function Stat({ value, label }: { value: string; label: string }) {
    return (
        <span className="inline-flex items-baseline gap-1.5">
            <span className="font-app-tabular text-[13px] leading-none font-medium tabular-nums text-[var(--ink-secondary)]">
                {value}
            </span>
            <span className="text-[10.5px] leading-none font-medium tracking-[0.08em] text-[var(--ink-tertiary)] uppercase">
                {label}
            </span>
        </span>
    );
}

function Sep() {
    return <span className="text-[var(--grid-line)]">/</span>;
}

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
                            avg match {avg.toFixed(0)}%
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

    const total = uniqueAnalysis.length;
    const successRate = total > 0 ? completed.length / total : 0;

    const avgScore = useMemo(() => {
        const vals = completed.map((a) => a.total_score).filter((v) => typeof v === "number");
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }, [completed]);

    const scoreBands = useMemo(() => {
        const bands = [
            { key: "low", label: "0–39", color: "var(--signal-negative)", count: 0 },
            { key: "mid", label: "40–69", color: "var(--signal-caution)", count: 0 },
            { key: "high", label: "70–100", color: "var(--signal-positive)", count: 0 },
        ];
        completed.forEach((a) => {
            const s = a.total_score;
            if (s < 40) bands[0].count++;
            else if (s < 70) bands[1].count++;
            else bands[2].count++;
        });
        return bands;
    }, [completed]);

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

    // Best score per stock over a rolling 30-day window.
    const topStocks = useMemo(() => {
        const cutoff = Date.now() - 30 * 86400000;
        const best = new Map<string, number>();
        completed.forEach((a) => {
            const label = String(a.share_name || a.symbol || "").trim();
            if (!label || typeof a.total_score !== "number") return;
            const when = +new Date(a.created_at ?? 0);
            if (!(when >= cutoff)) return;
            const prev = best.get(label);
            if (prev == null || a.total_score > prev) best.set(label, a.total_score);
        });
        return Array.from(best.entries())
            .map(([label, score]) => ({ label, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }, [completed]);

    const modelRuns = useMemo(() => modelUsage.reduce((s, m) => s + m.count, 0), [modelUsage]);

    const trend = useMemo(() => {
        return [...completed]
            .sort((a, b) => +new Date(a.created_at ?? 0) - +new Date(b.created_at ?? 0))
            .slice(-15);
    }, [completed]);

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
            },
            false // logos come from LogoLegend below the chart
        );
    }, [modelUsage, chartTheme, chartAnim]);

    /**
     * Stock leaderboard — horizontal bars, not a donut. A ranking is read by
     * comparing lengths down a shared axis; a donut makes that comparison
     * harder than it needs to be. Fixed 0–100 domain so bar length means the
     * same thing on every run.
     */
    const stockBars = useMemo(() => {
        const t = chartTheme;
        const n = topStocks.length;
        return {
            animation: chartAnim,
            // Labels fill the gutter (they were reserved but hidden — that was
            // the dead space on the left) and the tooltip names the bar on hover.
            grid: { left: 92, right: 34, top: 4, bottom: 2 },
            tooltip: {
                ...tooltipStyle(t),
                trigger: "item",
                confine: true,
                axisPointer: { show: false },
                formatter: (params: any) => {
                    const p = Array.isArray(params) ? params[0] : params;
                    const s = topStocks[p.dataIndex];
                    if (!s) return "";
                    return `<b>${esc(s.label)}</b><br/><span style="color:${t.ink.tertiary}">${s.score.toFixed(1)} match · best in 30d</span>`;
                },
            },
            xAxis: { type: "value", min: 0, max: 100, show: false },
            yAxis: {
                type: "category",
                inverse: true, // rank 1 on top
                show: true,
                axisLine: { show: false },
                axisTick: { show: false },
                data: topStocks.map((s) => s.label),
                axisLabel: {
                    color: t.ink.secondary,
                    fontSize: 10,
                    fontFamily: t.fonts.mono,
                    width: 84,
                    overflow: "truncate",
                    margin: 8,
                },
            },
            series: [
                {
                    type: "bar",
                    barWidth: 9,
                    data: topStocks.map((s, i) => ({
                        value: s.score,
                        itemStyle: { color: shadeRamp(t, t.signals.positive, i, n) },
                    })),
                    itemStyle: { borderRadius: [0, 4, 4, 0] },
                    label: {
                        show: true,
                        position: "right",
                        distance: 6,
                        color: t.ink.primary,
                        fontSize: 10,
                        fontFamily: t.fonts.tabular,
                        formatter: (p: any) => p.value.toFixed(1),
                    },
                },
            ],
        };
    }, [topStocks, chartTheme, chartAnim]);

    const scorePie = useMemo(() => {
        const t = chartTheme;
        return donutOption(
            t,
            chartAnim,
            // Bands are ordered severity, so they keep the app's signal colors
            // rather than a monochrome ramp. Resolved to concrete values —
            // ECharts cannot read var(--x).
            scoreBands.map((b) => ({
                name: b.label,
                value: b.count,
                itemStyle: {
                    color: b.key === "high" ? t.signals.positive : b.key === "mid" ? t.signals.caution : t.signals.negative,
                },
            })),
            (i, percent) => {
                const b = scoreBands[i];
                if (!b) return "";
                return `<b>${esc(b.label)} match</b><br/><span style="color:${t.ink.tertiary}">${percent}% · ${b.count} run${b.count === 1 ? "" : "s"}</span>`;
            }
        );
    }, [scoreBands, chartTheme, chartAnim]);

    const onRowClick = (id: string) => {
        navigate("/analysis-result/" + id);
    };

    return (
        <div className="min-h-full bg-[var(--surface-canvas)]">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6 py-6">
                {/*
                 * Masthead. No panel around it: the title carries the weight and
                 * the stat line carries the data, separated by tracking, weight
                 * and three shades of ink rather than by a box.
                 */}
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-0.5">
                    <div className="min-w-0">
                        <h1 className="text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                            Runs
                        </h1>
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <Stat value={String(total)} label={total === 1 ? "run" : "runs"} />
                            {completed.length > 0 && (
                                <>
                                    <Sep />
                                    <Stat value={String(completed.length)} label="completed" />
                                </>
                            )}
                            {avgScore != null && (
                                <>
                                    <Sep />
                                    <Stat value={avgScore.toFixed(1)} label="avg match" />
                                </>
                            )}
                        </div>
                    </div>
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} className="shrink-0">
                        <Button size="sm" onClick={() => navigate("/")} className="rounded-[3px] px-4">
                            + New Run
                        </Button>
                    </motion.div>
                </header>

                {/* Body: sidebar + table */}
                <div className="flex flex-wrap items-start gap-6 lg:flex-nowrap">
                    {/* Insights — one tall card, same shell as the run summary */}
                    <motion.div
                        variants={stagger}
                        initial="initial"
                        animate="animate"
                        className="w-full lg:w-[280px] lg:shrink-0"
                    >
                        <Card className="gap-3 rounded-lg py-4 shadow-none">
                            <CardHeader className="px-4 pb-0">
                                <CardTitle className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                                    Insights
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3 px-4">
                        {/* Top stocks — first: the leaderboard is the headline insight */}
                        <motion.div variants={staggerItem}>
                            <SectionLabel>Top Stocks</SectionLabel>
                            {topStocks.length === 0 ? (
                                <p className="text-[12px] text-[var(--ink-tertiary)]">No scored runs in the last 30 days</p>
                            ) : (
                                <Echart
                                    height={topStocks.length * 26 + 12}
                                    aria-label={`Top ${topStocks.length} stocks by best match score over the last 30 days. ${topStocks
                                        .map((s) => `${s.label} ${s.score.toFixed(1)}`)
                                        .join(", ")}`}
                                    option={stockBars}
                                />
                            )}
                            <p className="mt-2 text-[11px] text-[var(--ink-tertiary)]">
                                Best match per stock · last 30 days
                            </p>
                        </motion.div>

                        <div className="border-t border-[var(--hairline)]" />

                        {/* Run health */}
                        <motion.div variants={staggerItem}>
                            <SectionLabel>Run Health</SectionLabel>
                            <div className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[13px] text-[var(--ink-secondary)]">Completed</span>
                                    <span className="font-app-tabular text-[24px] leading-none font-semibold tabular-nums text-[var(--ink-primary)]">
                                        <CountUp value={completed.length} decimals={0} />
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[13px] text-[var(--ink-secondary)]">Failed</span>
                                    <span
                                        className={cn(
                                            "font-app-tabular text-[24px] leading-none font-semibold tabular-nums",
                                            failed.length > 0 ? "text-[var(--signal-negative)]" : "text-[var(--ink-primary)]"
                                        )}
                                    >
                                        <CountUp value={failed.length} decimals={0} />
                                    </span>
                                </div>
                                {total > 0 && (
                                    <div className="flex items-center gap-2">
                                        <MiniBar value={completed.length} max={total} color="var(--signal-positive)" />
                                        <span className="shrink-0 font-app-tabular text-[12px] tabular-nums text-[var(--ink-secondary)]">
                                            {Math.round(successRate * 100)}%
                                        </span>
                                    </div>
                                )}
                                {avgScore != null && (
                                    <p className="text-[11px] text-[var(--ink-tertiary)]">
                                        Avg match{" "}
                                        <span className="font-app-tabular font-medium tabular-nums text-[var(--ink-primary)]">
                                            {avgScore.toFixed(1)}
                                        </span>
                                    </p>
                                )}
                            </div>
                        </motion.div>

                        <div className="border-t border-[var(--hairline)]" />

                        {/* Score distribution */}
                        <motion.div variants={staggerItem}>
                            <SectionLabel>Score Distribution</SectionLabel>
                            {completed.length === 0 ? (
                                <p className="text-[12px] text-[var(--ink-tertiary)]">No completed runs yet</p>
                            ) : (
                                <Echart
                                    height={168}
                                    aria-label={`Match score bands across ${completed.length} completed runs. ${scoreBands
                                        .map((b) => `${b.label}: ${b.count}`)
                                        .join(", ")}`}
                                    option={scorePie}
                                />
                            )}
                        </motion.div>

                        <div className="border-t border-[var(--hairline)]" />

                        {/* Recent trend */}
                        <motion.div variants={staggerItem}>
                            <SectionLabel>Recent Trend</SectionLabel>
                            <Sparkline data={trend} agents={agents} />
                            {trend.length > 0 && (
                                <p className="mt-2 text-[11px] text-[var(--ink-tertiary)]">
                                    Last{" "}
                                    <span className="font-app-tabular font-medium tabular-nums text-[var(--ink-primary)]">
                                        {trend.length}
                                    </span>{" "}
                                    completed runs · oldest → newest
                                </p>
                            )}
                        </motion.div>

                        <div className="border-t border-[var(--hairline)]" />

                        {/* Model usage */}
                        <motion.div variants={staggerItem}>
                            <SectionLabel>Model Usage</SectionLabel>
                            {modelUsage.length === 0 ? (
                                <p className="text-[12px] text-[var(--ink-tertiary)]">No runs yet</p>
                            ) : (
                                <div>
                                    <Echart
                                        height={140}
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
                            </CardContent>
                        </Card>
                    </motion.div>

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
                                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-tertiary)]" />
                                <Input
                                    className="pl-9"
                                    placeholder="Search share, agent, model…"
                                    aria-label="Search runs"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </div>
                        </div>
                        {loading && uniqueAnalysis.length === 0 ? (
                            <div className="flex justify-center gap-3 py-16 text-[var(--ink-secondary)]">
                                <Spinner />
                                <span className="text-[13px]">Loading runs…</span>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[2px] border border-[var(--hairline)] bg-[var(--surface-panel)]">
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1000px] border-collapse text-sm">
                                        <thead>
                                            <tr className="bg-[var(--surface-recessed)]">
                                                {(
                                                    [
                                                        ["share", "Share"],
                                                        ["agent", "Agent"],
                                                        ["model", "Model"],
                                                        ["score", "Match"],
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
                                                                        <span className="h-2 w-2 shrink-0 rounded-[1px] bg-[var(--grid-line)]" />
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

                                                    return (
                                                        <motion.tr
                                                            variants={staggerItem}
                                                            exit={{ opacity: 0 }}
                                                            layout={false}
                                                            key={id}
                                                            onClick={() => onRowClick(id)}
                                                            className="cursor-pointer transition-colors duration-[160ms] hover:bg-[var(--surface-recessed)]"
                                                        >
                                                            {/* Share — plain text, not badge */}
                                                            <td className="px-4 py-3">
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
                                                            </td>

                                                            {/* Agent / Skill */}
                                                            <td className="max-w-[140px] overflow-hidden px-4 py-3">
                                                                {item.run_mode === "skill" ? (
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
                                                                ) : (
                                                                    <div className="flex min-w-0 items-center gap-2">
                                                                        <AgentAvatar agent={resolveAgent(item.agent_name || item.agent, agents)} size={24} />
                                                                        <span className="truncate text-[13px] text-[var(--ink-secondary)]">
                                                                            {agentName(item.agent_name || item.agent)}
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

                                                            {/* Match — tabular-nums + signal dot */}
                                                            <td className="px-4 py-3">
                                                                {itemScore != null ? (
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-[5px] w-[5px] shrink-0 rounded-full"
                                                                            style={{ background: signalColor(sig!) }}
                                                                        />
                                                                        <span className="font-app-tabular text-[13.5px] font-medium tabular-nums text-[var(--ink-primary)]">
                                                                            {itemScore.toFixed(1)}
                                                                        </span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[13px] text-[var(--ink-tertiary)]">—</span>
                                                                )}
                                                            </td>

                                                            {/* Duration — tabular */}
                                                            <td className="px-4 py-3 font-app-tabular text-[13px] tabular-nums text-[var(--ink-secondary)]">
                                                                {item.duration != null
                                                                    ? formatDuration(item.duration)
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
                            </div>
                        )}
                    </div>
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
