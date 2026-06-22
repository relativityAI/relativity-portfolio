import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
    Box,
    Flex,
    Text,
    Badge,
    SimpleGrid,
    Spinner,
    Container,
    Button,
    Table,
    Progress,
    Separator,
    HStack,
    VStack,
} from "@chakra-ui/react";
import { AnalysisService } from "@/db";
import {
    MdArrowBack, MdAnalytics, MdHistory, MdOutlineCheckCircle,
    MdOutlineSpeed, MdOutlineStar, MdOutlineTimer, MdOutlineMemory,
    MdOutlineRepeat, MdOutlineHub, MdOutlineFactCheck, MdOutlinePsychology
} from "react-icons/md";

function scoreColor(score: number): string {
    if (score >= 70) return "green";
    if (score >= 40) return "yellow";
    return "red";
}

function ScoreBadge({ score, size = "sm" }: { score: number; size?: string }) {
    const color = scoreColor(score);
    return (
        <Badge
            size={size}
            variant="surface"
            colorPalette={color}
            bg="transparent"
            border="1px solid"
            borderColor={`${color}.800`}
            color={`${color}.400`}
            fontWeight="bold"
            fontSize="sm"
            px={2.5}
            py={0.5}
        >
            {score.toFixed(1)}%
        </Badge>
    );
}

function formatCurrency(val: number): string {
    if (val >= 1e9) return `₹${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e7) return `₹${(val / 1e7).toFixed(2)}Cr`;
    if (val >= 1e5) return `₹${(val / 1e5).toFixed(2)}L`;
    return `₹${val.toLocaleString()}`;
}

function formatValue(val: any, type?: string): string {
    if (val == null) return "-";
    if (type === "currency" && typeof val === "number") return formatCurrency(val);
    if (typeof val === "number") {
        if (Number.isInteger(val)) return val.toLocaleString();
        return val.toFixed(2);
    }
    return String(val);
}

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
                    setTimeout(fetchResult, 3000);
                }
            } else {
                setError("Analysis not found");
            }
        } catch {
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
                <Text fontSize="lg" fontWeight="medium" color="fg.muted">Fetching analysis results...</Text>
            </Flex>
        );
    }

    if (error) {
        return (
            <Flex justify="center" align="center" minH="60vh" direction="column" gap={4}>
                <Text color="red.500" fontSize="xl">{error}</Text>
                <Link to="/analysis-list">
                    <Button variant="ghost" color="fg.subtle"><MdArrowBack /> Back to List</Button>
                </Link>
            </Flex>
        );
    }

    if (!analysis) return null;

    const isComplete = analysis.status === "COMPLETED" || analysis.status === "complete";

    const quantAnalysis = analysis.quantitative_analysis || {};
    const qualAnalysis = analysis.qualitative_analysis || {};

    return (
        <Box>
            <Flex direction="column" gap={8}>
                {/* Back Button */}
                <Link to="/analysis-list">
                    <Button variant="ghost" size="xs" color="fg.subtle" _hover={{ color: "fg" }} pl={0}>
                        <MdArrowBack /> Back to Analysis List
                    </Button>
                </Link>

                {/* Header Card */}
                <Box bg="bg.muted" border="1px solid" borderColor="border" rounded="md" p={6}>
                    <Flex justify="space-between" align="flex-start" wrap="wrap" gap={4}>
                        <VStack align="flex-start" gap={2}>
                            <Flex align="center" gap={3}>
                                <Text fontSize="3xl" fontWeight="bold" letterSpacing="tight">
                                    {analysis.share_name || analysis.symbol}
                                </Text>
                                <Text as="span" fontSize="lg" color="fg.subtle" fontFamily="mono">
                                    {analysis.symbol}
                                </Text>
                                <Badge
                                    variant="surface"
                                    colorPalette={analysis.source === "NSE" ? "orange" : "blue"}
                                    size="xs"
                                >
                                    {analysis.source}
                                </Badge>
                            </Flex>
                            <Flex align="center" gap={3} wrap="wrap">
                                <Badge
                                    colorPalette={isComplete ? "green" : "yellow"}
                                    variant="surface"
                                    size="sm"
                                    px={2.5}
                                >
                                    {isComplete ? <MdOutlineCheckCircle style={{ display: "inline", marginRight: 4 }} /> : null}
                                    {analysis.status?.toUpperCase()}
                                </Badge>
                                <Text color="fg.muted" fontSize="xs">
                                    <MdHistory style={{ display: "inline", marginRight: 4 }} />
                                    {analysis.created_at ? new Date(analysis.created_at).toLocaleString() : "N/A"}
                                </Text>
                                <Text color="fg.muted" fontSize="xs" fontFamily="mono">
                                    ID: {id?.slice(0, 12)}...
                                </Text>
                            </Flex>
                        </VStack>

                        {isComplete && (
                            <Box textAlign="right">
                                <Text fontSize="2xs" fontWeight="bold" color="fg.muted" letterSpacing="widest" mb={1}>TOTAL SCORE</Text>
                                <Text
                                    fontSize="5xl"
                                    fontWeight="black"
                                    lineHeight="1"
                                    color={`${scoreColor(analysis.total_score)}.400`}
                                >
                                    {analysis.total_score.toFixed(1)}
                                    <Text as="span" fontSize="2xl" fontWeight="normal" color="fg.muted">%</Text>
                                </Text>
                            </Box>
                        )}
                    </Flex>
                </Box>

                {!isComplete ? (
                    <Box p={10} textAlign="center" bg="bg.muted" rounded="md" border="1px dashed" borderColor="border">
                        <Spinner size="lg" mb={4} color="blue.500" />
                        <Text fontSize="lg" color="fg.muted">Analysis is currently in progress...</Text>
                        <Text color="fg.muted" fontSize="sm">This page will automatically update when finished.</Text>
                    </Box>
                ) : (
                    <>
                        {/* Metadata Row */}
                        <SimpleGrid columns={{ base: 2, md: 4, lg: 7 }} gap={3}>
                            {[
                                { icon: MdOutlineMemory, label: "MODEL", value: analysis.model || "N/A" },
                                { icon: MdOutlineRepeat, label: "ITERATIONS", value: String(analysis.iterations ?? "N/A") },
                                { icon: MdOutlineSpeed, label: "RPM", value: String(analysis.rpm ?? "N/A") },
                                { icon: MdOutlineHub, label: "MAX RETRY", value: String(analysis.max_retry ?? "N/A") },
                                { icon: MdOutlineTimer, label: "DURATION", value: analysis.duration ? `${analysis.duration.toFixed(1)}s` : "N/A" },
                                { icon: MdOutlineTimer, label: "END TIME", value: analysis.end_time ? new Date(analysis.end_time * 1000).toLocaleTimeString() : "N/A" },
                                { icon: MdOutlineFactCheck, label: "SOURCE", value: analysis.source || "N/A" },
                            ].map(({ icon: Icon, label, value }) => (
                                <Box key={label} bg="bg.subtle" p={3} rounded="sm" border="1px solid" borderColor="border">
                                    <HStack gap={1.5} mb={1}>
                                        <Icon size={12} color="fg.muted" />
                                        <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest">{label}</Text>
                                    </HStack>
                                    <Text fontWeight="semibold" fontSize="sm" color="fg.muted">{value}</Text>
                                </Box>
                            ))}
                        </SimpleGrid>

                        {/* Score Summary */}
                        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
                            <Box bg="bg.subtle" p={5} rounded="md" border="1px solid" borderColor="border">
                                <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest" mb={2}>QUANTITATIVE SCORE</Text>
                                <Text fontSize="3xl" fontWeight="black" color={`${scoreColor(analysis.quantitative_score)}.400`}>
                                    {analysis.quantitative_score.toFixed(1)}%
                                </Text>
                                <Progress.Root
                                    value={analysis.quantitative_score}
                                    max={100}
                                    size="xs"
                                    mt={2}
                                    colorPalette={scoreColor(analysis.quantitative_score)}
                                >
                                    <Progress.Track bg="bg.emphasized">
                                        <Progress.Range />
                                    </Progress.Track>
                                </Progress.Root>
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Metric compliance score</Text>
                            </Box>
                            <Box bg="bg.subtle" p={5} rounded="md" border="1px solid" borderColor="border">
                                <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest" mb={2}>QUALITATIVE SCORE</Text>
                                <Text fontSize="3xl" fontWeight="black" color={`${scoreColor(analysis.qualitative_score)}.400`}>
                                    {analysis.qualitative_score.toFixed(1)}%
                                </Text>
                                <Progress.Root
                                    value={analysis.qualitative_score}
                                    max={100}
                                    size="xs"
                                    mt={2}
                                    colorPalette={scoreColor(analysis.qualitative_score)}
                                >
                                    <Progress.Track bg="bg.emphasized">
                                        <Progress.Range />
                                    </Progress.Track>
                                </Progress.Root>
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Contextual analysis score</Text>
                            </Box>
                            <Box bg="bg.subtle" p={5} rounded="md" border="1px solid" borderColor="border">
                                <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest" mb={2}>TOTAL DURATION</Text>
                                <Text fontSize="3xl" fontWeight="black" color="fg">
                                    {analysis.duration?.toFixed(1)}s
                                </Text>
                                <Progress.Root value={100} max={100} size="xs" mt={2} colorPalette="gray">
                                    <Progress.Track bg="bg.emphasized">
                                        <Progress.Range />
                                    </Progress.Track>
                                </Progress.Root>
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Total processing time</Text>
                            </Box>
                        </SimpleGrid>

                        <Separator borderColor="border" />

                        {/* I. Quantitative Analysis */}
                        <Box>
                            <HStack gap={2} mb={6}>
                                <MdAnalytics size={18} color="fg.subtle" />
                                <Text fontSize="sm" fontWeight="black" color="fg.subtle" letterSpacing="widest">I. QUANTITATIVE ANALYSIS</Text>
                                <Badge variant="surface" size="xs" colorPalette="gray" color="fg.subtle">
                                    {Object.keys(quantAnalysis).length} metrics
                                </Badge>
                            </HStack>

                            {Object.keys(quantAnalysis).length > 0 ? (
                                <Box border="1px solid" borderColor="border" rounded="md" overflow="hidden">
                                    <Table.Root size="sm" variant="line">
                                        <Table.Header bg="bg.muted">
                                            <Table.Row>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4}>Metric</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4}>Condition</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4} textAlign="right">Threshold</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4} textAlign="right">Actual</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4} textAlign="center">Wgt</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" py={3.5} px={4} textAlign="right">Score</Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {Object.entries(quantAnalysis).map(([metricKey, metricData]: [string, any]) => {
                                                const opSymbol: Record<string, string> = {
                                                    gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between",
                                                };
                                                return (
                                                    <Table.Row key={metricKey} _hover={{ bg: "bg.muted/50" }}>
                                                        <Table.Cell fontWeight="semibold" fontSize="sm" color="fg" px={4}>
                                                            {metricData.metric_name || metricKey}
                                                            <Text as="span" fontSize="2xs" color="fg.muted" ml={2} fontFamily="mono">{metricKey}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell px={4}>
                                                            <Badge variant="surface" size="xs" colorPalette="gray" color="fg.subtle" border="1px solid" borderColor="border">
                                                                {opSymbol[metricData.operator] || metricData.operator}
                                                            </Badge>
                                                        </Table.Cell>
                                                        <Table.Cell textAlign="right" fontSize="sm" color="fg.subtle" px={4} fontFamily="mono">
                                                            {formatValue(metricData.threshold, metricData.metric_type)}
                                                        </Table.Cell>
                                                        <Table.Cell textAlign="right" fontWeight="bold" fontSize="sm" color="fg" px={4} fontFamily="mono">
                                                            {formatValue(metricData.value, metricData.metric_type)}
                                                        </Table.Cell>
                                                        <Table.Cell textAlign="center" px={4}>
                                                            <Badge variant="surface" size="xs" colorPalette="blue" color="blue.400" bg="transparent">
                                                                {metricData.weightage ?? "-"}
                                                            </Badge>
                                                        </Table.Cell>
                                                        <Table.Cell textAlign="right" px={4}>
                                                            <ScoreBadge score={(metricData.score ?? 0) * 100} />
                                                        </Table.Cell>
                                                    </Table.Row>
                                                );
                                            })}
                                        </Table.Body>
                                    </Table.Root>
                                </Box>
                            ) : (
                                <Flex direction="column" align="center" py={16} color="fg.muted" bg="bg.muted" rounded="md" border="1px dashed" borderColor="border">
                                    <MdAnalytics size={40} />
                                    <Text mt={4} fontSize="sm" color="fg.muted">No quantitative data available.</Text>
                                </Flex>
                            )}
                        </Box>

                        <Separator borderColor="border" />

                        {/* II. Qualitative Analysis */}
                        <Box>
                            <HStack gap={2} mb={6}>
                                <MdOutlinePsychology size={18} color="fg.subtle" />
                                <Text fontSize="sm" fontWeight="black" color="fg.subtle" letterSpacing="widest">II. QUALITATIVE ANALYSIS</Text>
                                <Badge variant="surface" size="xs" colorPalette="gray" color="fg.subtle">
                                    {Object.keys(qualAnalysis).length} parameters
                                </Badge>
                            </HStack>

                            {Object.keys(qualAnalysis).length > 0 ? (
                                <VStack gap={3} align="stretch">
                                    {Object.entries(qualAnalysis).map(([paramName, paramData]: [string, any]) => (
                                        <Box
                                            key={paramName}
                                            p={5}
                                            bg="bg.muted"
                                            rounded="md"
                                            border="1px solid"
                                            borderColor="border"
                                            _hover={{ borderColor: "border.emphasized" }}
                                            transition="all 0.15s"
                                        >
                                            <Flex justify="space-between" align="flex-start" wrap="wrap" gap={3}>
                                                <Box flex={1}>
                                                    <Flex align="center" gap={2} mb={2}>
                                                        <Text fontWeight="bold" fontSize="sm" color="fg">{paramName}</Text>
                                                        <Badge variant="surface" size="xs" colorPalette="blue" color="blue.400" bg="transparent">
                                                            wgt {paramData.weightage ?? "-"}
                                                        </Badge>
                                                    </Flex>
                                                    <Text fontSize="sm" color="fg.subtle" lineHeight="relaxed">
                                                        {paramData.analysis || "No analysis available"}
                                                    </Text>
                                                </Box>
                                                <ScoreBadge score={paramData.score ?? 0} size="md" />
                                            </Flex>
                                        </Box>
                                    ))}
                                </VStack>
                            ) : (
                                <Flex direction="column" align="center" py={16} color="fg.muted" bg="bg.muted" rounded="md" border="1px dashed" borderColor="border">
                                    <MdOutlineStar size={40} />
                                    <Text mt={4} fontSize="sm" color="fg.muted">No qualitative findings available.</Text>
                                </Flex>
                            )}
                        </Box>
                    </>
                )}
            </Flex>
        </Box>
    );
}