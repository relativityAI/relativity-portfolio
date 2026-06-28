import { Text, Flex, Button, Table, Badge, Box, HStack } from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MdDeleteForever, MdArrowUpward, MdArrowDownward } from "react-icons/md";
import { AnalysisService } from "@/db";

type SortKey = "id" | "share" | "created_at" | "score" | "status" | "profile" | "duration";

function formatDuration(sec: number): string {
    if (sec == null) return "";
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }
    return `${sec.toFixed(1)}s`;
}

export default function AnalysisList() {
    let navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    }

    useEffect(() => {
        fetchUniqueAnalysis()
    }, [])

    const handleDelete = async (id: string) => {
        try {
            await AnalysisService.deleteAnalysis(id);
            fetchUniqueAnalysis();
        } catch (error) {
            console.error("Delete analysis error:", error);
        }
    };

    const handleCreate = () => {
        navigate("/analysis");
    };

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir(key === "created_at" ? "desc" : "asc");
        }
    };

    const sorted = useMemo(() => {
        if (!sortKey) return [...uniqueAnalysis];
        const sorted = [...uniqueAnalysis].sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortKey) {
                case "id":
                    aVal = a.analysis_id || a._id || a.id;
                    bVal = b.analysis_id || b._id || b.id;
                    break;
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
        return sorted;
    }, [uniqueAnalysis, sortKey, sortDir]);

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return null;
        return sortDir === "asc" ? <MdArrowUpward size={12} /> : <MdArrowDownward size={12} />;
    };

    const colSpan = 8;

    const onRowClick = (id: string) => {
        window.open("/analysis-result/" + id, "_blank");
    };

    return (
        <Flex direction={"column"} gap={6}>
            <Flex justify="space-between" align="center">
                <Text fontWeight="bold" textStyle="4xl" letterSpacing="tight">
                    Share Analysis
                </Text>
                <Button
                    variant="outline"
                    colorPalette="gray"
                    size="sm"
                    onClick={handleCreate}
                    loading={loading}
                >
                    + New Analysis
                </Button>
            </Flex>

            <Box border="1px solid" borderColor="border" rounded="md" overflow="hidden">
                <Table.Root size="sm" variant="line" interactive>
                    <Table.Header bg="bg.muted">
                        <Table.Row>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("id")} userSelect="none">
                                <HStack gap={1}>
                                    <span>ID</span>
                                    <SortIcon column="id" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("share")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Share</span>
                                    <SortIcon column="share" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("profile")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Profile</span>
                                    <SortIcon column="profile" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("created_at")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Created At</span>
                                    <SortIcon column="created_at" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("score")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Score</span>
                                    <SortIcon column="score" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("duration")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Duration</span>
                                    <SortIcon column="duration" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4} cursor="pointer" onClick={() => toggleSort("status")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Status</span>
                                    <SortIcon column="status" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4}></Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {fetchError ? (
                            <Table.Row>
                                <Table.Cell colSpan={colSpan} textAlign="center" color="red.500" py={8}>
                                    Failed to fetch analysis data. Please check if the backend service is running.
                                </Table.Cell>
                            </Table.Row>
                        ) : sorted.length === 0 && !loading ? (
                            <Table.Row>
                                <Table.Cell colSpan={colSpan} textAlign="center" color="fg.subtle" py={8}>
                                    No analyses found.
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            sorted.map((item) => {
                                const id = item.analysis_id || item._id || item.id;
                                return (
                                    <Table.Row
                                        key={id}
                                        cursor="pointer"
                                        onClick={() => onRowClick(id)}
                                        _hover={{ bg: "bg.muted" }}
                                    >
                                        <Table.Cell fontSize="xs" color="fg.muted">{id}</Table.Cell>
                                        <Table.Cell>
                                            <Badge variant="surface" colorPalette="gray" size="sm" color="fg">{item.symbol || item.share_name}</Badge>
                                        </Table.Cell>
                                        <Table.Cell fontSize="xs" color="fg.subtle" maxW="120px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                            {item.profile_name || item.profile || "-"}
                                        </Table.Cell>
                                        <Table.Cell fontSize="sm" color="fg.subtle">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</Table.Cell>
                                        <Table.Cell>
                                            {item.total_score != null 
                                                ? <Badge colorPalette={item.total_score >= 70 ? "green" : item.total_score >= 40 ? "yellow" : "red"} variant="surface" size="sm" bg="transparent" border="1px solid" borderColor={item.total_score >= 70 ? "green.900" : item.total_score >= 40 ? "yellow.900" : "red.900"}>{item.total_score.toFixed(1)}%</Badge> 
                                                : "-"}
                                        </Table.Cell>
                                        <Table.Cell fontSize="xs" color="fg.subtle">
                                            {item.duration != null ? formatDuration(item.duration) : "-"}
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge size="xs" variant="surface" colorPalette="gray" color="fg.muted" bg="bg.muted">
                                                {item.status ? String(item.status).toUpperCase() : "PENDING"}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <MdDeleteForever
                                                onClick={(e) => { e.stopPropagation(); handleDelete(id); }}
                                                color="rgba(255,0,0,0.5)"
                                                size={20} style={{ cursor: "pointer" }} />
                                        </Table.Cell>
                                    </Table.Row>
                                );
                            })
                        )}
                    </Table.Body>
                </Table.Root>
            </Box>
        </Flex >
    )
}
