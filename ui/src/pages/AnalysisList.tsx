import { Link, Text, Flex, Button, Table, Badge, Box } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdDeleteForever } from "react-icons/md";
import { AnalysisService } from "@/db";

export default function AnalysisList() {
    let navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);

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
            // Refresh the list after deletion
            fetchUniqueAnalysis();
        } catch (error) {
            console.error("Delete analysis error:", error);
        }
    };

    const handleCreate = () => {
        navigate("/analysis");
    };

    return (
        <Flex direction={"column"} gap={6}>
            <Flex justify="space-between" align="center">
                <Text fontWeight="bold" textStyle="4xl" letterSpacing="tight">
                    Share Analysis
                </Text>
                <Button
                    colorPalette="blue"
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
                            <Table.ColumnHeader color="gray.400" py={4}>ID</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Analysis Name</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Share</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Created At</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Final Score</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Link</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}>Status</Table.ColumnHeader>
                            <Table.ColumnHeader color="gray.400" py={4}></Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {fetchError ? (
                            <Table.Row>
                                <Table.Cell colSpan={8} textAlign="center" color="red.500" py={8}>
                                    Failed to fetch analysis data. Please check if the backend service is running.
                                </Table.Cell>
                            </Table.Row>
                        ) : uniqueAnalysis.length === 0 && !loading ? (
                            <Table.Row>
                                <Table.Cell colSpan={8} textAlign="center" color="gray.500" py={8}>
                                    No analyses found.
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            uniqueAnalysis.map((item) => {
                                const id = item.analysis_id || item._id || item.id;
                                return (
                                    <Table.Row key={id} _hover={{ bg: "gray.900" }}>
                                        <Table.Cell fontSize="xs" color="gray.600">{id}</Table.Cell>
                                        <Table.Cell fontWeight="medium">{item.name}</Table.Cell>
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
                                            <Link variant="underline" href={"/analysis-result/" + id} color="gray.400" _hover={{ color: "white" }} fontSize="xs">View ↗</Link>
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
