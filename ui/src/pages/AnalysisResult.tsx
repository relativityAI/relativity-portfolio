import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { 
    Box, 
    Flex, 
    Text, 
    Heading, 
    Badge, 
    SimpleGrid, 
    Spinner, 
    Container,
    Button,
    Table
} from "@chakra-ui/react";
import { AnalysisService } from "@/db";
import { MdArrowBack, MdAnalytics, MdHistory, MdInfoOutline } from "react-icons/md";

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
                <Flex justify="space-between" align="center" wrap="wrap" gap={4} borderBottom="1px solid" borderColor="gray.800" pb={8}>
                    <Flex direction="column" gap={1}>
                        <Link to="/analysis-list">
                            <Button variant="ghost" size="xs" mb={4} pl={0} color="gray.500" _hover={{ color: "white" }}>
                                <MdArrowBack /> Back to Analysis List
                            </Button>
                        </Link>
                        <Heading size="4xl" fontWeight="bold" letterSpacing="tight">
                            {analysis.share_name || analysis.symbol}
                            <Text as="span" ml={3} fontSize="2xl" color="gray.600" fontWeight="normal">
                                {analysis.symbol}
                            </Text>
                        </Heading>
                        <Flex align="center" gap={4} mt={2}>
                            <Badge colorPalette={isComplete ? "green" : "yellow"} size="md" variant="surface" px={3}>
                                {analysis.status?.toUpperCase()}
                            </Badge>
                            <Text color="gray.500" fontSize="xs">
                                <MdHistory style={{ display: 'inline', marginRight: '4px' }} />
                                {analysis.created_at ? new Date(analysis.created_at).toLocaleString() : 'N/A'}
                            </Text>
                            <Text color="gray.500" fontSize="xs">
                                <MdAnalytics style={{ display: 'inline', marginRight: '4px' }} />
                                ID: {id}
                            </Text>
                        </Flex>
                    </Flex>

                    {isComplete && (
                        <Flex align="center" gap={6} bg="gray.900" p={6} border="1px solid" borderColor="gray.800" rounded="sm">
                            <Box>
                                <Text fontSize="xs" fontWeight="bold" color="gray.600" letterSpacing="widest" mb={1}>TOTAL SCORE</Text>
                                <Text fontSize="4xl" fontWeight="black" color={analysis.total_score >= 0.7 ? "green.700" : analysis.total_score >= 0.4 ? "yellow.700" : "red.700"}>
                                    {(analysis.total_score * 100).toFixed(1)}%
                                </Text>
                            </Box>
                        </Flex>
                    )}
                </Flex>

                {/* Metadata Row (Top Positioning) */}
                {isComplete && (
                    <SimpleGrid columns={{ base: 2, md: 4 }} gap={4} p={5} bg="gray.950" rounded="sm" border="1px solid" borderColor="gray.900" mt={-4}>
                        <Flex direction="column">
                            <Text color="gray.600" fontSize="xs" fontWeight="bold">MODEL</Text>
                            <Text fontWeight="semibold" fontSize="sm" mt={1} color="gray.400">{analysis.model || 'N/A'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.600" fontSize="xs" fontWeight="bold">ITERATIONS</Text>
                            <Text fontWeight="semibold" fontSize="sm" mt={1} color="gray.400">{analysis.iterations || '0'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.600" fontSize="xs" fontWeight="bold">RPM</Text>
                            <Text fontWeight="semibold" fontSize="sm" mt={1} color="gray.400">{analysis.rpm || '0'}</Text>
                        </Flex>
                        <Flex direction="column">
                            <Text color="gray.600" fontSize="xs" fontWeight="bold">COMPLETED AT</Text>
                            <Text fontWeight="semibold" fontSize="sm" mt={1} color="gray.400">{analysis.end_time ? new Date(analysis.end_time * 1000).toLocaleTimeString() : 'N/A'}</Text>
                        </Flex>
                    </SimpleGrid>
                )}

                {!isComplete && (
                    <Box p={10} textAlign="center" bg="gray.900" borderRadius="sm" border="1px dashed" borderColor="gray.800">
                        <Spinner size="lg" mb={4} color="gray.600" />
                        <Text fontSize="xl" color="gray.400">Analysis is currently in progress...</Text>
                        <Text color="gray.600">This page will automatically update when the analysis is finished.</Text>
                    </Box>
                )}

                {isComplete && (
                    <Flex direction="column" gap={12} borderTop="1px solid" borderColor="gray.800" pt={8}>
                        
                        {/* Summary Grid */}
                        <SimpleGrid columns={{ base: 1, md: 3 }} gap={6}>
                            <Box bg="gray.950" p={6} rounded="sm" border="1px solid" borderColor="gray.900">
                                <Text color="gray.600" fontSize="xs" fontWeight="bold" mb={3} letterSpacing="widest">QUANTITATIVE</Text>
                                <Text fontSize="3xl" fontWeight="bold" color="gray.300">{(analysis.quantitative_score * 100).toFixed(1)}%</Text>
                                <Text fontSize="2xs" color="gray.700" mt={1}>Metric compliance</Text>
                            </Box>
                            <Box bg="gray.950" p={6} rounded="sm" border="1px solid" borderColor="gray.900">
                                <Text color="gray.600" fontSize="xs" fontWeight="bold" mb={3} letterSpacing="widest">QUALITATIVE</Text>
                                <Text fontSize="3xl" fontWeight="bold" color="gray.300">{(analysis.qualitative_score * 100).toFixed(1)}%</Text>
                                <Text fontSize="2xs" color="gray.700" mt={1}>Contextual score</Text>
                            </Box>
                            <Box bg="gray.950" p={6} rounded="sm" border="1px solid" borderColor="gray.900">
                                <Text color="gray.600" fontSize="xs" fontWeight="bold" mb={3} letterSpacing="widest">DURATION</Text>
                                <Text fontSize="3xl" fontWeight="bold" color="gray.300">{analysis.duration?.toFixed(1)}s</Text>
                                <Text fontSize="2xs" color="gray.700" mt={1}>Total time</Text>
                            </Box>
                        </SimpleGrid>

                        {/* 1. Quantitative Section */}
                        <Box>
                            <Heading size="md" mb={6} color="gray.500" textTransform="uppercase" letterSpacing="widest">I. Quantitative Analysis</Heading>
                            <Flex direction="column" gap={8} width="full">
                                {Object.entries(quantitativeAnalysis).length > 0 ? (
                                    Object.entries(quantitativeAnalysis).map(([sourceName, sourceData]: [string, any]) => (
                                        <Box key={sourceName} bg="gray.900" p={6} rounded="sm" border="1px solid" borderColor="gray.800" width="full">
                                            <Flex justify="space-between" align="center" mb={6}>
                                                <Heading size="sm" fontWeight="bold" textTransform="uppercase" letterSpacing="tight" color="gray.300">Source: {sourceName}</Heading>
                                                <Badge size="lg" colorPalette="gray" variant="surface" border="1px solid" borderColor="gray.700" bg="transparent">Score: {(sourceData.score * 100).toFixed(1)}%</Badge>
                                            </Flex>
                                            <Table.Root size="sm" variant="line">
                                                <Table.Header>
                                                    <Table.Row>
                                                        <Table.ColumnHeader color="gray.600" py={4}>Metric</Table.ColumnHeader>
                                                        <Table.ColumnHeader color="gray.600" py={4}>Threshold</Table.ColumnHeader>
                                                        <Table.ColumnHeader color="gray.600" py={4}>Direction</Table.ColumnHeader>
                                                        <Table.ColumnHeader textAlign="right" color="gray.600" py={4}>Actual Value</Table.ColumnHeader>
                                                        <Table.ColumnHeader textAlign="right" color="gray.600" py={4}>Score</Table.ColumnHeader>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {Object.entries(sourceData.metrics || {}).map(([metricKey, metricValue]: [string, any]) => {
                                                        const filter = getFilterForMetric(sourceName, metricKey);
                                                        return (
                                                            <Table.Row key={metricKey}>
                                                                <Table.Cell fontWeight="semibold" fontSize="sm" color="gray.300">{filter?.title || metricKey}</Table.Cell>
                                                                <Table.Cell fontSize="xs" color="gray.500">{filter?.threshold || 'N/A'}</Table.Cell>
                                                                <Table.Cell>
                                                                    {filter?.direction ? (
                                                                        <Badge variant="surface" size="xs" colorPalette="gray" border="1px solid" borderColor="gray.800" color="gray.500">
                                                                            {filter.direction.toUpperCase()}
                                                                        </Badge>
                                                                    ) : '-'}
                                                                </Table.Cell>
                                                                <Table.Cell textAlign="right" fontWeight="bold" fontSize="sm" color="white">{metricValue.value}</Table.Cell>
                                                                <Table.Cell textAlign="right">
                                                                    <Badge size="sm" variant="surface" colorPalette={metricValue.score > 0.7 ? "green" : metricValue.score > 0.4 ? "yellow" : "red"} bg="transparent" border="1px solid" borderColor={metricValue.score > 0.7 ? "green.900" : metricValue.score > 0.4 ? "yellow.900" : "red.900"}>
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
                                    <Flex direction="column" align="center" py={20} color="gray.800" bg="gray.900" rounded="sm" border="1px dashed" borderColor="gray.800">
                                        <MdAnalytics size={40} />
                                        <Text mt={4} fontSize="sm">No quantitative data available.</Text>
                                    </Flex>
                                )}
                            </Flex>
                        </Box>

                        {/* 2. Qualitative Section */}
                        <Box pt={8} borderTop="1px solid" borderColor="gray.800">
                            <Heading size="md" mb={6} color="gray.400" textTransform="uppercase" letterSpacing="widest">II. Qualitative Findings</Heading>
                            {analysis.qualitative && analysis.qualitative.length > 0 ? (
                                <Flex direction="column" gap={4}>
                                    {analysis.qualitative.map((item: any, idx: number) => (
                                        <Box key={idx} p={6} bg="gray.900" rounded="sm" border="1px solid" borderColor="gray.800">
                                            {typeof item === 'string' ? (
                                                <Text fontSize="md" lineHeight="relaxed" color="gray.300">{item}</Text>
                                            ) : (
                                                <Flex direction="column" gap={2}>
                                                    <Text fontWeight="bold" color="gray.500" textTransform="uppercase" fontSize="xs" letterSpacing="widest">
                                                        {item.parameter}
                                                    </Text>
                                                    <Text fontSize="md" lineHeight="relaxed" color="gray.200">{item.content}</Text>
                                                </Flex>
                                            )}
                                        </Box>
                                    ))}
                                </Flex>
                            ) : (
                                <Flex direction="column" align="center" py={20} color="gray.800" bg="gray.900" rounded="sm" border="1px dashed" borderColor="gray.800">
                                    <MdInfoOutline size={40} />
                                    <Text mt={4} fontSize="sm">No qualitative findings available.</Text>
                                </Flex>
                            )}
                        </Box>

                        {/* 3. Data Sources Section */}
                        <Box pt={8} borderTop="1px solid" borderColor="gray.800">
                            <Heading size="md" mb={6} color="gray.400" textTransform="uppercase" letterSpacing="widest">III. Data Sources Configuration</Heading>
                            <SimpleGrid columns={{ base: 1, md: 2 }} gap={6}>
                                {analysis.data_sources?.map((source: any, idx: number) => (
                                    <Box key={idx} p={6} bg="gray.900" rounded="sm" border="1px solid" borderColor="gray.800">
                                        <Heading size="xs" mb={6} textTransform="uppercase" color="gray.600" letterSpacing="widest">
                                            Source: {source.source}
                                        </Heading>
                                        <Table.Root size="sm" variant="line">
                                            <Table.Header>
                                                <Table.Row>
                                                    <Table.ColumnHeader color="gray.700" py={3}>Metric</Table.ColumnHeader>
                                                    <Table.ColumnHeader color="gray.700" py={3}>Threshold</Table.ColumnHeader>
                                                    <Table.ColumnHeader color="gray.700" py={3}>Direction</Table.ColumnHeader>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {source.filters?.map((filter: any, fIdx: number) => (
                                                    <Table.Row key={fIdx}>
                                                        <Table.Cell fontWeight="medium" fontSize="xs" color="gray.400">{filter.title || filter.metric}</Table.Cell>
                                                        <Table.Cell fontSize="xs" color="gray.600">{filter.threshold}</Table.Cell>
                                                        <Table.Cell>
                                                            <Badge variant="surface" size="xs" colorPalette="gray" border="1px solid" borderColor="gray.800" color="gray.500" textTransform="uppercase">
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
                        </Box>
                    </Flex>
                )}
            </Flex>
        </Container>
    );
}
