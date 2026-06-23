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
import ReactMarkdown from "react-markdown";
import {
    MdArrowBack, MdAnalytics, MdHistory, MdOutlineCheckCircle,
    MdOutlineStar, MdOutlineTimer, MdOutlineMemory,
    MdOutlineFactCheck, MdOutlinePsychology, MdErrorOutline
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
                const s = (data.status || "").toLowerCase();
                if (s === "pending" || s === "running" || s === "processing") {
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

    const terminalStatuses = ["complete", "completed", "success", "error", "failed"];
    const s = (analysis.status || "").toLowerCase();
    const isComplete = terminalStatuses.includes(s);
    const isError = s === "error" || s === "failed";

    const quantAnalysis = analysis.quantitative_analysis || {};
    const qualAnalysis = analysis.qualitative_analysis || {};
    const docs = analysis.documents || [];
    const webSrc = analysis.web_sources || [];

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
                                    colorPalette={isError ? "red" : isComplete ? "green" : "yellow"}
                                    variant="surface"
                                    size="sm"
                                    px={2.5}
                                >
                                    {isError ? <MdErrorOutline style={{ display: "inline", marginRight: 4 }} /> : isComplete ? <MdOutlineCheckCircle style={{ display: "inline", marginRight: 4 }} /> : null}
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
                                {analysis.total_score != null ? (
                                    <Text
                                        fontSize="5xl"
                                        fontWeight="black"
                                        lineHeight="1"
                                        color={`${scoreColor(analysis.total_score)}.400`}
                                    >
                                        {analysis.total_score.toFixed(1)}
                                        <Text as="span" fontSize="2xl" fontWeight="normal" color="fg.muted">%</Text>
                                    </Text>
                                ) : (
                                    <Text fontSize="2xl" fontWeight="bold" color="fg.muted">N/A</Text>
                                )}
                            </Box>
                        )}
                    </Flex>
                </Box>

                {analysis.error && (
                    <Box p={4} bg="red.50" border="1px solid" borderColor="red.200" rounded="md" _dark={{ bg: "red.900/20", borderColor: "red.700" }}>
                        <Flex gap={2} align="start">
                            <MdErrorOutline size={18} color="red.500" style={{ marginTop: 2 }} />
                            <Box>
                                <Text fontSize="sm" fontWeight="bold" color="red.700" _dark={{ color: "red.300" }} mb={1}>Analysis Error</Text>
                                <Text fontSize="xs" color="red.600" _dark={{ color: "red.300" }} whiteSpace="pre-wrap" fontFamily="mono">
                                    {analysis.error}
                                </Text>
                            </Box>
                        </Flex>
                    </Box>
                )}

                {!isComplete ? (
                    <Box p={10} textAlign="center" bg="bg.muted" rounded="md" border="1px dashed" borderColor="border">
                        <Spinner size="lg" mb={4} color="blue.500" />
                        <Text fontSize="lg" color="fg.muted">Analysis is currently in progress...</Text>
                        <Text color="fg.muted" fontSize="sm">This page will automatically update when finished.</Text>
                    </Box>
                ) : (
                    <>
                        {/* Metadata Row */}
                        <SimpleGrid columns={{ base: 2, md: 3, lg: 5 }} gap={3}>
                            {[
                                { icon: MdOutlineMemory, label: "MODEL", value: analysis.model || "N/A" },
                                { icon: MdOutlineTimer, label: "DURATION", value: analysis.duration ? `${analysis.duration.toFixed(1)}s` : "N/A" },
                                { icon: MdOutlineTimer, label: "END TIME", value: analysis.end_time ? new Date(analysis.end_time * 1000).toLocaleTimeString() : "N/A" },
                                { icon: MdOutlineFactCheck, label: "SOURCE", value: analysis.source || "N/A" },
                                { icon: MdOutlineStar, label: "PROFILE", value: analysis.profile || "N/A" },
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
                                {analysis.quantitative_score != null ? (
                                    <>
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
                                    </>
                                ) : (
                                    <Text fontSize="2xl" fontWeight="bold" color="fg.muted">N/A</Text>
                                )}
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Metric compliance score</Text>
                            </Box>
                            <Box bg="bg.subtle" p={5} rounded="md" border="1px solid" borderColor="border">
                                <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest" mb={2}>QUALITATIVE SCORE</Text>
                                {analysis.qualitative_score != null ? (
                                    <>
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
                                    </>
                                ) : (
                                    <Text fontSize="2xl" fontWeight="bold" color="fg.muted">N/A</Text>
                                )}
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Contextual analysis score</Text>
                            </Box>
                            <Box bg="bg.subtle" p={5} rounded="md" border="1px solid" borderColor="border">
                                <Text color="fg.muted" fontSize="2xs" fontWeight="bold" letterSpacing="widest" mb={2}>TOTAL DURATION</Text>
                                <Text fontSize="3xl" fontWeight="black" color="fg">
                                    {analysis.duration != null ? `${analysis.duration.toFixed(1)}s` : "N/A"}
                                </Text>
                                <Progress.Root value={100} max={100} size="xs" mt={2} colorPalette="gray">
                                    <Progress.Track bg="bg.emphasized">
                                        <Progress.Range />
                                    </Progress.Track>
                                </Progress.Root>
                                <Text fontSize="2xs" color="fg.muted" mt={1}>Total processing time</Text>
                            </Box>
                        </SimpleGrid>

                        {(docs.length > 0 || webSrc.length > 0) && (
                            <Flex gap={4} p={4} bg="bg.muted" border="1px solid" borderColor="border" rounded="md" wrap="wrap" align="center">
                                {docs.length > 0 && (
                                    <Box>
                                        <Text fontSize="2xs" fontWeight="bold" color="fg.subtle" letterSpacing="widest" mb={1}>DOCUMENTS</Text>
                                        <Text fontSize="xs" color="fg.muted">{docs.length} file{docs.length > 1 ? "s" : ""}</Text>
                                    </Box>
                                )}
                                {webSrc.length > 0 && (
                                    <Box>
                                        <Text fontSize="2xs" fontWeight="bold" color="fg.subtle" letterSpacing="widest" mb={1}>WEB SOURCES</Text>
                                        <Flex gap={1} wrap="wrap">
                                            {webSrc.map((s: string) => (
                                                <Badge key={s} variant="surface" size="xs" colorPalette="gray" color="fg.muted">{s}</Badge>
                                            ))}
                                        </Flex>
                                    </Box>
                                )}
                                {analysis.web_search && (
                                    <Box>
                                        <Text fontSize="2xs" fontWeight="bold" color="fg.subtle" letterSpacing="widest" mb={1}>WEB SEARCH</Text>
                                        <Text fontSize="xs" color="fg.muted">Enabled</Text>
                                    </Box>
                                )}
                            </Flex>
                        )}

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
                                                    <Box fontSize="sm" color="fg.subtle" lineHeight="relaxed" css={{
                                                            "& h1, & h2, & h3, & h4": { fontWeight: "bold", mt: 3, mb: 1, color: "var(--chakra-colors-fg)" },
                                                            "& h1": { fontSize: "xl" },
                                                            "& h2": { fontSize: "lg" },
                                                            "& h3": { fontSize: "md" },
                                                            "& p": { mb: 2, "&:last-child": { mb: 0 } },
                                                            "& ul, & ol": { pl: 5, mb: 2 },
                                                            "& li": { mb: 0.5 },
                                                            "& strong": { fontWeight: "bold", color: "var(--chakra-colors-fg)" },
                                                            "& code": { bg: "var(--chakra-colors-bg-emphasized)", px: 1, py: 0.5, rounded: "sm", fontSize: "xs" },
                                                            "& pre": { bg: "var(--chakra-colors-bg-emphasized)", p: 3, rounded: "md", overflow: "auto", mb: 2, fontSize: "xs" },
                                                            "& blockquote": { borderLeft: "3px solid", borderColor: "var(--chakra-colors-border)", pl: 3, mb: 2, color: "fg.muted", fontStyle: "italic" },
                                                            "& table": { borderCollapse: "collapse", mb: 2, width: "full" },
                                                            "& th, & td": { border: "1px solid", borderColor: "var(--chakra-colors-border)", px: 2, py: 1, textAlign: "left" },
                                                            "& th": { fontWeight: "bold", bg: "var(--chakra-colors-bg-emphasized)" },
                                                            "& hr": { my: 3, borderColor: "var(--chakra-colors-border)" },
                                                            "& a": { color: "blue.400", textDecoration: "underline" },
                                                        }}>
                                                        <ReactMarkdown>{paramData.analysis || "_No analysis available_"}</ReactMarkdown>
                                                    </Box>
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