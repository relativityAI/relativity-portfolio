import { Text, Flex, Button, Table, Box, HStack, Spinner, Dialog } from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowUpward, MdArrowDownward } from "react-icons/md";
import { AnalysisService, ProfileService } from "@/db";

type SortKey = "share" | "created_at" | "score" | "status" | "profile" | "duration";

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

export default function AnalysisList() {
    const navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [stats, setStats] = useState({ profiles: 0, analysis: 0 });
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const fetchUniqueAnalysis = async () => {
        try {
            setLoading(true);
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
        ProfileService.listProfiles()
            .then((profiles) => {
                setStats((prev) => ({ ...prev, profiles: profiles.length || 0 }));
            })
            .catch(() => {});
    }, []);

    const handleDelete = async (id: string) => {
        try {
            await AnalysisService.deleteAnalysis(id);
            setDeleteTarget(null);
            fetchUniqueAnalysis();
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
                case "profile":
                    aVal = (a.profile_name || a.profile || "").toLowerCase();
                    bVal = (b.profile_name || b.profile || "").toLowerCase();
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

    const topShares = useMemo(() => {
        const shareMap = new Map<
            string,
            { symbol: string; name: string; scores: number[]; count: number }
        >();
        completed.forEach((a) => {
            const sym = a.symbol || a.share || "";
            const name = a.share_name || sym;
            if (!sym) return;
            if (!shareMap.has(sym)) shareMap.set(sym, { symbol: sym, name, scores: [], count: 0 });
            const entry = shareMap.get(sym)!;
            entry.scores.push(a.total_score);
            entry.count++;
        });
        return Array.from(shareMap.values())
            .map((e) => ({
                symbol: e.symbol,
                name: e.name,
                count: e.count,
                avgScore: e.scores.reduce((a: number, b: number) => a + b, 0) / e.scores.length,
            }))
            .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
            .slice(0, 5);
    }, [completed]);

    const topProfiles = useMemo(() => {
        const profileMap = new Map<string, { profile: string; scores: number[] }>();
        completed.forEach((a) => {
            const prof = a.profile || a.profile_name || "";
            if (!prof) return;
            if (!profileMap.has(prof)) profileMap.set(prof, { profile: prof, scores: [] });
            profileMap.get(prof)!.scores.push(a.total_score);
        });
        return Array.from(profileMap.values())
            .map((e) => ({
                profile: e.profile,
                count: e.scores.length,
                avgScore: e.scores.reduce((a: number, b: number) => a + b, 0) / e.scores.length,
            }))
            .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)
            .slice(0, 5);
    }, [completed]);

    useEffect(() => {
        setStats((prev) => ({ ...prev, analysis: uniqueAnalysis.length }));
    }, [uniqueAnalysis]);

    const colSpan = 7;

    const onRowClick = (id: string) => {
        window.open("/analysis-result/" + id, "_blank");
    };

    return (
        <Box bg="var(--surface-canvas)" minH="100vh">
            <Flex direction="column" gap={6} maxW="1200px" mx="auto" px={6} py={6}>
                {/* Page header */}
                <Flex justify="space-between" align="center">
                    <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                        Share Analysis
                    </Text>
                    <Button
                        size="sm"
                        onClick={() => navigate("/")}
                        bg="var(--accent-primary)"
                        color="#fff"
                        fontWeight={500}
                        fontSize="13px"
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
                        w={{ base: "full", lg: "260px" }}
                        flexShrink={0}
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        bg="var(--surface-panel)"
                    >
                        {/* Overview stats */}
                        <Box px={4} py={3}>
                            <Text
                                fontSize="10.5px"
                                fontWeight={500}
                                color="var(--ink-tertiary)"
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                mb={3}
                            >
                                Overview
                            </Text>
                            <Flex direction="column" gap={3}>
                                <Flex justify="space-between" align="baseline">
                                    <Text fontSize="13px" color="var(--ink-secondary)">
                                        Profiles
                                    </Text>
                                    <Text
                                        fontSize="24px"
                                        fontWeight={600}
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-primary)"
                                        lineHeight="1"
                                    >
                                        {stats.profiles}
                                    </Text>
                                </Flex>
                                <Flex justify="space-between" align="baseline">
                                    <Text fontSize="13px" color="var(--ink-secondary)">
                                        Analyses
                                    </Text>
                                    <Text
                                        fontSize="24px"
                                        fontWeight={600}
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-primary)"
                                        lineHeight="1"
                                    >
                                        {stats.analysis}
                                    </Text>
                                </Flex>
                            </Flex>
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Top Shares */}
                        <Box px={4} py={3}>
                            <Text
                                fontSize="10.5px"
                                fontWeight={500}
                                color="var(--ink-tertiary}"
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                mb={2}
                            >
                                Top Shares
                            </Text>
                            {topShares.length === 0 ? (
                                <Text fontSize="12px" color="var(--ink-tertiary)">
                                    No completed analyses
                                </Text>
                            ) : (
                                <Box>
                                    <Table.Root size="xs" variant="line" minWidth="auto">
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                >
                                                    #
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                >
                                                    Symbol
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                    textAlign="center"
                                                >
                                                    Runs
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                    textAlign="right"
                                                >
                                                    Match
                                                </Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {topShares.map((sh, i) => {
                                                const sig = scoreSignal(sh.avgScore);
                                                return (
                                                    <Table.Row key={sh.symbol}>
                                                        <Table.Cell
                                                            px={1}
                                                            fontSize="11px"
                                                            fontFamily="var(--font-mono)"
                                                            color="var(--ink-tertiary)"
                                                        >
                                                            {i + 1}
                                                        </Table.Cell>
                                                        <Table.Cell
                                                            px={1}
                                                            fontSize="12px"
                                                            fontWeight={500}
                                                            color="var(--ink-primary)"
                                                        >
                                                            {sh.symbol}
                                                        </Table.Cell>
                                                        <Table.Cell
                                                            px={1}
                                                            textAlign="center"
                                                            fontSize="12px"
                                                            fontFamily="var(--font-tabular)"
                                                            fontVariantNumeric="tabular-nums"
                                                            color="var(--ink-secondary)"
                                                        >
                                                            {sh.count}
                                                        </Table.Cell>
                                                        <Table.Cell px={1} textAlign="right">
                                                            <HStack gap={1} justify="flex-end">
                                                                <Box
                                                                    w="5px"
                                                                    h="5px"
                                                                    borderRadius="50%"
                                                                    bg={signalColor(sig)}
                                                                />
                                                                <Text
                                                                    fontSize="12px"
                                                                    fontFamily="var(--font-tabular)"
                                                                    fontVariantNumeric="tabular-nums"
                                                                    color="var(--ink-primary)"
                                                                >
                                                                    {sh.avgScore.toFixed(0)}
                                                                </Text>
                                                            </HStack>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                );
                                            })}
                                        </Table.Body>
                                    </Table.Root>
                                </Box>
                            )}
                        </Box>

                        <Box mx={4} borderTop="1px solid var(--hairline)" />

                        {/* Top Profiles */}
                        <Box px={4} py={3}>
                            <Text
                                fontSize="10.5px"
                                fontWeight={500}
                                color="var(--ink-tertiary)"
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                mb={2}
                            >
                                Top Profiles
                            </Text>
                            {topProfiles.length === 0 ? (
                                <Text fontSize="12px" color="var(--ink-tertiary)">
                                    No completed analyses
                                </Text>
                            ) : (
                                <Box>
                                    <Table.Root size="xs" variant="line" minWidth="auto">
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                >
                                                    #
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                >
                                                    Profile
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                    textAlign="center"
                                                >
                                                    Runs
                                                </Table.ColumnHeader>
                                                <Table.ColumnHeader
                                                    fontSize="10px"
                                                    fontWeight={500}
                                                    color="var(--ink-tertiary)"
                                                    px={1}
                                                    textAlign="right"
                                                >
                                                    Match
                                                </Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {topProfiles.map((p, i) => {
                                                const sig = scoreSignal(p.avgScore);
                                                return (
                                                    <Table.Row key={p.profile}>
                                                        <Table.Cell
                                                            px={1}
                                                            fontSize="11px"
                                                            fontFamily="var(--font-mono)"
                                                            color="var(--ink-tertiary)"
                                                        >
                                                            {i + 1}
                                                        </Table.Cell>
                                                        <Table.Cell
                                                            px={1}
                                                            fontSize="12px"
                                                            fontWeight={500}
                                                            color="var(--ink-primary)"
                                                            maxW="120px"
                                                            overflow="hidden"
                                                            textOverflow="ellipsis"
                                                            whiteSpace="nowrap"
                                                        >
                                                            {p.profile}
                                                        </Table.Cell>
                                                        <Table.Cell
                                                            px={1}
                                                            textAlign="center"
                                                            fontSize="12px"
                                                            fontFamily="var(--font-tabular)"
                                                            fontVariantNumeric="tabular-nums"
                                                            color="var(--ink-secondary)"
                                                        >
                                                            {p.count}
                                                        </Table.Cell>
                                                        <Table.Cell px={1} textAlign="right">
                                                            <HStack gap={1} justify="flex-end">
                                                                <Box
                                                                    w="5px"
                                                                    h="5px"
                                                                    borderRadius="50%"
                                                                    bg={signalColor(sig)}
                                                                />
                                                                <Text
                                                                    fontSize="12px"
                                                                    fontFamily="var(--font-tabular)"
                                                                    fontVariantNumeric="tabular-nums"
                                                                    color="var(--ink-primary)"
                                                                >
                                                                    {p.avgScore.toFixed(0)}
                                                                </Text>
                                                            </HStack>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                );
                                            })}
                                        </Table.Body>
                                    </Table.Root>
                                </Box>
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
                                    <Table.Root size="sm" variant="line" minWidth="750px">
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
                                                    onClick={() => toggleSort("profile")}
                                                    userSelect="none"
                                                >
                                                    <HStack gap={1}>
                                                        <span>Profile</span>
                                                        <SortIcon column="profile" />
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
                                        <Table.Body>
                                            {fetchError ? (
                                                <Table.Row>
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
                                                <Table.Row>
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
                                                            key={id}
                                                            cursor="pointer"
                                                            onClick={() => onRowClick(id)}
                                                            _hover={{
                                                                bg: "var(--surface-recessed)",
                                                            }}
                                                            transition="background 80ms"
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

                                                            {/* Profile */}
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
                                                                {item.profile_name ||
                                                                    item.profile ||
                                                                    "—"}
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
                                                                    variant="ghost"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setDeleteTarget(id);
                                                                    }}
                                                                    color="var(--ink-tertiary)"
                                                                    _hover={{
                                                                        color: "var(--signal-negative)",
                                                                        bg: "transparent",
                                                                    }}
                                                                    px={1}
                                                                    minW="auto"
                                                                    h="auto"
                                                                    opacity={0.4}
                                                                    _groupHover={{ opacity: 1 }}
                                                                    css={{
                                                                        "tr:hover &": {
                                                                            opacity: 1,
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
                                        </Table.Body>
                                    </Table.Root>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Flex>
            </Flex>

            {/* Delete confirmation */}
            <Dialog.Root
                open={deleteTarget !== null}
                onOpenChange={(e) => {
                    if (!e.open) setDeleteTarget(null);
                }}
                role="alertdialog"
            >
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title fontSize="16px">Delete analysis?</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text fontSize="13.5px" color="var(--ink-secondary)">
                                This will permanently remove this analysis result. This action cannot be undone.
                            </Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button
                                variant="outline"
                                size="sm"
                                mr={3}
                                onClick={() => setDeleteTarget(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                bg="var(--signal-negative)"
                                color="#fff"
                                _hover={{ opacity: 0.9 }}
                                onClick={() => deleteTarget && handleDelete(deleteTarget)}
                            >
                                Delete
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
}
