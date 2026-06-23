import SearchBar from "@/components/SearchBar";
import {
    Badge, Button, Flex, Text, Separator, Spinner, Box, Select,
    createListCollection, Portal, HStack, VStack, Input, Checkbox
} from "@chakra-ui/react";
import { memo, useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
    MdInfoOutline, MdCheckCircle, MdErrorOutline, MdOutlineRefresh,
    MdOutlineStorage, MdKeyboardArrowDown, MdSearch, MdWeb, MdDescription,
    MdWarning
} from "react-icons/md";
import { Link, useParams } from "react-router-dom";
import { AnalysisService, ProfileService, VoyagerService, NEBULA_BASE } from "@/db";
import { Tooltip } from "@/components/ui/tooltip";

const MAX_POLL_RETRIES = 30;

const DocumentRow = memo(function DocumentRow({ doc, checked, onToggle }: { doc: any; checked: boolean; onToggle: () => void }) {
    const fileUrl = doc.attchmntFile || "";
    const text = doc.attchmntText || "";
    const date = doc.an_dt || "";
    const isLink = fileUrl.startsWith("http") || fileUrl.startsWith("www");
    return (
        <Flex
            p={2}
            _hover={{ bg: "bg.muted" }}
            cursor="pointer"
            align="center"
            gap={2}
            borderBottom="1px solid"
            borderColor="border"
            _last={{ borderBottom: "none" }}
            onClick={onToggle}
        >
            <Checkbox.Root
                checked={checked}
                onCheckedChange={onToggle}
            >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
            </Checkbox.Root>
            <Box flex={1} minW={0}>
                <Text fontSize="xs" lineHeight={1.6} truncate>
                    {date && <Text as="span" color="fg.muted">{date} · </Text>}
                    {isLink ? (
                        <Box
                            as="a"
                            href={fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            color="blue.400"
                            textDecoration="underline"
                            onClick={e => e.stopPropagation()}
                        >
                            Link ↗
                        </Box>
                    ) : fileUrl ? (
                        <Text as="span" color="fg.muted">{fileUrl}</Text>
                    ) : null}
                    {text && <Text as="span" color="fg.muted"> · {text}</Text>}
                </Text>
            </Box>
        </Flex>
    );
});

const DocumentList = memo(function DocumentList({
    documents,
    allDocs,
    selectedDocuments,
    onToggle,
}: {
    documents: any[];
    allDocs: any[];
    selectedDocuments: string[];
    onToggle: (idx: number) => void;
}) {
    const docCount = documents.length;
    const maxVisible = 200;
    const visible = docCount > maxVisible ? documents.slice(0, maxVisible) : documents;
    const toggleRefs = useRef<Map<number, () => void>>(new Map());

    const getToggle = useCallback((idx: number) => {
        let fn = toggleRefs.current.get(idx);
        if (!fn) {
            fn = () => onToggle(idx);
            toggleRefs.current.set(idx, fn);
        }
        return fn;
    }, [onToggle]);

    return (
        <>
            {visible.map((doc: any) => {
                const docIdx = allDocs.indexOf(doc);
                const key = String(docIdx);
                return (
                    <DocumentRow
                        key={docIdx}
                        doc={doc}
                        checked={selectedDocuments.includes(key)}
                        onToggle={getToggle(docIdx)}
                    />
                );
            })}
            {docCount > maxVisible && (
                <Text px={2} py={1} fontSize="xs" color="fg.muted">
                    Showing {maxVisible} of {docCount} results. Refine your search.
                </Text>
            )}
        </>
    );
});

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";
type DataPullStatus = "IDLE" | "CHECKING" | "AVAILABLE" | "PULLING" | "PULLED" | "ERROR";

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

export default function Analysis() {
    const { id } = useParams();

    const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [dataPullStatus, setDataPullStatus] = useState<DataPullStatus>("IDLE");
    const [lastPullDate, setLastPullDate] = useState<string | null>(null);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");

    const [config, setConfig] = useState({
        source: "NSE",
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

    // ===== Announcements / Documents =====
    const [announcementQuery, setAnnouncementQuery] = useState("");
    const debouncedAnnouncementQuery = useDebounce(announcementQuery, 250);
    const [allAnnouncements, setAllAnnouncements] = useState<any[]>([]);
    const [announcementLoading, setAnnouncementLoading] = useState(false);
    const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
    const [stockDataLoaded, setStockDataLoaded] = useState(false);

    // ===== Web Search =====
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const tavilyKeySet = typeof window !== "undefined" && !!localStorage.getItem("tavily_key");

    // ===== Web Sources =====
    const [selectedWebSources, setSelectedWebSources] = useState<string[]>([]);
    const [availableWebSources, setAvailableWebSources] = useState<any[]>([]);

    // ===== Model Selection =====
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("cerebras/qwen-3-32b");
    const [modelQuery, setModelQuery] = useState("");
    const debouncedModelQuery = useDebounce(modelQuery, 200);
    const [showModelList, setShowModelList] = useState(false);
    const modelRef = useRef<HTMLDivElement>(null);

    const filteredModels = useMemo(() => {
        if (!debouncedModelQuery.trim()) return availableModels;
        const q = debouncedModelQuery.toLowerCase();
        return availableModels.filter(m => m.toLowerCase().includes(q));
    }, [availableModels, debouncedModelQuery]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
                setShowModelList(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const fetchAvailableSources = useCallback(async () => {
        try {
            const data = await AnalysisService.getAvailableSources();
            setAvailableSources(Array.isArray(data) ? data : []);
        } catch {
            setAvailableSources([]);
        }
    }, []);

    const fetchWebSources = useCallback(async () => {
        try {
            const data = await VoyagerService.getAvailableWebSources();
            setAvailableWebSources(data.sources || []);
        } catch {
            setAvailableWebSources([]);
        }
    }, []);

    const fetchModels = useCallback(async () => {
        try {
            const data = await AnalysisService.getAvailableModels();
            setAvailableModels(Array.isArray(data) ? data : []);
        } catch {
            setAvailableModels([]);
        }
    }, []);

    const loadAnnouncementsFromStockData = useCallback(async (symbol: string, source: string) => {
        if (!symbol) return;
        setAnnouncementLoading(true);
        try {
            const result = await VoyagerService.getStockData(symbol, source, ["announcements-equity"]);
            const sourceData = result?.data || result;
            if (typeof sourceData === "object") {
                const category = Object.entries(sourceData).find(
                    ([key]) => key.toLowerCase().includes("announ") || key.toLowerCase().includes("filing") || key.toLowerCase().includes("event")
                );
                if (category) {
                    const records = category[1] as any[];
                    setAllAnnouncements(Array.isArray(records) ? records : []);
                    setStockDataLoaded(true);
                } else {
                    setAllAnnouncements([]);
                    setStockDataLoaded(false);
                }
            }
        } catch {
            setAllAnnouncements([]);
            setStockDataLoaded(false);
        } finally {
            setAnnouncementLoading(false);
        }
    }, []);

    const filteredAnnouncements = useMemo(() => {
        if (!debouncedAnnouncementQuery.trim()) return allAnnouncements;
        const q = debouncedAnnouncementQuery.toLowerCase();
        return allAnnouncements.filter(r =>
            Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q))
        );
    }, [allAnnouncements, debouncedAnnouncementQuery]);

    const toggleDocument = useCallback((idx: number) => {
        setSelectedDocuments(prev => {
            const key = String(idx);
            return prev.includes(key) ? prev.filter(u => u !== key) : [...prev, key];
        });
    }, []);

    const handleConfigChange = useCallback((field: string, value: string, item?: any) => {
        const nameField = sourceKeys.nameField;
        setConfig(prev => ({
            ...prev,
            [field]: value || "",
            shareName: field === 'share' && item ? item[nameField] : prev.shareName
        }));
        if (field === 'share' && value) {
            setDataPullStatus("CHECKING");
            setLastPullDate(null);
            setSelectedDocuments([]);
            setAnnouncementQuery("");
            setAllAnnouncements([]);
            setStockDataLoaded(false);
            checkLastDataPull(config.source, value);
        }
    }, [sourceKeys, config.source]);

    const handleSourceChange = useCallback((value: string) => {
        setConfig(prev => ({
            ...prev,
            source: value,
            share: "",
            shareName: "",
        }));
        setDataPullStatus("IDLE");
        setLastPullDate(null);
        setSelectedDocuments([]);
        setAnnouncementQuery("");
        setAllAnnouncements([]);
        setStockDataLoaded(false);
        setSelectedWebSources([]);
    }, []);

    const checkLastDataPull = useCallback((source?: string, symbol?: string) => {
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
    }, [config.source, config.share, id]);

    const pullLatestData = useCallback(async () => {
        if (!config.source || !config.share) return;
        setDataPullStatus("PULLING");
        try {
            await VoyagerService.pullStockData(config.share, config.source);
            setLastPullDate(new Date().toISOString());
            setDataPullStatus("PULLED");
        } catch {
            setDataPullStatus("AVAILABLE");
        }
    }, [config.source, config.share]);

    const fetchAvailableProfiles = useCallback(async () => {
        try {
            const data = await ProfileService.listProfiles();
            if (Array.isArray(data)) {
                setAvailableProfiles(data);
            } else {
                setAvailableProfiles([]);
            }
        } catch {
            setAvailableProfiles([]);
        }
    }, []);

    const runAnalysis = async () => {
        if (!config.source || !config.share || !config.profile) return;

        try {
            setDataPullStatus("CHECKING");
            const dataStatus = await VoyagerService.getStockDataStatus(config.share, config.source);

            if (dataStatus && dataStatus.last_pull) {
                setLastPullDate(dataStatus.last_pull);
                setDataPullStatus("AVAILABLE");
            } else {
                setDataPullStatus("PULLING");
                await VoyagerService.pullStockData(config.share, config.source);
                setLastPullDate(new Date().toISOString());
                setDataPullStatus("PULLED");
            }

            const selectedUrls = selectedDocuments
                .map(idx => allAnnouncements[parseInt(idx)])
                .filter(Boolean)
                .map(r => r.attchmntFile || null)
                .filter(Boolean);

            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                profile_name: config.profile,
                model: selectedModel || undefined,
                documents: selectedUrls.length > 0 ? selectedUrls : undefined,
                web_search: webSearchEnabled || undefined,
                web_sources: selectedWebSources.length > 0 ? selectedWebSources : undefined,
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

    const fetchAnalysisData = useCallback(async (analysisId: string) => {
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

                const s = (data.status || "").toLowerCase();
                if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success") {
                    const isComplete = s === "complete" || s === "completed" || s === "success";
                    setStatus(isComplete ? "COMPLETED" : "ERROR");
                    setDataPullStatus("AVAILABLE");
                    if (data.duration) {
                        setAnalysisDuration(`${data.duration.toFixed(1)}s`);
                    }
                } else {
                    setStatus("PENDING");
                    setDataPullStatus("AVAILABLE");
                }

                if (data.documents) setSelectedDocuments(data.documents);
                if (data.web_search !== undefined) setWebSearchEnabled(data.web_search);
                if (data.web_sources) setSelectedWebSources(data.web_sources);
                if (data.model) setSelectedModel(data.model);
            }
        } catch {
            setStatus("ERROR");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAvailableSources();
        fetchAvailableProfiles();
        fetchWebSources();
        fetchModels();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id, fetchAvailableSources, fetchAvailableProfiles, fetchWebSources, fetchModels, fetchAnalysisData]);

    const pollRetriesRef = useRef(0);
    useEffect(() => {
        if (status === "PENDING" && correlationId) {
            pollRetriesRef.current = 0;
            const interval = setInterval(async () => {
                try {
                    const data = await AnalysisService.readAnalysis(correlationId);
                    if (data) {
                        const s = (data.status || "").toLowerCase();
                        if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success") {
                            const isComplete = s === "complete" || s === "completed" || s === "success";
                            setStatus(isComplete ? "COMPLETED" : "ERROR");
                            setDataPullStatus("AVAILABLE");
                            if (data.duration) {
                                setAnalysisDuration(`${data.duration.toFixed(1)}s`);
                            }
                            clearInterval(interval);
                            return;
                        }
                    }
                } catch {
                    // Continue polling on transient errors
                }
                pollRetriesRef.current += 1;
                if (pollRetriesRef.current >= MAX_POLL_RETRIES) {
                    clearInterval(interval);
                    setStatus("ERROR");
                    setDataPullStatus("AVAILABLE");
                }
            }, 2000);
            return () => {
                clearInterval(interval);
                pollRetriesRef.current = 0;
            };
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
    const webSearchValid = webSearchEnabled && tavilyKeySet;
    const hasDataSource = selectedDocuments.length > 0 || webSearchValid || selectedWebSources.length > 0;
    const canRunAnalysis = isConfigComplete && (dataPullStatus === "AVAILABLE" || dataPullStatus === "PULLED") && hasDataSource;

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
                <Box flex="1" width="full" minW={0} overflow="hidden">
                    {/* Basic Config */}
                    <Box
                        bg="bg.subtle"
                        border="1px solid"
                        borderColor="border"
                        rounded="md"
                        p={8}
                        mb={6}
                    >
                        <Flex direction={"column"} gap={6}>
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

                            <Flex direction={"column"} align={"start"}>
                                <Text mb={2} fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Model</Text>
                                <Box width="full" position="relative" ref={modelRef}>
                                    <Input
                                        placeholder="Search model (e.g., qwen, gpt, claude)..."
                                        value={showModelList ? modelQuery : selectedModel}
                                        onChange={(e) => {
                                            setModelQuery(e.target.value);
                                            setShowModelList(true);
                                        }}
                                        onFocus={() => {
                                            setModelQuery(selectedModel);
                                            setShowModelList(true);
                                        }}
                                        size="sm"
                                        variant="subtle"
                                    />
                                    {showModelList && (
                                        <Box
                                            position="absolute"
                                            top="100%"
                                            left={0}
                                            right={0}
                                            zIndex={10}
                                            mt={1}
                                            maxH="200px"
                                            overflowY="auto"
                                            border="1px solid"
                                            borderColor="border"
                                            rounded="sm"
                                            bg="bg"
                                            boxShadow="md"
                                        >
                                            {filteredModels.length > 0 ? (
                                                filteredModels.map(m => (
                                                    <Flex
                                                        key={m}
                                                        p={2}
                                                        fontSize="xs"
                                                        cursor="pointer"
                                                        _hover={{ bg: "bg.muted" }}
                                                        onClick={() => {
                                                            setSelectedModel(m);
                                                            setModelQuery("");
                                                            setShowModelList(false);
                                                        }}
                                                    >
                                                        {m}
                                                    </Flex>
                                                ))
                                            ) : (
                                                <Text p={2} fontSize="xs" color="fg.muted">No models found</Text>
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            </Flex>
                        </Flex>
                    </Box>

                    {/* Data Inputs */}
                    {config.share && (
                        <Box
                            bg="bg.subtle"
                            border="1px solid"
                            borderColor="border"
                            rounded="md"
                            p={8}
                        >
                            <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={5}>
                                Data Inputs for LLM
                            </Text>

                            <VStack gap={6} align="stretch">
                                {/* 1. Documents from Announcements */}
                                <Box>
                                    <Flex align="center" gap={1} mb={2}>
                                        <MdDescription size={14} color="fg.muted" />
                                        <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                                            Documents from Announcements
                                        </Text>
                                        <Tooltip content="Search and select specific announcement documents to include in the analysis.">
                                            <Box cursor="help">
                                                <MdInfoOutline size={12} color="fg.muted" />
                                            </Box>
                                        </Tooltip>
                                    </Flex>
                                    <HStack gap={2} mb={2}>
                                        <Button
                                            size="xs"
                                            variant="outline"
                                            onClick={() => loadAnnouncementsFromStockData(config.share, config.source)}
                                            loading={announcementLoading}
                                            loadingText="Loading..."
                                        >
                                            <MdOutlineStorage size={12} />
                                            {stockDataLoaded ? "Reload Announcements" : "Load Announcements"}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            onClick={pullLatestData}
                                            loading={dataPullStatus === "PULLING"}
                                            loadingText="Pulling..."
                                        >
                                            <MdOutlineRefresh size={12} />
                                            Pull Latest
                                        </Button>
                                    </HStack>
                                    {announcementLoading ? (
                                        <HStack gap={2} py={2}>
                                            <Spinner size="xs" />
                                            <Text fontSize="xs" color="fg.muted">Loading announcements...</Text>
                                        </HStack>
                                    ) : stockDataLoaded ? (
                                        <>
                                            <Input
                                                placeholder="Search announcements (e.g., earnings, 10-K, 8-K)..."
                                                value={announcementQuery}
                                                onChange={(e) => setAnnouncementQuery(e.target.value)}
                                                size="sm"
                                                variant="subtle"
                                                mb={2}
                                            />
                                            {filteredAnnouncements.length > 0 ? (
                                                <Box
                                                    maxH="240px"
                                                    overflowY="auto"
                                                    overflowX="hidden"
                                                    border="1px solid"
                                                    borderColor="border"
                                                    rounded="sm"
                                                >
                                                    <DocumentList
                                                        documents={filteredAnnouncements}
                                                        allDocs={allAnnouncements}
                                                        selectedDocuments={selectedDocuments}
                                                        onToggle={toggleDocument}
                                                    />
                                                </Box>
                                            ) : (
                                                <Text fontSize="xs" color="fg.muted" py={1}>
                                                    {announcementQuery.trim() ? "No matching announcements" : "No announcements found in stock data"}
                                                </Text>
                                            )}
                                        </>
                                    ) : (
                                        <Text fontSize="xs" color="fg.muted" py={1}>
                                            Click "Load Announcements" to fetch documents for this stock
                                        </Text>
                                    )}

                                    {selectedDocuments.length > 0 && (
                                        <Text fontSize="xs" color="blue.400" mt={1}>
                                            {selectedDocuments.length} document{selectedDocuments.length > 1 ? "s" : ""} selected
                                        </Text>
                                    )}
                                </Box>

                                <Separator borderColor="border" />

                                {/* 2. Web Search */}
                                <Box>
                                    <Flex align="center" gap={1} mb={2}>
                                        <MdWeb size={14} color="fg.muted" />
                                        <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                                            Web Search
                                        </Text>
                                        <Tooltip content="Enable live web search for recent news and data about the company.">
                                            <Box cursor="help">
                                                <MdInfoOutline size={12} color="fg.muted" />
                                            </Box>
                                        </Tooltip>
                                    </Flex>
                                    <Flex
                                        p={3}
                                        border="1px solid"
                                        borderColor="border"
                                        rounded="sm"
                                        align="center"
                                        justify="space-between"
                                        cursor="pointer"
                                        onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                                        _hover={{ bg: "bg.muted" }}
                                    >
                                        <Text fontSize="sm">Enable web search for recent data</Text>
                                        <Box
                                            w="36px"
                                            h="20px"
                                            rounded="full"
                                            bg={webSearchEnabled ? "blue.500" : "gray.500"}
                                            position="relative"
                                            transition="background 0.2s"
                                        >
                                            <Box
                                                w="16px"
                                                h="16px"
                                                rounded="full"
                                                bg="white"
                                                position="absolute"
                                                top="2px"
                                                transition="left 0.2s"
                                                left={webSearchEnabled ? "18px" : "2px"}
                                            />
                                        </Box>
                                    </Flex>
                                    {!tavilyKeySet && (
                                        <Flex
                                            mt={2}
                                            p={3}
                                            bg="orange.50"
                                            border="1px solid"
                                            borderColor="orange.200"
                                            rounded="sm"
                                            gap={2}
                                            align="center"
                                            _dark={{ bg: "orange.900/20", borderColor: "orange.700" }}
                                        >
                                            <Box color="orange.500">
                                                <MdWarning size={16} />
                                            </Box>
                                            <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.300" }} flex={1}>
                                                Tavily API key required for web search
                                            </Text>
                                            <Link to="/settings">
                                                <Button size="xs" variant="outline" colorPalette="orange">
                                                    Set Key
                                                </Button>
                                            </Link>
                                        </Flex>
                                    )}
                                </Box>

                                <Separator borderColor="border" />

                                {/* 3. Web Sources */}
                                <Box>
                                    <Flex align="center" gap={1} mb={2}>
                                        <MdWeb size={14} color="fg.muted" />
                                        <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                                            Web Data Sources
                                        </Text>
                                        <Tooltip content="Select specific websites to fetch stock data from.">
                                            <Box cursor="help">
                                                <MdInfoOutline size={12} color="fg.muted" />
                                            </Box>
                                        </Tooltip>
                                    </Flex>
                                    {availableWebSources.length > 0 ? (
                                        <Box
                                            maxH="180px"
                                            overflowY="auto"
                                            border="1px solid"
                                            borderColor="border"
                                            rounded="sm"
                                            p={1}
                                        >
                                            <VStack gap={0} align="stretch">
                                                {availableWebSources.map((ws: any) => (
                                                    <Flex
                                                        key={ws.id}
                                                        p={2}
                                                        _hover={{ bg: "bg.muted" }}
                                                        rounded="sm"
                                                        cursor="pointer"
                                                        align="center"
                                                        gap={2}
                                                        onClick={() => {
                                                            setSelectedWebSources(prev =>
                                                                prev.includes(ws.id)
                                                                    ? prev.filter(s => s !== ws.id)
                                                                    : [...prev, ws.id]
                                                            );
                                                        }}
                                                    >
                                                        <Checkbox.Root
                                                            checked={selectedWebSources.includes(ws.id)}
                                                            onCheckedChange={() => {
                                                                setSelectedWebSources(prev =>
                                                                    prev.includes(ws.id)
                                                                        ? prev.filter(s => s !== ws.id)
                                                                        : [...prev, ws.id]
                                                                );
                                                            }}
                                                        >
                                                            <Checkbox.HiddenInput />
                                                            <Checkbox.Control />
                                                        </Checkbox.Root>
                                                        <Box flex={1}>
                                                            <Text fontSize="sm">{ws.name}</Text>
                                                            {ws.type && (
                                                                <Text fontSize="xs" color="fg.muted">{ws.type}</Text>
                                                            )}
                                                        </Box>
                                                    </Flex>
                                                ))}
                                            </VStack>
                                        </Box>
                                    ) : (
                                        <Text fontSize="xs" color="fg.muted" py={1}>
                                            No web sources available
                                        </Text>
                                    )}
                                    {selectedWebSources.length > 0 && (
                                        <Text fontSize="xs" color="blue.400" mt={1}>
                                            {selectedWebSources.length} source{selectedWebSources.length > 1 ? "s" : ""} selected
                                        </Text>
                                    )}
                                </Box>
                            </VStack>
                        </Box>
                    )}

                    {/* Warning: No data source */}
                    {isConfigComplete && config.share && !hasDataSource && (
                        <Flex
                            mt={4}
                            p={4}
                            bg="orange.50"
                            border="1px solid"
                            borderColor="orange.200"
                            rounded="md"
                            gap={3}
                            align="start"
                            _dark={{ bg: "orange.900/20", borderColor: "orange.700" }}
                        >
                            <Box color="orange.500" mt={0.5}>
                                <MdWarning size={18} />
                            </Box>
                            <Box>
                                <Text fontSize="sm" fontWeight="medium" color="orange.800" _dark={{ color: "orange.200" }}>
                                    No data source selected
                                </Text>
                                <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.300" }} mt={1}>
                                    Select at least one: announcement documents, enable web search, or pick web data sources.
                                    Without any data, the LLM will have nothing to analyze.
                                </Text>
                            </Box>
                        </Flex>
                    )}
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
                                            {config.share ? "Check data status before running" : "Select a company to check"}
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

                            {/* Data Inputs Status */}
                            {config.share && (
                                <Box>
                                    <HStack gap={2} mb={2}>
                                        <MdInfoOutline size={16} color="fg.muted" />
                                        <Text fontSize="sm" fontWeight="medium">LLM Data Sources</Text>
                                    </HStack>
                                    <Box ml={6}>
                                        <VStack gap={1} align="stretch">
                                            <HStack gap={2}>
                                                <Box
                                                    w="8px" h="8px" rounded="full"
                                                    bg={selectedDocuments.length > 0 ? "green.400" : "gray.500"}
                                                />
                                                <Text fontSize="xs" color="fg.muted">
                                                    Documents: {selectedDocuments.length > 0 ? `${selectedDocuments.length} selected` : "none"}
                                                </Text>
                                            </HStack>
                                            <HStack gap={2}>
                                                <Box
                                                    w="8px" h="8px" rounded="full"
                                                    bg={webSearchEnabled ? "green.400" : "gray.500"}
                                                />
                                                <Text fontSize="xs" color="fg.muted">
                                                    Web Search: {webSearchEnabled ? "enabled" : "disabled"}
                                                </Text>
                                            </HStack>
                                            <HStack gap={2}>
                                                <Box
                                                    w="8px" h="8px" rounded="full"
                                                    bg={selectedWebSources.length > 0 ? "green.400" : "gray.500"}
                                                />
                                                <Text fontSize="xs" color="fg.muted">
                                                    Web Sources: {selectedWebSources.length > 0 ? `${selectedWebSources.length} selected` : "none"}
                                                </Text>
                                            </HStack>
                                        </VStack>
                                    </Box>
                                </Box>
                            )}

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
                                    ) : !hasDataSource ? (
                                        <Text fontSize="xs" color="fg.subtle">
                                            Select at least one data source below
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
                                        <VStack gap={2} align="stretch">
                                            <Text fontSize="xs" color="red.400">Analysis encountered an error</Text>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                colorPalette="red"
                                                rounded="sm"
                                                fontSize="xs"
                                                onClick={() => {
                                                    setStatus("EMPTY");
                                                    setDataPullStatus("AVAILABLE");
                                                }}
                                            >
                                                Try Again
                                            </Button>
                                        </VStack>
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
            ) : !id && !config.share && (
                <Flex justify={"center"} align={"center"} color={"grey"}>
                    <Box as="ul" fontSize="sm" lineHeight="2">
                        <Box as="li">Step 1: Select a market source (SEC or NSE).</Box>
                        <Box as="li">Step 2: Search and select the target company.</Box>
                        <Box as="li">Step 3: Choose an investor profile.</Box>
                        <Box as="li">Step 4: Select data inputs (documents, web search, web sources).</Box>
                        <Box as="li">Check data status, pull latest data if needed, then run the analysis.</Box>
                    </Box>
                </Flex>
            )}
        </Flex>
    )
}
