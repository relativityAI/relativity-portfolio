import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { 
    Box, 
    Flex, 
    Text, 
    Heading, 
    Badge, 
    Separator, 
    SimpleGrid, 
    Spinner, 
    Container,
    Button,
    List,
    Table,
    Tabs
} from "@chakra-ui/react";
import { AnalysisService } from "@/db";
import { MdArrowBack, MdAnalytics, MdHistory, MdInfoOutline, MdPsychology } from "react-icons/md";

export default function AnalysisResult() {
    const { id } = useParams();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchResult = async () => {
        if (!id) return;
        try {
            setLoading(true);
            const data = await AnalysisService.readAnalysis(id);
            if (data) {
                setAnalysis(data);
                if (data.status === "PENDING" || data.status === "pending") {
                    // Poll if still pending
                    setTimeout(fetchResult, 3000);
                }
            } else {
                setError("Analysis not found");
            }
        } catch (err) {
            console.error("Error fetching analysis:", err);
            setError("Failed to load analysis result");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchResult();
    }, [id]);

    if (loading && !analysis) {
        return (
            <Flex justify="center" align="center" minH="60vh" direction="column" gap={4}>
                <Spinner size="xl" borderWidth="4px" animationDuration="0.65s" color="blue.500" />
                <Text fontSize="lg" fontWeight="medium">Fetching analysis results...</Text>
            </Flex>
        );
    }

    if (error) {
        return (
            <Flex justify="center" align="center" minH="60vh" direction="column" gap={4}>
                <Text color="red.500" fontSize="xl">{error}</Text>
                <Link to="/analysis-list">
                    <Button variant="ghost"><MdArrowBack /> Back to List</Button>
                </Link>
            </Flex>
        );
    }

    if (!analysis) return null;

    const isComplete = analysis.status === "COMPLETED" || analysis.status === "complete";
    const scoreColor = (score: number) => {
        if (score >= 0.7) return "green.400";
        if (score >= 0.4) return "yellow.400";
        return "red.400";
    };

    const getFilterForMetric = (sourceName: string, metricKey: string) => {
        const source = analysis.data_sources?.find((s: any) => s.source.toLowerCase() === sourceName.toLowerCase());
        return source?.filters?.find((f: any) => f.metric === metricKey || f.title === metricKey);
    };

    // Robust data access for quantitative analysis
    const quantitativeAnalysis = analysis.quantitative_analysis || analysis.runs?.latest_quant || {};

    return (
        <Container maxW="container.xl" py={8}>
            <Flex direction="column" gap={8}>
                {/* Header Section */}
                <Flex justify="space-between" align="center" wrap="wrap" gap={4}>
                    <Flex direction="column" gap={2}>
                        <Link to="/analysis-list">
                            <Button variant="ghost" size="sm" mb={2} pl={0}>
                                <MdArrowBack /> Back to Analysis List
                            </Button>
                        </Link>
                        <Heading size="3xl" fontWeight="bold">
                            {analysis.share_name || analysis.symbol}
                            <Text as="span" ml={3} fontSize="2xl" color="gray.500" fontWeight="normal">
                                {analysis.symbol}
                            </Text>
                        </Heading>
                        <Flex align="center" gap={4}>
                            <Badge colorPalette={isComplete ? "green" : "yellow"} size="lg" variant="solid" borderRadius="full" px={4}>
                                {analysis.status?.toUpperCase()}
                            </Badge>
                            <Text color="gray.500" fontSize="sm">
                                <MdHistory style={{ display: 'inline', marginRight: '4px' }} />
                                {analysis.created_at ? new Date(analysis.created_at).toLocaleString() : 'N/A'}
                            </Text>
                            <Text color="gray.500" fontSize="sm">
                                <MdAnalytics style={{ display: 'inline', marginRight: '4px' }} />
                                ID: {id}
                            </Text>
                        </Flex>
                    </Flex>

                    {isComplete && (
                        <Flex direction="column" align="end" gap={1}>
                            <Text fontSize="sm" fontWeight="bold" color="gray.500">TOTAL SCORE</Text>
                            <Box 
                                borderRadius="2xl" 
                                bg="gray.800" 
                                p={6} 
                                border="1px solid" 
                                borderColor="gray.700"
                                boxShadow="0 0 20px rgba(0,0,0,0.3)"
                                textAlign="center"
                            >
                                <Text fontSize="5xl" fontWeight="black" color={scoreColor(analysis.total_score)}>
                                    {(analysis.total_score * 100).toFixed(1)}%
                                </Text>
                            </Box>
                        </Flex>
                    )}
                </Flex>

                {/* Metadata Row (Top Positioning) */}
                {isComplete && (
                    <SimpleGrid columns={{ base: 2, md: 4 }} gap={4} p={5} bg="gray.900" borderRadius="xl" border="1px solid" borderColor="gray.800">
                        <Flex direction="column">
                            <Text color="gray.500" fontSize="xs" fontWeight="bold">MODEL</Text>
                            <Text fontWeight="semibold" fontSize="sm">{analysis.model || 'N/A'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.500" fontSize="xs" fontWeight="bold">ITERATIONS</Text>
                            <Text fontWeight="semibold" fontSize="sm">{analysis.iterations || '0'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.500" fontSize="xs" fontWeight="bold">RPM</Text>
                            <Text fontWeight="semibold" fontSize="sm">{analysis.rpm || '0'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.500" fontSize="xs" fontWeight="bold">COMPLETED AT</Text>
                            <Text fontWeight="semibold" fontSize="sm">{analysis.end_time ? new Date(analysis.end_time * 1000).toLocaleTimeString() : 'N/A'}</Text>
                        </Flex>
                    </SimpleGrid>
                )}

                {!isComplete && (
                    <Box p={10} textAlign="center" bg="gray.900" borderRadius="xl" border="1px dashed" borderColor="gray.600">
                        <Spinner size="lg" mb={4} />
                        <Text fontSize="xl">Analysis is currently in progress...</Text>
                        <Text color="gray.400">This page will automatically update when the analysis is finished.</Text>
                    </Box>
                )}

                {isComplete && (
                    <Flex direction="column" gap={10}>
                        {/* Summary Grid */}
                        <SimpleGrid columns={{ base: 1, md: 3 }} gap={6}>
                            <Box bg="gray.900" p={6} borderRadius="xl" border="1px solid" borderColor="gray.800">
                                <Text color="gray.500" fontWeight="bold" mb={2}>QUANTITATIVE</Text>
                                <Separator mb={4} />
                                <Text fontSize="4xl" fontWeight="bold">{(analysis.quantitative_score * 100).toFixed(1)}%</Text>
                                <Text fontSize="sm" color="gray.400">Score based on financial metrics</Text>
                            </Box>
                            <Box bg="gray.900" p={6} borderRadius="xl" border="1px solid" borderColor="gray.800">
                                <Text color="gray.500" fontWeight="bold" mb={2}>QUALITATIVE</Text>
                                <Separator mb={4} />
                                <Text fontSize="4xl" fontWeight="bold">{(analysis.qualitative_score * 100).toFixed(1)}%</Text>
                                <Text fontSize="sm" color="gray.400">Score based on qualitative analysis</Text>
                            </Box>
                            <Box bg="gray.900" p={6} borderRadius="xl" border="1px solid" borderColor="gray.800">
                                <Text color="gray.500" fontWeight="bold" mb={2}>DURATION</Text>
                                <Separator mb={4} />
                                <Text fontSize="4xl" fontWeight="bold">{analysis.duration?.toFixed(1)}s</Text>
                                <Text fontSize="sm" color="gray.400">Total computation time</Text>
                            </Box>
                        </SimpleGrid>

                        {/* Tabs (Full Width) */}
                        <Tabs.Root defaultValue="analysis" variant="enclosed" width="full">
                            <Tabs.List width="full" display="flex">
                                <Tabs.Trigger value="analysis" flex={1}>
                                    <MdAnalytics /> Quantitative Analysis
                                </Tabs.Trigger>
                                <Tabs.Trigger value="qualitative" flex={1}>
                                    <MdPsychology /> Qualitative Findings
                                </Tabs.Trigger>
                                <Tabs.Trigger value="sources" flex={1}>
                                    <MdInfoOutline /> Data Sources & Raw Filters
                                </Tabs.Trigger>
                            </Tabs.List>
                            
                            <Tabs.Content value="analysis" py={6}>
                                <Flex direction="column" gap={8} width="full">
                                    {Object.entries(quantitativeAnalysis).length > 0 ? (
                                        Object.entries(quantitativeAnalysis).map(([sourceName, sourceData]: [string, any]) => (
                                            <Box key={sourceName} bg="gray.900" p={6} borderRadius="xl" border="1px solid" borderColor="gray.800" width="full">
                                                <Flex justify="space-between" align="center" mb={6}>
                                                    <Heading size="md" textTransform="capitalize">Source: {sourceName}</Heading>
                                                    <Badge size="lg" colorPalette="blue" variant="solid">Source Score: {(sourceData.score * 100).toFixed(1)}%</Badge>
                                                </Flex>
                                                <Table.Root size="sm" variant="line">
                                                    <Table.Header>
                                                        <Table.Row>
                                                            <Table.ColumnHeader>Metric</Table.ColumnHeader>
                                                            <Table.ColumnHeader>Threshold</Table.ColumnHeader>
                                                            <Table.ColumnHeader>Direction</Table.ColumnHeader>
                                                            <Table.ColumnHeader textAlign="right">Actual Value</Table.ColumnHeader>
                                                            <Table.ColumnHeader textAlign="right">Score</Table.ColumnHeader>
                                                        </Table.Row>
                                                    </Table.Header>
                                                    <Table.Body>
                                                        {Object.entries(sourceData.metrics || {}).map(([metricKey, metricValue]: [string, any]) => {
                                                            const filter = getFilterForMetric(sourceName, metricKey);
                                                            return (
                                                                <Table.Row key={metricKey}>
                                                                    <Table.Cell fontWeight="bold">{filter?.title || metricKey}</Table.Cell>
                                                                    <Table.Cell>{filter?.threshold || 'N/A'}</Table.Cell>
                                                                    <Table.Cell>
                                                                        {filter?.direction ? (
                                                                            <Badge variant="surface" colorPalette={filter.direction === 'higher' ? 'green' : 'blue'}>
                                                                                {filter.direction}
                                                                            </Badge>
                                                                        ) : '-'}
                                                                    </Table.Cell>
                                                                    <Table.Cell textAlign="right" fontWeight="semibold" color="white">{metricValue.value}</Table.Cell>
                                                                    <Table.Cell textAlign="right">
                                                                        <Badge colorPalette={metricValue.score > 0.7 ? "green" : metricValue.score > 0.4 ? "yellow" : "red"} variant="solid">
                                                                            {(metricValue.score * 100).toFixed(1)}%
                                                                        </Badge>
                                                                    </Table.Cell>
                                                                </Table.Row>
                                                            );
                                                        })}
                                                    </Table.Body>
                                                </Table.Root>
                                            </Box>
                                        ))
                                    ) : (
                                        <Flex direction="column" align="center" py={20} color="gray.500" bg="gray.900" borderRadius="xl">
                                            <MdAnalytics size={48} />
                                            <Text mt={4} fontSize="lg">No quantitative data available for this analysis.</Text>
                                        </Flex>
                                    )}
                                </Flex>
                            </Tabs.Content>

                            <Tabs.Content value="qualitative" py={6}>
                                {analysis.qualitative && analysis.qualitative.length > 0 ? (
                                    <List.Root gap={4}>
                                        {analysis.qualitative.map((item: any, idx: number) => (
                                            <List.Item key={idx} p={5} bg="gray.900" borderRadius="xl" borderLeft="6px solid" borderLeftColor="blue.500" boxShadow="sm">
                                                {typeof item === 'string' ? (
                                                    <Text fontSize="md" lineHeight="tall">{item}</Text>
                                                ) : (
                                                    <Flex direction="column" gap={1}>
                                                        <Text fontWeight="bold" color="blue.300" textTransform="uppercase" fontSize="xs">
                                                            {item.parameter}
                                                        </Text>
                                                        <Text fontSize="md" lineHeight="tall">{item.content}</Text>
                                                    </Flex>
                                                )}
                                            </List.Item>
                                        ))}
                                    </List.Root>
                                ) : (
                                    <Flex direction="column" align="center" py={20} color="gray.500" bg="gray.900" borderRadius="xl">
                                        <MdInfoOutline size={48} />
                                        <Text mt={4} fontSize="lg">No qualitative findings available for this analysis.</Text>
                                    </Flex>
                                )}
                            </Tabs.Content>

                            <Tabs.Content value="sources" py={6}>
                                <SimpleGrid columns={{ base: 1, md: 2 }} gap={6}>
                                    {analysis.data_sources?.map((source: any, idx: number) => (
                                        <Box key={idx} p={6} bg="gray.900" borderRadius="xl" border="1px solid" borderColor="gray.800">
                                            <Heading size="sm" mb={4} textTransform="uppercase" color="gray.400">
                                                Raw Source Configuration: {source.source}
                                            </Heading>
                                            <Table.Root size="sm">
                                                <Table.Header>
                                                    <Table.Row>
                                                        <Table.ColumnHeader>Metric</Table.ColumnHeader>
                                                        <Table.ColumnHeader>Threshold</Table.ColumnHeader>
                                                        <Table.ColumnHeader>Direction</Table.ColumnHeader>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {source.filters?.map((filter: any, fIdx: number) => (
                                                        <Table.Row key={fIdx}>
                                                            <Table.Cell>{filter.title || filter.metric}</Table.Cell>
                                                            <Table.Cell>{filter.threshold}</Table.Cell>
                                                            <Table.Cell>
                                                                <Badge variant="surface" colorPalette={filter.direction === 'higher' ? 'green' : 'blue'}>
                                                                    {filter.direction}
                                                                </Badge>
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    ))}
                                                </Table.Body>
                                            </Table.Root>
                                        </Box>
                                    ))}
                                </SimpleGrid>
                            </Tabs.Content>
                        </Tabs.Root>

                    </Flex>
                )}
            </Flex>
        </Container>
    );
}
