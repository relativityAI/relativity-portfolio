import { Text, Flex, Button, Table, Box, HStack, Spinner } from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowUpward, MdArrowDownward } from "react-icons/md";
import { AnalysisService, AgentService } from "@/db";
import { agentDisplayName } from "@/utils";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem, CountUp } from "@/lib/motion";
import ConfirmDialog from "@/components/ConfirmDialog";

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
        <Text
            fontSize="10.5px"
            fontWeight={500}
            color="var(--ink-tertiary)"
            letterSpacing="0.06em"
            textTransform="uppercase"
            mb={3}
        >
            {children}
        </Text>
    );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (
        <Box
            flex={1}
            h="6px"
            bg="var(--surface-recessed)"
            borderRadius="2px"
            overflow="hidden"
            minW={0}
        >
            <Box as={motion.div} h="full" bg={color} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease }} />
        </Box>
    );
}

function Sparkline({ data, agents, height = 40 }: { data: any[]; agents: any[]; height?: number }) {
    const [tip, setTip] = useState<number | null>(null);
    if (data.length < 2) {
        return (
            <Text fontSize="11px" color="var(--ink-tertiary)">
                Not enough completed runs yet
            </Text>
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
        <Box position="relative" width="full">
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
                    <Box
                        key={i}
                        position="absolute"
                        left={`${x}%`}
                        top={`${y}px`}
                        w="18px"
                        h="18px"
                        transform="translate(-50%, -50%)"
                        style={{ cursor: "default" }}
                        onMouseEnter={() => setTip(i)}
                        onMouseLeave={() => setTip(null)}
                    >
                        <Box
                            position="absolute"
                            top="50%"
                            left="50%"
                            w="6px"
                            h="6px"
                            borderRadius="50%"
                            bg="var(--surface-panel)"
                            border="1.5px solid var(--accent-primary)"
                            transform="translate(-50%, -50%)"
                        />
                        {tip === i && (
                            <Box
                                position="absolute"
                                bottom="10px"
                                left={i === 0 ? "0%" : i === pts.length - 1 ? "100%" : "50%"}
                                transform={i === 0 ? "none" : i === pts.length - 1 ? "translateX(-100%)" : "translateX(-50%)"}
                                bg="var(--surface-panel)"
                                border="1px solid var(--hairline)"
                                borderRadius="8px"
                                px={2.5}
                                py={1.5}
                                boxShadow="0 8px 24px rgba(0,0,0,0.14)"
                                zIndex={20}
                                whiteSpace="nowrap"
                                pointerEvents="none"
                            >
                                <Text color="var(--ink-primary)" fontWeight={600} fontSize="11px">
                                    {symbol}
                                </Text>
                                <Flex gap={1.5} color="var(--ink-tertiary)" fontSize="10.5px" flexWrap="wrap">
                                    <Text>{date}</Text>
                                    <Text>·</Text>
                                    <Text>{agent}</Text>
                                </Flex>
                                <Text fontSize="11px" fontWeight={600} color="var(--signal-positive)">
                                    Fit {score}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}

export default function AnalysisList() {
    const navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [deleteTarget, setDeleteTarget] = useState<AnalysisItem | null>(null);
    const [agents, setAgents] = useState<any[]>([]);

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => {
                if (Array.isArray(data)) setAgents(data);
            })
            .catch(() => {});
    }, []);

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
        if (!sortKey) return [...uniqueAnalysis];
        return [...uniqueAnalysis].sort((a, b) => {
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
    }, [uniqueAnalysis, sortKey, sortDir]);

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return null;
        return sortDir === "asc" ? (
            <MdArrowUpward size={11} color="var(--ink-tertiary)" />
        ) : (
            <MdArrowDownward size={11} color="var(--ink-tertiary)" />
        );
    };

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

    const quantAvg = useMemo(() => {
        const vals = completed.map((a) => a.quantitative_score).filter((v) => typeof v === "number");
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }, [completed]);

    const qualAvg = useMemo(() => {
        const vals = completed.map((a) => a.qualitative_score).filter((v) => typeof v === "number");
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }, [completed]);

    const modelUsage = useMemo(() => {
        const map = new Map<string, number>();
        uniqueAnalysis.forEach((a) => {
            const m = a.model || "unknown";
            map.set(m, (map.get(m) || 0) + 1);
        });
        return Array.from(map.entries())
            .map(([model, count]) => ({ model, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [uniqueAnalysis]);

    const trend = useMemo(() => {
        return [...completed]
            .sort((a, b) => +new Date(a.created_at ?? 0) - +new Date(b.created_at ?? 0))
            .slice(-15);
    }, [completed]);

    const colSpan = 8;

    const onRowClick = (id: string) => {
        window.open("/analysis-result/" + id, "_blank");
    };

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Flex direction="column" gap={6} maxW="1600px" mx="auto" py={6}>
                {/* Page header */}
                <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={3} wrap="wrap"
                    as={motion.div}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                >
                    <Flex direction="column" gap={0.5}>
                        <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                            Share Analysis
                        </Text>
                        <Text fontSize="11.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                            {total} RUN{total === 1 ? "" : "S"}
                            {completed.length > 0 && ` · ${completed.length} COMPLETED`}
                            {avgScore != null && ` · AVG ${avgScore.toFixed(1)}`}
                        </Text>
                    </Flex>
                    <Button
                        as={motion.button}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        size="sm"
                        onClick={() => navigate("/")}
                        variant="surface"
                        colorPalette="blue"
                        px={4}
                        _hover={{ opacity: 0.9 }}
                        borderRadius="3px"
                    >
                        + New Analysis
                    </Button>
                </Flex>

                {/* Body: sidebar + table */}
                <Flex gap={6} align="flex-start" wrap={{ base: "wrap", lg: "nowrap" }}>
                    {/* Sidebar — single flattened panel */}
                    <Flex
                        direction="column"
                        w={{ base: "full", lg: "280px" }}
                        flexShrink={0}
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        bg="var(--surface-panel)"
                        as={motion.div}
                        variants={stagger}
                        initial="initial"
                        animate="animate"
                    >
                        {/* Run health */}
                        <Box px={4} py={3} as={motion.div} variants={staggerItem}>
                            <SectionLabel>Run Health</SectionLabel>
                            <Flex direction="column" gap={3}>
                                <Flex justify="space-between" align="baseline">
                                    <Text fontSize="13px" color="var(--ink-secondary)">
                                        Completed
                                    </Text>
                                    <Text
                                        fontSize="24px"
                                        fontWeight={600}
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-primary)"
                                        lineHeight="1"
                                    >
                                        <CountUp value={completed.length} decimals={0} />
                                    </Text>
                                </Flex>
                                <Flex justify="space-between" align="baseline">
                                    <Text fontSize="13px" color="var(--ink-secondary)">
                                        Failed
                                    </Text>
                                    <Text
                                        fontSize="24px"
                                        fontWeight={600}
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        color={failed.length > 0 ? "var(--signal-negative)" : "var(--ink-primary)"}
                                        lineHeight="1"
                                    >
                                        <CountUp value={failed.length} decimals={0} />
                                    </Text>
                                </Flex>
                                {total > 0 && (
                                    <Flex align="center" gap={2}>
                                        <MiniBar value={completed.length} max={total} color="var(--signal-positive)" />
                                        <Text
                                            fontSize="12px"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-secondary)"
                                            flexShrink={0}
                                        >
                                            {Math.round(successRate * 100)}%
                                        </Text>
                                    </Flex>
                                )}
                                {avgScore != null && (
                                    <Text fontSize="11px" color="var(--ink-tertiary)">
                                        Avg match{" "}
                                        <Text
                                            as="span"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-primary)"
                                            fontWeight={500}
                                        >
                                            {avgScore.toFixed(1)}
                                        </Text>
                                    </Text>
                                )}
                            </Flex>
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Score distribution */}
                        <Box px={4} py={3} as={motion.div} variants={staggerItem}>
                            <SectionLabel>Score Distribution</SectionLabel>
                            {completed.length === 0 ? (
                                <Text fontSize="12px" color="var(--ink-tertiary)">
                                    No completed runs yet
                                </Text>
                            ) : (
                                <Flex direction="column" gap={2.5}>
                                    {scoreBands.map((b) => (
                                        <Flex direction="column" gap={1} key={b.key}>
                                            <Flex justify="space-between" align="baseline">
                                                <Text fontSize="11px" color="var(--ink-secondary)">
                                                    {b.label}
                                                </Text>
                                                <Text
                                                    fontSize="12px"
                                                    fontFamily="var(--font-tabular)"
                                                    fontVariantNumeric="tabular-nums"
                                                    color="var(--ink-primary)"
                                                    fontWeight={500}
                                                >
                                                    {b.count}
                                                </Text>
                                            </Flex>
                                            <MiniBar value={b.count} max={completed.length} color={b.color} />
                                        </Flex>
                                    ))}
                                </Flex>
                            )}
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Quant vs Qual */}
                        <Box px={4} py={3} as={motion.div} variants={staggerItem}>
                            <SectionLabel>Quant vs Qual</SectionLabel>
                            {completed.length === 0 ? (
                                <Text fontSize="12px" color="var(--ink-tertiary)">
                                    No completed runs yet
                                </Text>
                            ) : (
                                <Flex direction="column" gap={2.5}>
                                    <Flex direction="column" gap={1}>
                                        <Flex justify="space-between" align="baseline">
                                            <Text fontSize="11px" color="var(--ink-secondary)">
                                                Quantitative
                                            </Text>
                                            <Text
                                                fontSize="12px"
                                                fontFamily="var(--font-tabular)"
                                                fontVariantNumeric="tabular-nums"
                                                color="var(--ink-primary)"
                                                fontWeight={500}
                                            >
                                                {quantAvg != null ? quantAvg.toFixed(1) : "—"}
                                            </Text>
                                        </Flex>
                                        <MiniBar value={quantAvg ?? 0} max={100} color="var(--accent-primary)" />
                                    </Flex>
                                    <Flex direction="column" gap={1}>
                                        <Flex justify="space-between" align="baseline">
                                            <Text fontSize="11px" color="var(--ink-secondary)">
                                                Qualitative
                                            </Text>
                                            <Text
                                                fontSize="12px"
                                                fontFamily="var(--font-tabular)"
                                                fontVariantNumeric="tabular-nums"
                                                color="var(--ink-primary)"
                                                fontWeight={500}
                                            >
                                                {qualAvg != null ? qualAvg.toFixed(1) : "—"}
                                            </Text>
                                        </Flex>
                                        <MiniBar value={qualAvg ?? 0} max={100} color="var(--signal-positive)" />
                                    </Flex>
                                </Flex>
                            )}
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Recent trend */}
                        <Box px={4} py={3} as={motion.div} variants={staggerItem}>
                            <SectionLabel>Recent Trend</SectionLabel>
                            <Sparkline data={trend} agents={agents} />
                            {trend.length > 0 && (
                                <Text fontSize="11px" color="var(--ink-tertiary)" mt={2}>
                                    Last{" "}
                                    <Text
                                        as="span"
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-primary)"
                                        fontWeight={500}
                                    >
                                        {trend.length}
                                    </Text>{" "}
                                    completed runs · oldest → newest
                                </Text>
                            )}
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Model usage */}
                        <Box px={4} py={3} as={motion.div} variants={staggerItem}>
                            <SectionLabel>Model Usage</SectionLabel>
                            {modelUsage.length === 0 ? (
                                <Text fontSize="12px" color="var(--ink-tertiary)">
                                    No runs yet
                                </Text>
                            ) : (
                                <Flex direction="column" gap={2.5}>
                                    {modelUsage.map((m) => (
                                        <Flex direction="column" gap={1} key={m.model}>
                                            <Flex justify="space-between" gap={2} align="baseline">
                                                <Text
                                                    fontSize="11px"
                                                    fontFamily="var(--font-mono)"
                                                    color="var(--ink-secondary)"
                                                    maxW="150px"
                                                    overflow="hidden"
                                                    textOverflow="ellipsis"
                                                    whiteSpace="nowrap"
                                                    title={m.model}
                                                >
                                                    {m.model}
                                                </Text>
                                                <Text
                                                    fontSize="12px"
                                                    fontFamily="var(--font-tabular)"
                                                    fontVariantNumeric="tabular-nums"
                                                    color="var(--ink-primary)"
                                                    fontWeight={500}
                                                    flexShrink={0}
                                                >
                                                    {m.count}
                                                </Text>
                                            </Flex>
                                            <MiniBar value={m.count} max={modelUsage[0].count} color="var(--ink-secondary)" />
                                        </Flex>
                                    ))}
                                </Flex>
                            )}
                        </Box>
                    </Flex>

                    {/* Main table */}
                    <Box flex={1} minW={0}>
                        {loading && uniqueAnalysis.length === 0 ? (
                            <Flex justify="center" py={16} gap={3} color="var(--ink-secondary)">
                                <Spinner size="sm" borderWidth="2px" />
                                <Text fontSize="13px">Loading analyses…</Text>
                            </Flex>
                        ) : (
                            <Box
                                border="1px solid var(--hairline)"
                                borderRadius="2px"
                                overflow="hidden"
                                bg="var(--surface-panel)"
                            >
                                <Box overflowX="auto">
                                    <Table.Root size="sm" variant="line" minWidth="1000px">
                                        <Table.Header>
                                            <Table.Row bg="var(--surface-recessed)">
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("share")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Share</span>
                                                        <SortIcon column="share" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("agent")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Agent</span>
                                                        <SortIcon column="agent" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("model")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Model</span>
                                                        <SortIcon column="model" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("score")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Match</span>
                                                        <SortIcon column="score" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("duration")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Duration</span>
                                                        <SortIcon column="duration" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("created_at")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Created</span>
                                                        <SortIcon column="created_at" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10.5px"
                                                    fontWeight={500}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--ink-tertiary)"
                                                    py={3}
                                                    px={4}
                                                    cursor="pointer"
                                                    onClick={() => toggleSort("status")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Status</span>
                                                        <SortIcon column="status" />
                                                    </HStack>
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader py={3} px={4} w="48px" />
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body as={motion.tbody} variants={stagger} initial="initial" animate="animate">
                                            <AnimatePresence initial={false}>
                                            {loading ? (
                                                <Table.Row as={motion.tr} key="loading" variants={staggerItem} exit={{ opacity: 0 }}>
                                                    <Table.Cell colSpan={colSpan} py={12}>
                                                        <Flex justify="center" gap={3} color="var(--ink-secondary)">
                                                            <Spinner size="sm" borderWidth="2px" />
                                                            <Text fontSize="13px">Loading analyses…</Text>
                                                        </Flex>
                                                    </Table.Cell>
                                                </Table.Row>
                                            ) : fetchError ? (
                                                <Table.Row as={motion.tr} key="error" variants={staggerItem} exit={{ opacity: 0 }}>
                                                    <Table.Cell
                                                        colSpan={colSpan}
                                                        py={8}
                                                        px={4}
                                                    >
                                                        <Box
                                                            borderLeft="3px solid var(--signal-negative)"
                                                            pl={3}
                                                        >
                                                            <Text
                                                                fontSize="13px"
                                                                color="var(--ink-primary)"
                                                            >
                                                                Failed to fetch analysis data.
                                                            </Text>
                                                            <Text
                                                                fontSize="12px"
                                                                color="var(--ink-secondary)"
                                                                mt={1}
                                                            >
                                                                Check if the backend service is running.
                                                            </Text>
                                                        </Box>
                                                    </Table.Cell>
                                                </Table.Row>
                                            ) : sorted.length === 0 && !loading ? (
                                                <Table.Row as={motion.tr} key="empty" variants={staggerItem} exit={{ opacity: 0 }}>
                                                    <Table.Cell
                                                        colSpan={colSpan}
                                                        textAlign="center"
                                                        color="var(--ink-tertiary)"
                                                        py={12}
                                                        fontSize="13px"
                                                    >
                                                        No analyses found.
                                                    </Table.Cell>
                                                </Table.Row>
                                            ) : (
                                                sorted.map((item) => {
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
                                                        <Table.Row
                                                            as={motion.tr}
                                                            variants={staggerItem}
                                                            exit={{ opacity: 0 }}
                                                            layout={false}
                                                            key={id}
                                                            cursor="pointer"
                                                            onClick={() => onRowClick(id)}
                                                            _hover={{
                                                                bg: "var(--surface-recessed)",
                                                            }}
                                                            transition="background 160ms"
                                                        >
                                                            {/* Share — plain text, not badge */}
                                                            <Table.Cell
                                                                fontSize="13.5px"
                                                                fontWeight={500}
                                                                color="var(--ink-primary)"
                                                                px={4}
                                                                py={3}
                                                            >
                                                                <Flex direction="column">
                                                                    <Text lineHeight="short">
                                                                        {item.share_name ||
                                                                            item.symbol ||
                                                                            "—"}
                                                                    </Text>
                                                                    {item.share_name &&
                                                                        item.symbol && (
                                                                            <Text
                                                                                fontSize="11px"
                                                                                fontFamily="var(--font-mono)"
                                                                                color="var(--ink-tertiary)"
                                                                            >
                                                                                {item.symbol}
                                                                            </Text>
                                                                        )}
                                                                </Flex>
                                                            </Table.Cell>

                                                            {/* Agent */}
                                                            <Table.Cell
                                                                fontSize="13px"
                                                                color="var(--ink-secondary)"
                                                                maxW="140px"
                                                                overflow="hidden"
                                                                textOverflow="ellipsis"
                                                                whiteSpace="nowrap"
                                                                px={4}
                                                                py={3}
                                                            >
                                                                {agentName(item.agent_name || item.agent)}
                                                            </Table.Cell>

                                                            {/* Model */}
                                                            <Table.Cell
                                                                fontSize="13px"
                                                                fontFamily="var(--font-mono)"
                                                                color="var(--ink-secondary)"
                                                                maxW="200px"
                                                                overflow="hidden"
                                                                textOverflow="ellipsis"
                                                                whiteSpace="nowrap"
                                                                px={4}
                                                                py={3}
                                                                title={item.model || undefined}
                                                            >
                                                                {item.model || "—"}
                                                            </Table.Cell>

                                                            {/* Match — tabular-nums + signal dot */}
                                                            <Table.Cell px={4} py={3}>
                                                                {itemScore != null ? (
                                                                    <HStack
                                                                        gap={1.5}
                                                                        justify="flex-start"
                                                                    >
                                                                        <Box
                                                                            w="5px"
                                                                            h="5px"
                                                                            borderRadius="50%"
                                                                            bg={signalColor(sig!)}
                                                                            flexShrink={0}
                                                                        />
                                                                        <Text
                                                                            fontSize="13.5px"
                                                                            fontFamily="var(--font-tabular)"
                                                                            fontVariantNumeric="tabular-nums"
                                                                            fontWeight={500}
                                                                            color="var(--ink-primary)"
                                                                        >
                                                                            {itemScore.toFixed(1)}
                                                                        </Text>
                                                                    </HStack>
                                                                ) : (
                                                                    <Text
                                                                        fontSize="13px"
                                                                        color="var(--ink-tertiary)"
                                                                    >
                                                                        —
                                                                    </Text>
                                                                )}
                                                            </Table.Cell>

                                                            {/* Duration — tabular */}
                                                            <Table.Cell
                                                                fontSize="13px"
                                                                fontFamily="var(--font-tabular)"
                                                                fontVariantNumeric="tabular-nums"
                                                                color="var(--ink-secondary)"
                                                                px={4}
                                                                py={3}
                                                            >
                                                                {item.duration != null
                                                                    ? formatDuration(item.duration)
                                                                    : "—"}
                                                            </Table.Cell>

                                                            {/* Created — relative time */}
                                                            <Table.Cell
                                                                fontSize="13px"
                                                                color="var(--ink-secondary)"
                                                                px={4}
                                                                py={3}
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
                                                            </Table.Cell>

                                                            {/* Status — dot + label */}
                                                            <Table.Cell px={4} py={3}>
                                                                <HStack gap={1.5}>
                                                                    <Box
                                                                        w="5px"
                                                                        h="5px"
                                                                        borderRadius="50%"
                                                                        bg={
                                                                            isItemError
                                                                                ? "var(--signal-negative)"
                                                                                : isItemComplete
                                                                                ? "var(--signal-positive)"
                                                                                : "var(--signal-caution)"
                                                                        }
                                                                        flexShrink={0}
                                                                    />
                                                                    <Text
                                                                        fontSize="12px"
                                                                        color="var(--ink-secondary)"
                                                                    >
                                                                        {isItemError
                                                                            ? "Failed"
                                                                            : isItemComplete
                                                                            ? "Complete"
                                                                            : "Running"}
                                                                    </Text>
                                                                </HStack>
                                                            </Table.Cell>

                                                            {/* Delete — hover-revealed */}
                                                            <Table.Cell px={2} py={3}>
                                                                <Button
                                                                    size="xs"
                                                                    variant="subtle"
                                                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget(item);
                                                                    }}
                                                                    color="var(--ink-tertiary)"
                                                                    _hover={{
                                                                        color: "var(--signal-negative)",
                                                                        bg: "transparent",
                                                                    }}
                                                                    px={1}
                                                                    h="auto"
                                                                    minW={{ base: "44px", md: "auto" }}
                                                                    minH={{ base: "44px", md: "auto" }}
                                                                    opacity={{ base: 1, md: 0.4 }}
                                                                    css={{
                                                                        "@media (min-width: 768px)": {
                                                                            "tr:hover &": {
                                                                                opacity: 1,
                                                                            },
                                                                        },
                                                                    }}
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
                                                                </Button>
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    );
                                                })
                                            )}
                                            </AnimatePresence>
                                        </Table.Body>
                                    </Table.Root>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Flex>
            </Flex>

            {/* Delete confirmation */}
            <ConfirmDialog
                open={deleteTarget !== null}
                title="Delete analysis?"
                message={
                    deleteTarget
                        ? `"${deleteTarget.share_name || deleteTarget.symbol || "this analysis"}"${
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
        </Box>
    );
}
