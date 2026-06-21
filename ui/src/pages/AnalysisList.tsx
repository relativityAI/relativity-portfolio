import { Link as ChakraLink, Text, Flex, Button, Table, Badge, Box, HStack } from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MdDeleteForever, MdArrowUpward, MdArrowDownward } from "react-icons/md";
import { AnalysisService } from "@/db";

type SortKey = "id" | "share" | "created_at" | "score" | "status";

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

    const colSpan = 7;

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

            <Box border="1px solid" borderColor="gray.800" rounded="md" overflow="hidden">
                <Table.Root size="sm" variant="line">
                    <Table.Header bg="gray.900">
                        <Table.Row>
                            <Table.ColumnHeader color="gray.400" py={4} cursor="pointer" onClick={() => toggleSort("id")} userSelect="none">
                                <HStack gap={1}>
                                    <span>ID</span>
                                    <SortIcon column="id" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4} cursor="pointer" onClick={() => toggleSort("share")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Share</span>
                                    <SortIcon column="share" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4} cursor="pointer" onClick={() => toggleSort("created_at")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Created At</span>
                                    <SortIcon column="created_at" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4} cursor="pointer" onClick={() => toggleSort("score")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Final Score</span>
                                    <SortIcon column="score" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Link</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4} cursor="pointer" onClick={() => toggleSort("status")} userSelect="none">
                                <HStack gap={1}>
                                    <span>Status</span>
                                    <SortIcon column="status" />
                                </HStack>
                            </Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}></Table.ColumnHeader>
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
                                <Table.Cell colSpan={colSpan} textAlign="center" color="gray.500" py={8}>
                                    No analyses found.
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            sorted.map((item) => {
                                const id = item.analysis_id || item._id || item.id;
                                return (
                                    <Table.Row key={id} _hover={{ bg: "gray.900" }}>
                                        <Table.Cell fontSize="xs" color="gray.600">{id}</Table.Cell>
                                        <Table.Cell>
                                            <Badge variant="surface" colorPalette="gray" size="sm" color="gray.300">{item.symbol || item.share_name}</Badge>
                                        </Table.Cell>
                                        <Table.Cell fontSize="sm" color="gray.500">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</Table.Cell>
                                        <Table.Cell>
                                            {item.total_score != null 
                                                ? <Badge colorPalette={item.total_score >= 0.7 ? "green" : item.total_score >= 0.4 ? "yellow" : "red"} variant="surface" size="sm" bg="transparent" border="1px solid" borderColor={item.total_score >= 0.7 ? "green.900" : item.total_score >= 0.4 ? "yellow.900" : "red.900"}>{(item.total_score * 100).toFixed(1)}%</Badge> 
                                                : "-"}
                                        </Table.Cell>
                                        <Table.Cell>
                                            <ChakraLink variant="underline" href={"/analysis-result/" + id} color="gray.400" _hover={{ color: "white" }} fontSize="xs">View ↗</ChakraLink>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge size="xs" variant="surface" colorPalette="gray" color="gray.400" bg="gray.900">
                                                {item.status ? String(item.status).toUpperCase() : "PENDING"}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <MdDeleteForever
                                                onClick={() => handleDelete(id)}
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
