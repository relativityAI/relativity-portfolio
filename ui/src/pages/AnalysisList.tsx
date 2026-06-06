import { Link, Text, Flex, Button, Table, Badge } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdDeleteForever } from "react-icons/md";
import { AnalysisService } from "@/db";

export default function AnalysisList() {
    let navigate = useNavigate();

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);

    const variant = "outline"

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
        <Flex direction={"column"} gap={2}>

            <Flex>
                <Text fontWeight="semibold" textStyle="5xl">
                    Share Analysis
                </Text>
            </Flex>

            <Table.Root key={variant} size="sm" variant={variant}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader>ID</Table.ColumnHeader>
                        <Table.ColumnHeader>Analysis Name</Table.ColumnHeader>
                        <Table.ColumnHeader>Share</Table.ColumnHeader>
                        <Table.ColumnHeader>Created At</Table.ColumnHeader>
                        <Table.ColumnHeader>Final Score</Table.ColumnHeader>
                        <Table.ColumnHeader>Link</Table.ColumnHeader>
                        <Table.ColumnHeader>Status</Table.ColumnHeader>
                        <Table.ColumnHeader></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {fetchError ? (
                        <Table.Row>
                            <Table.Cell colSpan={7} textAlign="center" color="red.500">
                                Failed to fetch analysis data. Please check if the backend service is running.
                            </Table.Cell>
                        </Table.Row>
                    ) : uniqueAnalysis.length === 0 && !loading ? (
                        <Table.Row>
                            <Table.Cell colSpan={7} textAlign="center" color="gray.500">
                                No analyses found.
                            </Table.Cell>
                        </Table.Row>
                    ) : (
                        uniqueAnalysis.map((item) => {
                            const id = item.analysis_id || item._id || item.id;
                            return (
                                <Table.Row key={id}>
                                    <Table.Cell>{id}</Table.Cell>
                                    <Table.Cell fontWeight="medium">{item.name}</Table.Cell>
                                    <Table.Cell>
                                        <Badge variant="outline" colorPalette="blue">{item.symbol || item.share_name}</Badge>
                                    </Table.Cell>
                                    <Table.Cell>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</Table.Cell>
                                    <Table.Cell>
                                        {item.total_score != null 
                                            ? <Badge colorPalette={item.total_score >= 0.7 ? "green" : item.total_score >= 0.4 ? "yellow" : "red"} variant="solid">{(item.total_score * 100).toFixed(1)}%</Badge> 
                                            : "-"}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Link variant="underline" href={"/analysis-result/" + id}>Go to Analysis ↗</Link>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Badge colorPalette={item.status === 'COMPLETED' || item.status === 'complete' ? "green" : item.status === 'ERROR' || item.status === 'error' ? "red" : "yellow"}>
                                            {item.status ? String(item.status).toUpperCase() : "PENDING"}
                                        </Badge>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <MdDeleteForever
                                            onClick={() => handleDelete(id)}
                                            color="red"
                                            size={25} style={{ cursor: "pointer" }} />
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })
                    )}
                </Table.Body>
            </Table.Root>


            <Button
                variant={"surface"}
                onClick={handleCreate}
                loading={loading}
            >
                + New Analysis
            </Button>

        </Flex >
    )
}
