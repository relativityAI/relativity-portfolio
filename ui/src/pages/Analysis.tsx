import SearchBar from "@/components/SearchBar";
import {
    Button, Flex, Text, Separator, Spinner, Box, Select, Input,
    createListCollection, Portal, HStack, VStack
} from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef, Fragment } from "react";
import { MdInfoOutline, MdCheck, MdClose } from "react-icons/md";
import { Link, useParams } from "react-router-dom";
import { AnalysisService, ProfileService, API_BASE } from "@/db";
import { Tooltip } from "@/components/ui/tooltip";

const MAX_POLL_RETRIES = 600;

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

function StatusDot({ state }: { state: "idle" | "active" | "done" | "error" }) {
    if (state === "active") {
        return <Spinner size="xs" borderWidth="2px" color="var(--ink-secondary)" />;
    }
    if (state === "error") {
        return (
            <Box
                w="6px"
                h="6px"
                borderRadius="50%"
                bg="var(--signal-negative)"
                flexShrink={0}
            />
        );
    }
    return (
        <Box
            w="6px"
            h="6px"
            borderRadius="1px"
            bg={state === "done" ? "var(--ink-primary)" : "transparent"}
            border={state === "done" ? "none" : "1px solid var(--hairline)"}
            flexShrink={0}
        />
    );
}

type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface RunStep {
    key: string;
    label: string;
    status: StepStatus;
    started_at: string | null;
    finished_at: string | null;
    duration_ms: number | null;
    detail?: string;
}

function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

function formatMs(ms: number | null | undefined): string {
    if (ms == null) return "";
    return formatSeconds(Math.round(ms / 1000));
}

function StepIcon({ status }: { status: StepStatus }) {
    if (status === "running") {
        return <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />;
    }
    if (status === "completed") {
        return (
            <Flex
                w="16px"
                h="16px"
                borderRadius="50%"
                align="center"
                justify="center"
                bg="var(--signal-positive)"
                flexShrink={0}
            >
                <MdCheck size={11} color="#fff" />
            </Flex>
        );
    }
    if (status === "failed") {
        return (
            <Flex
                w="16px"
                h="16px"
                borderRadius="50%"
                align="center"
                justify="center"
                bg="var(--signal-negative)"
                flexShrink={0}
            >
                <MdClose size={11} color="#fff" />
            </Flex>
        );
    }
    return (
        <Flex
            w="16px"
            h="16px"
            borderRadius="50%"
            align="center"
            justify="center"
            border={status === "skipped" ? "1px solid var(--hairline)" : "2px solid var(--hairline)"}
            flexShrink={0}
            opacity={status === "pending" ? 1 : 0.6}
        >
            {status === "skipped" && <Box w="6px" h="1.5px" bg="var(--ink-tertiary)" />}
        </Flex>
    );
}

function StepRow({ step, now }: { step: RunStep; now: number }) {
    const elapsedMs =
        step.status === "running" && step.started_at
            ? now - +new Date(step.started_at)
            : step.duration_ms;
    const timeLabel =
        step.status === "running" || step.status === "completed" || step.status === "failed"
            ? formatMs(elapsedMs)
            : "";

    const labelColor =
        step.status === "running"
            ? "var(--ink-primary)"
            : step.status === "completed" || step.status === "skipped"
                ? "var(--ink-secondary)"
                : step.status === "failed"
                    ? "var(--signal-negative)"
                    : "var(--ink-tertiary)";

    return (
        <Flex gap={2.5} align="flex-start">
            <Box mt="1px">
                <StepIcon status={step.status} />
            </Box>
            <Flex direction="column" gap={0.5} flex={1} minW={0}>
                <HStack gap={2} justify="space-between" align="baseline">
                    <Text fontSize="12.5px" fontWeight={500} color={labelColor} lineHeight="short">
                        {step.label}
                    </Text>
                    {timeLabel && (
                        <Text
                            fontSize="11px"
                            fontFamily="var(--font-tabular)"
                            fontVariantNumeric="tabular-nums"
                            color={step.status === "running" ? "var(--ink-secondary)" : "var(--ink-tertiary)"}
                            whiteSpace="nowrap"
                        >
                            {step.status === "running" ? `${timeLabel} …` : timeLabel}
                        </Text>
                    )}
                </HStack>
                {step.detail && (
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" lineHeight="short">
                        {step.detail}
                    </Text>
                )}
                {step.status === "pending" && !step.detail && (
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" lineHeight="short">
                        Queued
                    </Text>
                )}
            </Flex>
        </Flex>
    );
}

function AnalysisSteps({ steps, now }: { steps: RunStep[]; now: number }) {
    if (!steps || steps.length === 0) {
        return (
            <HStack gap={1.5}>
                <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                <Text fontSize="12px" color="var(--ink-secondary)">
                    Running analysis…
                </Text>
            </HStack>
        );
    }
    return (
        <VStack gap={3.5} align="stretch">
            {steps.map((s) => (
                <StepRow key={s.key} step={s} now={now} />
            ))}
        </VStack>
    );
}

function AnalysisHero() {
    return (
        <Flex direction="column" gap={1}>
            <Text
                fontSize="10.5px"
                fontWeight={500}
                color="var(--ink-tertiary)"
                textTransform="uppercase"
                letterSpacing="0.06em"
            >
                Stock Analysis
            </Text>
            <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                New Analysis
            </Text>
            <Text fontSize="13px" color="var(--ink-secondary)">
                Configure and run a new stock analysis.
            </Text>
        </Flex>
    );
}

function AnalysisStepper({ sourceComplete, companyComplete, profileComplete }: {
    sourceComplete: boolean;
    companyComplete: boolean;
    profileComplete: boolean;
}) {
    const steps = [
        { label: "Source", done: sourceComplete },
        { label: "Company", done: companyComplete },
        { label: "Profile", done: profileComplete },
    ];
    return (
        <Flex align="center" gap={0}>
            {steps.map((step, i) => (
                <Fragment key={step.label}>
                    <Flex direction="column" align="center" gap={1.5} flex={i > 0 && i < steps.length - 1 ? 0 : undefined}>
                        <StatusDot state={step.done ? "done" : "idle"} />
                        <Text
                            fontSize="12px"
                            color={step.done ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                            fontWeight={step.done ? 500 : 400}
                        >
                            {step.label}
                        </Text>
                    </Flex>
                    {i < steps.length - 1 && (
                        <Box flex={1} h="1px" bg="var(--hairline)" mb={4} />
                    )}
                </Fragment>
            ))}
        </Flex>
    );
}

function AnalysisGettingStarted() {
    const cards = [
        { num: "01", title: "Select a market source", desc: "Choose between SEC (US Market) or NSE (Indian Market)." },
        { num: "02", title: "Search and select a company", desc: "Find and pick the target company for analysis." },
        { num: "03", title: "Choose an investor profile", desc: "Pick a predefined portfolio strategy to guide the LLM." },
        { num: "04", title: "Pick a model & run", desc: "Choose the LLM that runs the analysis, then start the run. Data is fetched automatically." },
    ];
    return (
        <Flex direction={{ base: "column", sm: "row" }} gap={4} wrap="wrap">
            {cards.map(card => (
                <Flex
                    key={card.num}
                    direction="column"
                    gap={2}
                    p={5}
                    bg="var(--surface-panel)"
                    border="1px solid var(--hairline)"
                    borderRadius="2px"
                    flex="1"
                    minW="180px"
                >
                    <Text
                        fontSize="11px"
                        fontWeight={500}
                        color="var(--ink-tertiary)"
                        fontFamily="var(--font-mono)"
                        letterSpacing="0.06em"
                    >
                        {card.num}
                    </Text>
                    <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)">
                        {card.title}
                    </Text>
                    <Text fontSize="12px" color="var(--ink-secondary)" lineHeight="relaxed">
                        {card.desc}
                    </Text>
                </Flex>
            ))}
        </Flex>
    );
}

export default function Analysis() {
    const { id } = useParams();

    const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    useEffect(() => {
        if (status === "PENDING") {
            const start = Date.now();
            setElapsedTime(0);
            const interval = setInterval(() => {
                setElapsedTime(Math.floor((Date.now() - start) / 1000));
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [status]);

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

    const profileOptions = useMemo(() => {
        const items = availableProfiles.map((p: any) => ({ label: p.name, value: p.name }));
        return createListCollection({
            items,
            itemToString: (item: any) => item.label,
            itemToValue: (item: any) => item.value,
        });
    }, [availableProfiles]);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("gemini/gemini-flash-lite-latest");
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

    const fetchModels = useCallback(async () => {
        try {
            const data = await AnalysisService.getAvailableModels();
            setAvailableModels(Array.isArray(data) ? data : []);
        } catch {
            setAvailableModels([]);
        }
    }, []);

    const handleConfigChange = useCallback((field: string, value: string, item?: any) => {
        const nameField = sourceKeys.nameField;
        setConfig(prev => ({
            ...prev,
            [field]: value || "",
            shareName: field === 'share' && item ? item[nameField] : prev.shareName
        }));
    }, [sourceKeys]);

    const handleSourceChange = useCallback((value: string) => {
        setConfig(prev => ({
            ...prev,
            source: value,
            share: "",
            shareName: "",
        }));
    }, []);

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
            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                profile_name: config.profile,
                model: selectedModel || undefined,
            });

            if (result && (result.corr_id || result.analysis_id)) {
                setSteps([]);
                setCorrelationId(result.corr_id || result.analysis_id);
                setStatus("PENDING");
            }
        } catch (error) {
            console.error("Run analysis error:", error);
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

                if (Array.isArray(data.steps)) setSteps(data.steps);

                const s = (data.status || "").toLowerCase();
                if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success") {
                    const isComplete = s === "complete" || s === "completed" || s === "success";
                    setStatus(isComplete ? "COMPLETED" : "ERROR");
                    if (data.duration != null) {
                        const d = data.duration;
                        setAnalysisDuration(d >= 60 ? `${Math.floor(d / 60)}m ${Math.floor(d % 60)}s` : `${d.toFixed(1)}s`);
                    }
                } else {
                    setStatus("PENDING");
                }

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
        fetchModels();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id, fetchAvailableSources, fetchAvailableProfiles, fetchModels, fetchAnalysisData]);

    const pollRetriesRef = useRef(0);
    useEffect(() => {
        if (status === "PENDING" && correlationId) {
            pollRetriesRef.current = 0;
            const interval = setInterval(async () => {
                try {
                    const data = await AnalysisService.readAnalysis(correlationId);
                    if (data) {
                        if (Array.isArray(data.steps)) setSteps(data.steps);
                        const s = (data.status || "").toLowerCase();
                        if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success") {
                            const isComplete = s === "complete" || s === "completed" || s === "success";
                            setStatus(isComplete ? "COMPLETED" : "ERROR");
                            if (data.duration != null) {
                                const d = data.duration;
                                setAnalysisDuration(d >= 60 ? `${Math.floor(d / 60)}m ${Math.floor(d % 60)}s` : `${d.toFixed(1)}s`);
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
                }
            }, 2000);
            return () => {
                clearInterval(interval);
                pollRetriesRef.current = 0;
            };
        }
    }, [status, correlationId]);

    const searchParams = useMemo(() => ({ source: config.source }), [config.source]);
    const isConfigComplete = config.share !== "" && config.profile !== "";
    const canRunAnalysis = isConfigComplete;

    return (
        <Flex direction="column" gap={8} py={4} bg="var(--surface-canvas)" minH="100vh" px={6}>
            <AnalysisHero />

            <AnalysisStepper
                sourceComplete={!!config.source}
                companyComplete={!!config.share}
                profileComplete={!!config.profile}
            />

            <Flex direction={{ base: "column", md: "row" }} gap={8} align="start" mb={4}>
                {/* Left: Configuration */}
                <Box flex="1" width="full" minW={0}>
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={8}
                        mb={6}
                    >
                        <Flex direction="column" gap={6}>
                            <Flex direction="column" align="start">
                                <Flex align="center" gap={1} mb={2}>
                                    <Text
                                        fontSize="10.5px"
                                        fontWeight={500}
                                        color="var(--ink-tertiary)"
                                        textTransform="uppercase"
                                        letterSpacing="0.06em"
                                    >
                                        Select Source
                                    </Text>
                                    <Tooltip content="Choose the market data source for the company to analyze.">
                                        <Box cursor="help">
                                            <MdInfoOutline size={14} color="var(--ink-tertiary)" />
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
                                            <Select.Trigger borderColor="var(--hairline)">
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

                            <Flex direction="column" align="start">
                                <Text
                                    mb={2}
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    textTransform="uppercase"
                                    letterSpacing="0.06em"
                                >
                                    Target Company
                                </Text>
                                <SearchBar
                                    url={`${API_BASE}/stocks/search`}
                                    mainKey={sourceKeys.mainKey}
                                    secondaryKey={sourceKeys.secondaryKey}
                                    onChange={handleConfigChange}
                                    field="share"
                                    params={searchParams}
                                    placeholder={config.source === "SEC" ? "Search US stocks (e.g., AAPL)" : "Search Indian stocks (e.g., RELIANCE)"}
                                />
                            </Flex>

                            <Flex direction="column" align="start">
                                <Text
                                    mb={2}
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    textTransform="uppercase"
                                    letterSpacing="0.06em"
                                >
                                    Portfolio Profile
                                </Text>
                                <Box width="full">
                                    <Select.Root
                                        collection={profileOptions}
                                        value={config.profile ? [config.profile] : []}
                                        onValueChange={(e) => {
                                            setConfig({ ...config, profile: e.value[0] });
                                        }}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control>
                                            <Select.Trigger borderColor="var(--hairline)">
                                                <Select.ValueText placeholder="Select Portfolio Strategy" />
                                            </Select.Trigger>
                                            <Select.IndicatorGroup>
                                                <Select.Indicator />
                                            </Select.IndicatorGroup>
                                        </Select.Control>
                                        <Portal>
                                            <Select.Positioner>
                                                <Select.Content>
                                                    {profileOptions.items.map((item: any) => (
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

                            <Flex direction="column" align="start">
                                <Text
                                    mb={2}
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    textTransform="uppercase"
                                    letterSpacing="0.06em"
                                >
                                    Model
                                </Text>
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
                                        borderColor="var(--hairline)"
                                        borderRadius="2px"
                                        _focus={{ borderColor: "var(--accent-primary)" }}
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
                                            border="1px solid var(--hairline)"
                                            borderRadius="2px"
                                            bg="var(--surface-panel)"
                                        >
                                            {filteredModels.length > 0 ? (
                                                filteredModels.map(m => (
                                                    <Flex
                                                        key={m}
                                                        p={2}
                                                        fontSize="12px"
                                                        cursor="pointer"
                                                        _hover={{ bg: "var(--surface-recessed)" }}
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
                                                <Text p={2} fontSize="12px" color="var(--ink-tertiary)">
                                                    No models found
                                                </Text>
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            </Flex>
                        </Flex>
                    </Box>
                </Box>

                {/* Right: Analysis Status */}
                <Box width={{ base: "full", md: "380px" }} flexShrink={0}>
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={5}
                        >
                            Analysis Status
                        </Text>

                        <VStack gap={5} align="stretch">
                            {/* Overall run state */}
                            {status === "PENDING" ? (
                                <HStack gap={2}>
                                    <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                                    <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">
                                        Analysis in progress
                                    </Text>
                                    {elapsedTime > 0 && (
                                        <Text
                                            fontSize="12px"
                                            color="var(--ink-tertiary)"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                        >
                                            {formatSeconds(elapsedTime)}
                                        </Text>
                                    )}
                                </HStack>
                            ) : status === "COMPLETED" ? (
                                <HStack gap={2}>
                                    <MdCheck size={15} color="var(--signal-positive)" />
                                    <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">
                                        Analysis complete
                                    </Text>
                                    {analysisDuration && (
                                        <Text
                                            fontSize="12px"
                                            color="var(--ink-tertiary)"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                        >
                                            {analysisDuration}
                                        </Text>
                                    )}
                                </HStack>
                            ) : status === "ERROR" ? (
                                <HStack gap={2}>
                                    <MdClose size={15} color="var(--signal-negative)" />
                                    <Text fontSize="13px" fontWeight={600} color="var(--signal-negative)">
                                        Analysis failed
                                    </Text>
                                </HStack>
                            ) : status === "EMPTY" && id ? (
                                <HStack gap={2}>
                                    <Spinner size="xs" borderWidth="2px" color="var(--ink-secondary)" />
                                    <Text fontSize="12px" color="var(--ink-secondary)">
                                        Resuming analysis…
                                    </Text>
                                </HStack>
                            ) : null}

                            {/* Step checklist */}
                            {status !== "EMPTY" && steps.length > 0 && (
                                <Box
                                    borderTop="1px solid var(--hairline)"
                                    borderBottom="1px solid var(--hairline)"
                                    py={4}
                                >
                                    <AnalysisSteps steps={steps} now={Date.now()} />
                                </Box>
                            )}

                            {/* Idle: start button */}
                            {status === "EMPTY" && !id && (
                                <>
                                    {!isConfigComplete && (
                                        <Text fontSize="12px" color="var(--ink-tertiary)">
                                            Complete configuration to run analysis
                                        </Text>
                                    )}
                                    <Button
                                        size="sm"
                                        bg="var(--accent-primary)"
                                        color="#fff"
                                        fontWeight={500}
                                        fontSize="13px"
                                        px={5}
                                        _hover={{ opacity: 0.9 }}
                                        borderRadius="3px"
                                        onClick={runAnalysis}
                                        disabled={!canRunAnalysis}
                                        loading={status === "PENDING"}
                                        loadingText="Running…"
                                    >
                                        Start Analysis
                                    </Button>
                                </>
                            )}

                            {/* Completed actions */}
                            {status === "COMPLETED" && correlationId && (
                                <HStack gap={2}>
                                    <Link to={`/analysis-result/${correlationId}`}>
                                        <Button
                                            size="sm"
                                            bg="var(--accent-primary)"
                                            color="#fff"
                                            fontWeight={500}
                                            fontSize="13px"
                                            px={4}
                                            _hover={{ opacity: 0.9 }}
                                            borderRadius="3px"
                                        >
                                            View Report
                                        </Button>
                                    </Link>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        color="var(--ink-secondary)"
                                        _hover={{ color: "var(--ink-primary)" }}
                                        fontWeight={500}
                                        fontSize="13px"
                                        onClick={() => {
                                            setStatus("EMPTY");
                                            setSteps([]);
                                        }}
                                    >
                                        Run Again
                                    </Button>
                                </HStack>
                            )}

                            {/* Error actions */}
                            {status === "ERROR" && (
                                <VStack gap={2} align="stretch">
                                    <Text fontSize="12px" color="var(--signal-negative)">
                                        Analysis encountered an error.
                                    </Text>
                                    <HStack gap={2}>
                                        {correlationId && (
                                            <Link to={`/analysis-result/${correlationId}`}>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    color="var(--ink-secondary)"
                                                    _hover={{ color: "var(--ink-primary)" }}
                                                    fontWeight={500}
                                                    fontSize="13px"
                                                >
                                                    View Report
                                                </Button>
                                            </Link>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            color="var(--signal-negative)"
                                            borderColor="var(--signal-negative)"
                                            _hover={{ bg: "var(--signal-negative)", color: "#fff" }}
                                            fontWeight={500}
                                            fontSize="13px"
                                            borderRadius="3px"
                                            onClick={() => {
                                                setStatus("EMPTY");
                                                setSteps([]);
                                            }}
                                        >
                                            Try Again
                                        </Button>
                                    </HStack>
                                </VStack>
                            )}
                        </VStack>
                    </Box>
                </Box>
            </Flex>

            <Separator borderColor="var(--hairline)" />

            {loading ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Spinner size="lg" borderWidth="2px" color="var(--ink-secondary)" />
                    <Text fontSize="13px" color="var(--ink-secondary)">Loading analysis data…</Text>
                </Flex>
            ) : status === "COMPLETED" && correlationId ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Text fontSize="13px" color="var(--ink-tertiary)">
                        You can find all your previous analyses in the list view.
                    </Text>
                </Flex>
            ) : !id && !config.share && <AnalysisGettingStarted />}
        </Flex>
    )
}
