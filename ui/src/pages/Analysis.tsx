import SearchBar from "@/components/SearchBar";
import {
    Badge, Button, Flex, Text, Separator, Spinner, Box, Select,
    createListCollection, Portal, HStack, VStack
} from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import {
    MdInfoOutline, MdCheckCircle, MdErrorOutline, MdOutlineRefresh,
    MdOutlineStorage, MdKeyboardArrowDown
} from "react-icons/md";
import { Link, useParams, useNavigate } from "react-router-dom";
import { AnalysisService, ProfileService, VoyagerService, NEBULA_BASE } from "@/db";
import { Tooltip } from "@/components/ui/tooltip";

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";
type DataPullStatus = "IDLE" | "CHECKING" | "AVAILABLE" | "PULLING" | "PULLED" | "ERROR";

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [dataPullStatus, setDataPullStatus] = useState<DataPullStatus>("IDLE");
    const [lastPullDate, setLastPullDate] = useState<string | null>(null);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");

    const [config, setConfig] = useState({
        source: "SEC",
        share: "",
        shareName: "",
        profile: "",
    });

    const [availableSources, setAvailableSources] = useState<any[]>([]);

    const sourceKeyMap: Record<string, { mainKey: string; secondaryKey: string; nameField: string }> = {
        SEC: { mainKey: "ticker", secondaryKey: "name", nameField: "name" },
        NSE: { mainKey: "SYMBOL", secondaryKey: "NAME", nameField: "NAME" },
    };

    const sourceKeys = sourceKeyMap[config.source] || sourceKeyMap.SEC;

    const sourceOptions = useMemo(() => {
        const items = availableSources.length > 0
            ? availableSources.map((s: any) => ({ label: s.NAME, value: s.SYMBOL }))
            : [
                { label: "SEC (US Market)", value: "SEC" },
                { label: "NSE (Indian Market)", value: "NSE" },
            ];
        return createListCollection({
            items,
            itemToString: (item: any) => item.label,
            itemToValue: (item: any) => item.value,
        });
    }, [availableSources]);

    const fetchAvailableSources = async () => {
        try {
            const data = await AnalysisService.getAvailableSources();
            setAvailableSources(Array.isArray(data) ? data : []);
        } catch {
            setAvailableSources([]);
        }
    };

    const handleConfigChange = (field: string, value: string, item?: any) => {
        const nameField = sourceKeys.nameField;
        setConfig(prev => ({
            ...prev,
            [field]: value || "",
            shareName: field === 'share' && item ? item[nameField] : prev.shareName
        }));
        if (field === 'share') {
            setDataPullStatus("CHECKING");
            setLastPullDate(null);
            checkLastDataPull(config.source, value);
        }
    };

    const handleSourceChange = (value: string) => {
        setConfig(prev => ({
            ...prev,
            source: value,
            share: "",
            shareName: "",
        }));
        setDataPullStatus("IDLE");
        setLastPullDate(null);
    };

    const checkLastDataPull = (source?: string, symbol?: string) => {
        const src = source || config.source;
        const sym = symbol || config.share;
        if (!src || !sym || id) return;
        setDataPullStatus("CHECKING");
        VoyagerService.getStockDataStatus(sym, src).then(result => {
            if (result && result.last_pull) {
                setLastPullDate(result.last_pull);
            } else {
                setLastPullDate(null);
            }
            setDataPullStatus("AVAILABLE");
        }).catch(() => {
            setLastPullDate(null);
            setDataPullStatus("AVAILABLE");
        });
    };

    const pullLatestData = async () => {
        if (!config.source || !config.share) return;
        setDataPullStatus("PULLING");
        try {
            await VoyagerService.pullStockData(config.share, config.source);
            setLastPullDate(new Date().toISOString());
            setDataPullStatus("PULLED");
        } catch (error) {
            console.error("Error pulling data:", error);
            setDataPullStatus("AVAILABLE");
        }
    };

    const fetchAvailableProfiles = async () => {
        try {
            const data = await ProfileService.listProfiles();
            if (Array.isArray(data)) {
                setAvailableProfiles(data);
            } else {
                setAvailableProfiles([]);
            }
        } catch (error) {
            console.error("Error fetching available profiles:", error);
            setAvailableProfiles([]);
        }
    };

    const runAnalysis = async () => {
        if (!config.source || !config.share || !config.profile) return;

        try {
            // Step 1: Check data availability
            setDataPullStatus("CHECKING");
            const dataStatus = await VoyagerService.getStockDataStatus(config.share, config.source);

            if (dataStatus && dataStatus.last_pull) {
                setLastPullDate(dataStatus.last_pull);
                setDataPullStatus("AVAILABLE");
            } else {
                // Step 2: Pull latest data if none exists
                setDataPullStatus("PULLING");
                await VoyagerService.pullStockData(config.share, config.source);
                setLastPullDate(new Date().toISOString());
                setDataPullStatus("PULLED");
            }

            // Step 3: Run analysis
            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                profile_name: config.profile
            });

            if (result && (result.corr_id || result.analysis_id)) {
                setCorrelationId(result.corr_id || result.analysis_id);
                setStatus("PENDING");
            }
        } catch (error) {
            console.error("Run analysis error:", error);
            setDataPullStatus("ERROR");
            setStatus("ERROR");
        }
    };

    const fetchAnalysisData = async (analysisId: string) => {
        try {
            setLoading(true);
            const data = await AnalysisService.readAnalysis(analysisId);
            if (data) {
                const exchangeSrc = !data.exchange ? "SEC"
                    : data.exchange.toUpperCase().includes("NSE") ? "NSE" : "SEC";
                setConfig(prev => ({
                    ...prev,
                    share: data.symbol || data.share || prev.share,
                    shareName: data.share_name || prev.shareName,
                    profile: data.profile_name || data.profile || prev.profile,
                    source: exchangeSrc,
                }));

                setCorrelationId(analysisId);

                if (data.status === "complete" || data.status === "error" || data.status === "COMPLETED" || data.status === "ERROR") {
                    const isComplete = data.status.toLowerCase() === "complete" || data.status.toLowerCase() === "completed";
                    setStatus(isComplete ? "COMPLETED" : "ERROR");
                    setDataPullStatus("AVAILABLE");
                    if (data.duration) {
                        setAnalysisDuration(`${data.duration.toFixed(1)}s`);
                    }
                } else {
                    setStatus("PENDING");
                    setDataPullStatus("AVAILABLE");
                }
            }
        } catch (error) {
            console.error("Error fetching analysis data:", error);
            setStatus("ERROR");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAvailableSources();
        fetchAvailableProfiles();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id]);

    useEffect(() => {
        if (status === "PENDING" && correlationId) {
            const interval = setInterval(async () => {
                try {
                    const data = await AnalysisService.readAnalysis(correlationId);
                    if (data) {
                        if (data.status === "complete" || data.status === "error" || data.status === "COMPLETED" || data.status === "ERROR") {
                            const isComplete = data.status.toLowerCase() === "complete" || data.status.toLowerCase() === "completed";
                            setStatus(isComplete ? "COMPLETED" : "ERROR");
                            setDataPullStatus("AVAILABLE");
                            if (data.duration) {
                                setAnalysisDuration(`${data.duration.toFixed(1)}s`);
                            }
                            clearInterval(interval);
                        }
                    }
                } catch (error: any) {
                    console.error("Check analysis status error:", error);
                    if (error.response && error.response.status === 404) {
                        console.log("Analysis not found, might need to wait or it failed.");
                    }
                }
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [status, correlationId]);

    const formatDate = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    const isConfigComplete = config.share !== "" && config.profile !== "";
    const canRunAnalysis = isConfigComplete && (dataPullStatus === "AVAILABLE" || dataPullStatus === "PULLED");

    const statusIcons = (active: boolean, done: boolean, error: boolean) => {
        if (error) return <MdErrorOutline color="red" size={16} />;
        if (active) return <Spinner size="xs" />;
        if (done) return <MdCheckCircle color="var(--chakra-colors-green-400)" size={16} />;
        return <Box w="14px" h="14px" rounded="full" border="2px solid" borderColor="gray.600" />;
    };

    return (
        <Flex direction={"column"} gap={8} py={4}>
            <Flex justify={"space-between"} align="center">
                <Text textStyle={"3xl"} fontWeight="bold" letterSpacing="tight">
                    New Analysis
                </Text>
                <Flex gap={2}>
                    <Badge variant="subtle" colorPalette="gray" size="sm" rounded="sm">Step 1: Source</Badge>
                    <Badge variant="subtle" colorPalette="gray" size="sm" rounded="sm">Step 2: Company</Badge>
                    <Badge variant="subtle" colorPalette="gray" size="sm" rounded="sm">Step 3: Profile</Badge>
                </Flex>
            </Flex>

            <Flex direction={{ base: "column", md: "row" }} gap={8} align="start">
                {/* Left: Configuration */}
                <Box flex="1" width="full">
                    <Box
                        bg="bg.subtle"
                        border="1px solid"
                        borderColor="border"
                        rounded="md"
                        p={8}
                    >
                        <Flex direction={"column"} gap={6}>
                            {/* Source Select */}
                            <Flex direction={"column"} align={"start"}>
                                <Flex align="center" gap={1} mb={2}>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Select Source</Text>
                                    <Tooltip content="Choose the market data source for the company to analyze.">
                                        <Box cursor="help">
                                            <MdInfoOutline size={14} color="fg.muted" />
                                        </Box>
                                    </Tooltip>
                                </Flex>
                                <Box width="full">
                                    <Select.Root
                                        collection={sourceOptions}
                                        value={[config.source]}
                                        onValueChange={(e) => handleSourceChange(e.value[0])}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control>
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select source" />
                                            </Select.Trigger>
                                            <Select.IndicatorGroup>
                                                <Select.Indicator />
                                            </Select.IndicatorGroup>
                                        </Select.Control>
                                        <Portal>
                                            <Select.Positioner>
                                                <Select.Content>
                                                    {sourceOptions.items.map((item: any) => (
                                                        <Select.Item item={item} key={item.value}>
                                                            {item.label}
                                                            <Select.ItemIndicator />
                                                        </Select.Item>
                                                    ))}
                                                </Select.Content>
                                            </Select.Positioner>
                                        </Portal>
                                    </Select.Root>
                                </Box>
                            </Flex>

                            {/* Target Company */}
                            <Flex direction={"column"} align={"start"}>
                                <Text mb={2} fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Target Company</Text>
                                <SearchBar
                                    url={`${NEBULA_BASE}/search-stocks`}
                                    mainKey={sourceKeys.mainKey}
                                    secondaryKey={sourceKeys.secondaryKey}
                                    onChange={handleConfigChange}
                                    field="share"
                                    params={{ source: config.source }}
                                    placeholder={config.source === "SEC" ? "Search US stocks (e.g., AAPL)" : "Search Indian stocks (e.g., RELIANCE)"}
                                />
                            </Flex>

                            {/* Investor Profile */}
                            <Flex direction={"column"} align={"start"}>
                                <Text mb={2} fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Investor Profile</Text>
                                <Box width="full" position="relative">
                                    <select
                                        style={{
                                            width: "100%",
                                            height: "40px",
                                            padding: "0 12px",
                                            border: "1px solid",
                                            borderColor: "var(--chakra-colors-border)",
                                            borderRadius: "2px",
                                            backgroundColor: "var(--chakra-colors-bg-muted)",
                                            color: "inherit",
                                            appearance: "none",
                                            cursor: "pointer",
                                            fontSize: "14px",
                                            outline: "none"
                                        }}
                                        value={config.profile}
                                        onChange={(e) => {
                                            setConfig({ ...config, profile: e.target.value });
                                        }}
                                    >
                                        <option value="" style={{ color: "black" }}>Select Portfolio Strategy</option>
                                        {availableProfiles.map((p, idx) => (
                                            <option key={idx} value={p.name} style={{ color: "black" }}>{p.name}</option>
                                        ))}
                                    </select>
                                    <Box
                                        position="absolute"
                                        right="10px"
                                        top="50%"
                                        transform="translateY(-50%)"
                                        pointerEvents="none"
                                        color="fg.muted"
                                    >
                                        <MdKeyboardArrowDown size={18} />
                                    </Box>
                                </Box>
                            </Flex>
                        </Flex>
                    </Box>
                </Box>

                {/* Right: Analysis Status */}
                <Box width={{ base: "full", md: "380px" }} flexShrink={0}>
                    <Box
                        bg="bg.subtle"
                        border="1px solid"
                        borderColor="border"
                        rounded="md"
                        p={6}
                    >
                        <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={5}>
                            Analysis Status
                        </Text>

                        <VStack gap={5} align="stretch">
                            {/* Step 1: Data Check */}
                            <Box>
                                <HStack gap={2} mb={2}>
                                    {statusIcons(
                                        dataPullStatus === "CHECKING" || dataPullStatus === "PULLING",
                                        dataPullStatus === "AVAILABLE" || dataPullStatus === "PULLED",
                                        dataPullStatus === "ERROR"
                                    )}
                                    <Text fontSize="sm" fontWeight="medium">Data Status Check</Text>
                                </HStack>
                                <Box ml={6}>
                                    {dataPullStatus === "IDLE" ? (
                                        <Text fontSize="xs" color="fg.subtle">
                                            {config.share ? "Checking..." : "Select a company to check"}
                                        </Text>
                                    ) : dataPullStatus === "CHECKING" ? (
                                        <HStack gap={1}>
                                            <Spinner size="xs" />
                                            <Text fontSize="xs" color="fg.subtle">Checking last data pull...</Text>
                                        </HStack>
                                    ) : dataPullStatus === "PULLING" ? (
                                        <HStack gap={1}>
                                            <Spinner size="xs" />
                                            <Text fontSize="xs" color="fg.subtle">Pulling latest data...</Text>
                                        </HStack>
                                    ) : (
                                        <>
                                            <Text fontSize="xs" color="fg.muted" mb={2}>
                                                {lastPullDate
                                                    ? `Last pulled: ${formatDate(lastPullDate)}`
                                                    : "No data pulled yet for this stock"}
                                            </Text>
                                            <HStack gap={2}>
                                                <Button
                                                    size="xs"
                                                    variant="outline"
                                                    onClick={pullLatestData}
                                                    loading={dataPullStatus === "PULLING"}
                                                    loadingText="Pulling..."
                                                >
                                                    <MdOutlineRefresh size={12} />
                                                    Pull Latest
                                                </Button>
                                                <Link to={`/manage-data?symbol=${config.share}&source=${config.source}`} target="_blank">
                                                    <Button size="xs" variant="ghost">
                                                        <MdOutlineStorage size={12} />
                                                        Check Data
                                                    </Button>
                                                </Link>
                                            </HStack>
                                        </>
                                    )}
                                </Box>
                            </Box>

                            <Separator borderColor="border" />

                            {/* Step 2: Analysis */}
                            <Box>
                                <HStack gap={2} mb={2}>
                                    {statusIcons(
                                        status === "PENDING",
                                        status === "COMPLETED",
                                        status === "ERROR"
                                    )}
                                    <Text fontSize="sm" fontWeight="medium">Analysis</Text>
                                </HStack>
                                <Box ml={6}>
                                    {!isConfigComplete ? (
                                        <Text fontSize="xs" color="fg.subtle">
                                            Complete configuration to run analysis
                                        </Text>
                                    ) : status === "PENDING" ? (
                                        <HStack gap={1}>
                                            <Spinner size="xs" />
                                            <Text fontSize="xs" color="fg.subtle">Running analysis...</Text>
                                        </HStack>
                                    ) : status === "COMPLETED" ? (
                                        <VStack gap={2} align="stretch">
                                            <Text fontSize="xs" color="fg.muted">
                                                {analysisDuration
                                                    ? `Completed in ${analysisDuration}`
                                                    : "Analysis complete"}
                                            </Text>
                                        <Link to={`/analysis-result/${correlationId}`}>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                colorPalette="green"
                                                rounded="sm"
                                                fontSize="xs"
                                            >
                                                View Analysis Report
                                            </Button>
                                        </Link>
                                        </VStack>
                                    ) : status === "ERROR" ? (
                                        <Text fontSize="xs" color="red.400">Analysis encountered an error</Text>
                                    ) : status === "EMPTY" && id ? (
                                        <HStack gap={1}>
                                            <Spinner size="xs" />
                                            <Text fontSize="xs" color="fg.subtle">Resuming analysis...</Text>
                                        </HStack>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={runAnalysis}
                                            disabled={!canRunAnalysis}
                                            loading={status === "PENDING"}
                                            loadingText="Running..."
                                            rounded="sm"
                                            fontSize="xs"
                                            fontWeight="bold"
                                            textTransform="uppercase"
                                            letterSpacing="wider"
                                        >
                                            Start Analysis
                                        </Button>
                                    )}
                                </Box>
                            </Box>
                        </VStack>
                    </Box>
                </Box>
            </Flex>

            <Separator />

            {loading ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Spinner size="xl" borderWidth="4px" />
                    <Text>Loading analysis data...</Text>
                </Flex>
            ) : status === "PENDING" ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Spinner size="xl" borderWidth="4px" />
                    <Text>Analysis in progress... This may take a few minutes.</Text>
                </Flex>
            ) : status === "COMPLETED" && correlationId ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Text color="fg.subtle">You can find all your previous analyses in the list view.</Text>
                </Flex>
            ) : !id && (
                <Flex justify={"center"} align={"center"} color={"grey"}>
                    <Box as="ul" fontSize="sm" lineHeight="2">
                        <Box as="li">Step 1: Select a market source (SEC or NSE).</Box>
                        <Box as="li">Step 2: Search and select the target company.</Box>
                        <Box as="li">Step 3: Choose an investor profile.</Box>
                        <Box as="li">Check data status, pull latest data if needed, then run the analysis.</Box>
                    </Box>
                </Flex>
            )}
        </Flex>
    )
}
