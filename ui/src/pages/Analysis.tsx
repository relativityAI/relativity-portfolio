import SearchBar from "@/components/SearchBar";
import {
    Button, Flex, Text, Separator, Spinner, Box, Select, Input,
    createListCollection, Portal, HStack, VStack
} from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef, Fragment } from "react";
import { MdInfoOutline, MdCheck, MdClose } from "react-icons/md";
import { Link, useParams } from "react-router-dom";
import { AnalysisService, AgentService, DataService, SettingsService, API_BASE } from "@/db";
import { Tooltip } from "@/components/ui/tooltip";
import { formatSeconds } from "@/utils";
import { RunSteps, type RunStep } from "./shared/RunStatus";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";

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
                as={motion.div}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
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
            as={motion.div}
            animate={{ scale: state === "done" ? 1 : 1, backgroundColor: state === "done" ? "var(--ink-primary)" : "transparent" }}
            transition={{ duration: dur.fast, ease }}
            w="6px"
            h="6px"
            borderRadius="1px"
            bg={state === "done" ? "var(--ink-primary)" : "transparent"}
            border={state === "done" ? "none" : "1px solid var(--hairline)"}
            flexShrink={0}
        />
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

function AnalysisStepper({ sourceComplete, companyComplete, agentComplete }: {
    sourceComplete: boolean;
    companyComplete: boolean;
    agentComplete: boolean;
}) {
    const steps = [
        { label: "Source", done: sourceComplete },
        { label: "Company", done: companyComplete },
        { label: "Agent", done: agentComplete },
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
                        <Box
                            as={motion.div}
                            flex={1}
                            h="1px"
                            mb={4}
                            initial={false}
                            animate={{ backgroundColor: step.done ? "var(--accent-primary)" : "var(--hairline)" }}
                            transition={{ duration: dur.base, ease }}
                        />
                    )}
                </Fragment>
            ))}
        </Flex>
    );
}

function AnalysisGettingStarted() {
    const steps = [
        { num: "01", title: "Select a market source", desc: "Choose between SEC (US Market) or NSE (Indian Market)." },
        { num: "02", title: "Search and select a company", desc: "Find and pick the target company for analysis." },
        { num: "03", title: "Choose an agent", desc: "Pick an agent to guide the LLM." },
        { num: "04", title: "Pick a model & run", desc: "Choose the LLM that runs the analysis, then start the run. Data is fetched automatically." },
    ];
    return (
        <Flex direction="column" gap={2} align="start">
            <Text
                fontSize="10.5px"
                fontWeight={500}
                color="var(--ink-tertiary)"
                letterSpacing="0.06em"
                textTransform="uppercase"
            >
                How it works
            </Text>
            <Flex align="center" gap={1.5} wrap="wrap" as={motion.div} variants={stagger} initial="initial" animate="animate">
                {steps.map((s, i) => (
                    <Fragment key={s.num}>
                        <Flex
                            as={motion.div}
                            variants={staggerItem}
                            whileHover={{ y: -2 }}
                            transition={{ duration: dur.fast, ease }}
                            align="center"
                            gap={1.5}
                            px={2.5}
                            py={1}
                            bg="var(--surface-recessed)"
                            border="1px solid var(--hairline)"
                            borderRadius="2px"
                            cursor="help"
                            title={`${s.num} · ${s.title} — ${s.desc}`}
                        >
                            <Text
                                fontSize="10.5px"
                                fontFamily="var(--font-mono)"
                                fontWeight={500}
                                color="var(--accent-primary)"
                            >
                                {s.num}
                            </Text>
                            <Text fontSize="12px" fontWeight={500} color="var(--ink-secondary)">
                                {s.title}
                            </Text>
                        </Flex>
                        {i < steps.length - 1 && (
                            <Text fontSize="12px" color="var(--ink-tertiary)" flexShrink={0}>
                                →
                            </Text>
                        )}
                    </Fragment>
                ))}
            </Flex>
        </Flex>
    );
}

interface RunningAnalysis {
    analysis_id?: string;
    _id?: string;
    id?: string;
    symbol?: string;
    share_name?: string;
    agent_name?: string;
    agent?: string;
    status?: string;
}

function RunningNow() {
    const [running, setRunning] = useState<RunningAnalysis[]>([]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await AnalysisService.listAnalyses();
                if (cancelled) return;
                const active = Array.isArray(data)
                    ? data.filter((a: RunningAnalysis) => {
                        const s = (a.status || "").toLowerCase();
                        return s === "pending" || s === "running" || s === "processing";
                    })
                    : [];
                setRunning(active);
            } catch {
                // ignore transient errors
            }
        };
        const interval = setInterval(load, 5000);
        load();
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    if (running.length === 0) return null;

    return (
        <Box
            bg="var(--surface-panel)"
            border="1px solid var(--hairline)"
            borderRadius="2px"
            p={5}
            mt={4}
        >
            <Text
                fontSize="10.5px"
                fontWeight={500}
                color="var(--ink-tertiary)"
                textTransform="uppercase"
                letterSpacing="0.06em"
                mb={3}
            >
                Running Now
            </Text>
            <Flex direction="column" gap={1.5} as={motion.div} layout>
                <AnimatePresence>
                {running.map((a) => {
                    const rid = a.analysis_id || a._id || a.id;
                    return (
                        <Box as={motion.div} key={rid} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: dur.base, ease }}>
                        <Link to={`/analysis-result/${rid}`}>
                            <HStack
                                gap={2}
                                p={2}
                                borderRadius="2px"
                                _hover={{ bg: "var(--surface-recessed)" }}
                                transition="background 80ms"
                            >
                                <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" flexShrink={0} />
                                <Flex direction="column" minW={0} flex={1}>
                                    <Text fontSize="12.5px" fontWeight={500} color="var(--ink-primary)" lineHeight="short">
                                        {a.share_name || a.symbol}
                                    </Text>
                                    <Text
                                        fontSize="11px"
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-tertiary)"
                                        whiteSpace="nowrap"
                                        overflow="hidden"
                                        textOverflow="ellipsis"
                                    >
                                        {a.agent_name || a.agent}
                                    </Text>
                                </Flex>
                            </HStack>
                        </Link>
                        </Box>
                    );
                })}
                </AnimatePresence>
            </Flex>
        </Box>
    );
}

function DataAvailabilityTag({ loading, data, symbol }: { loading: boolean; data: any; symbol: string }) {
    let color = "var(--surface-recessed)";
    let textColor = "var(--ink-secondary)";
    let label = "";
    let detail = "";
    let icon: React.ReactNode = <MdInfoOutline size={11} />;

    if (loading) {
        return (
            <HStack gap={1.5} px={2} py={1} borderRadius="999px" bg="var(--surface-recessed)">
                <Spinner size="xs" borderWidth="2px" color="var(--ink-secondary)" />
                <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                    checking…
                </Text>
            </HStack>
        );
    }

    if (!data) {
        label = "availability unknown";
        detail = "Could not determine data availability.";
    } else if (data.pull_supported === false) {
        label = "pull not available";
        detail = "Automated data pulling is only supported for NSE stocks.";
    } else if (!data.available && !data.error) {
        label = "will pull data";
        detail = "No data exists yet. Data will be pulled automatically when you start the analysis.";
        color = "var(--accent-secondary)";
        textColor = "#fff";
    } else if (data.error && !data.keyed) {
        label = "data not available";
        detail = String(data.error);
    } else if (data.error && data.keyed) {
        label = "will pull data";
        detail = String(data.error);
        color = "var(--accent-secondary)";
        textColor = "#fff";
    } else if (data.is_fresh) {
        label = "data fresh";
        detail = data.last_pulled
            ? `Last pulled ${new Date(data.last_pulled).toLocaleString()} — within freshness window.`
            : `Data available and fresh for ${symbol}.`;
        color = "var(--signal-positive)";
        textColor = "#fff";
        icon = <MdCheck size={11} />;
    } else {
        label = "data stale";
        detail = data.last_pulled
            ? `Last pulled ${new Date(data.last_pulled).toLocaleString()} — data will be refreshed automatically.`
            : `Data exists but may be stale — will refresh on analysis start.`;
        color = "#f59e0b";
        textColor = "#fff";
    }

    return (
        <Tooltip content={detail}>
            <HStack
                as={motion.div}
                key={label}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: dur.fast, ease }}
                gap={1.5}
                px={2}
                py={1}
                borderRadius="999px"
                bg={color}
                color={textColor}
                cursor="help"
            >
                {icon}
                <Text fontSize="11px" fontFamily="var(--font-mono)" fontWeight={500}>
                    {label}
                </Text>
            </HStack>
        </Tooltip>
    );
}

export default function Analysis() {
    const { id } = useParams();

    const [availableAgents, setAvailableAgents] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    const [dataStatus, setDataStatus] = useState<any>(null);
    const [dataStatusLoading, setDataStatusLoading] = useState(false);

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
        agent: "",
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

    const agentOptions = useMemo(() => {
        const items = availableAgents.map((p: any) => ({ label: p.name, value: p._id || p.id || p.name }));
        return createListCollection({
            items,
            itemToString: (item: any) => item.label,
            itemToValue: (item: any) => item.value,
        });
    }, [availableAgents]);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
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
            const [modelsData, settings] = await Promise.all([
                AnalysisService.getAvailableModels(),
                SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
            ]);
            const allModels = Array.isArray(modelsData) ? modelsData : [];
            const keys = Object.keys(settings?.llm_keys || {});
            const models = keys.length > 0
                ? allModels.filter((m: string) => {
                    const provider = m.split("/")[0];
                    return provider === "ollama" || keys.includes(provider);
                })
                : allModels;
            setAvailableModels(models);
            setSelectedModel(prev => {
                if (prev && models.includes(prev)) return prev;
                return models[0] || "";
            });
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

    const fetchAvailableAgents = useCallback(async () => {
        try {
            const data = await AgentService.listAgents();
            if (Array.isArray(data)) {
                setAvailableAgents(data);
            } else {
                setAvailableAgents([]);
            }
        } catch {
            setAvailableAgents([]);
        }
    }, []);

    const runAnalysis = async () => {
        if (!config.source || !config.share || !config.agent) return;

        try {
            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                agent_name: config.agent,
                model: selectedModel || undefined,
                source: config.source,
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
                    agent: data.agent_name || data.agent || prev.agent,
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
        fetchAvailableAgents();
        fetchModels();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id, fetchAvailableSources, fetchAvailableAgents, fetchModels, fetchAnalysisData]);

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

    useEffect(() => {
        if (!config.share || status !== "EMPTY" || id) {
            setDataStatus(null);
            return;
        }
        let cancelled = false;
        setDataStatusLoading(true);
        DataService.getDataStatus(config.share, config.source)
            .then((d) => {
                if (!cancelled) setDataStatus(d);
            })
            .catch(() => {
                if (!cancelled) setDataStatus({ available: false, error: "Availability check failed." });
            })
            .finally(() => {
                if (!cancelled) setDataStatusLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [config.share, config.source, status, id]);

    const searchParams = useMemo(() => ({ source: config.source }), [config.source]);
    const isConfigComplete = config.share !== "" && config.agent !== "";
    const canRunAnalysis = isConfigComplete;

    return (
        <Box bg="var(--surface-canvas)" minH="100vh">
            <Flex direction="column" gap={7} maxW="1240px" mx="auto" py={5}>
                {/* Header: hero + inline stepper */}
                <Flex
                    as={motion.div}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                    justify="space-between"
                    align={{ base: "flex-start", md: "flex-end" }}
                    gap={{ base: 5, md: 8 }}
                    wrap="wrap"
                >
                    <AnalysisHero />
                    <Box w={{ base: "full", md: "auto" }} flex={{ md: 1 }} maxW="460px" minW={{ base: "full", md: "320px" }}>
                        <AnalysisStepper
                            sourceComplete={!!config.source}
                            companyComplete={!!config.share}
                            agentComplete={!!config.agent}
                        />
                    </Box>
                </Flex>

            <Flex direction={{ base: "column", md: "row" }} gap={6} align="start" mb={4}>
                {/* Left: Configuration */}
                <Box flex="1" width="full" minW={0}
                    as={motion.div}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease, delay: 0.05 }}
                >
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={{ base: 5, md: 8 }}
                        mb={6}
                    >
                        <Flex direction="column" gap={6} as={motion.div} variants={stagger} initial="initial" animate="animate">
                            <Flex direction="column" align="start" as={motion.div} variants={staggerItem}>
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

                            <Flex direction="column" align="start" as={motion.div} variants={staggerItem}>
                                <Flex justify="space-between" align="center" w="full" mb={2}>
                                    <Text
                                        fontSize="10.5px"
                                        fontWeight={500}
                                        color="var(--ink-tertiary)"
                                        textTransform="uppercase"
                                        letterSpacing="0.06em"
                                    >
                                        Target Company
                                    </Text>
                                    {config.share && status === "EMPTY" && !id && (
                                        <DataAvailabilityTag
                                            loading={dataStatusLoading}
                                            data={dataStatus}
                                            symbol={config.share}
                                        />
                                    )}
                                </Flex>
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

                            <Flex direction="column" align="start" as={motion.div} variants={staggerItem}>
                                <Text
                                    mb={2}
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    textTransform="uppercase"
                                    letterSpacing="0.06em"
                                >
                                    Agent
                                </Text>
                                <Box width="full">
                                    <Select.Root
                                        collection={agentOptions}
                                        value={config.agent ? [config.agent] : []}
                                        onValueChange={(e) => {
                                            setConfig({ ...config, agent: e.value[0] });
                                        }}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control>
                                            <Select.Trigger borderColor="var(--hairline)">
                                                <Select.ValueText placeholder="Select Agent" />
                                            </Select.Trigger>
                                            <Select.IndicatorGroup>
                                                <Select.Indicator />
                                            </Select.IndicatorGroup>
                                        </Select.Control>
                                        <Portal>
                                            <Select.Positioner>
                                                <Select.Content>
                                                    {agentOptions.items.map((item: any) => (
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

                            <Flex direction="column" align="start" as={motion.div} variants={staggerItem}>
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
                                    <AnimatePresence>
                                    {showModelList && (
                                        <Box
                                            as={motion.div}
                                            initial={{ opacity: 0, y: -4, height: 0 }}
                                            animate={{ opacity: 1, y: 0, height: "auto" }}
                                            exit={{ opacity: 0, y: -4, height: 0 }}
                                            transition={{ duration: dur.base, ease }}
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
                                    </AnimatePresence>
                                </Box>
                                <Flex align="center" gap={1.5} mt={1.5}>
                                    <MdInfoOutline size={12} color="var(--ink-tertiary)" />
                                    <Text fontSize="11px" color="var(--ink-tertiary)">
                                        Add API keys in{" "}
                                        <Link to="/settings" style={{ color: "var(--accent-primary)" }}>
                                            Settings
                                        </Link>
                                        {" "}to enable more models
                                    </Text>
                                </Flex>
                            </Flex>
                        </Flex>
                    </Box>

                </Box>

                {/* Right: Analysis Status */}
                <Box width={{ base: "full", md: "380px" }} flexShrink={0}
                    as={motion.div}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease, delay: 0.12 }}
                >
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
                            {/* Overall run state — crossfades between states */}
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.div
                                    key={status === "EMPTY" && id ? "resuming" : status}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: dur.fast, ease }}
                                >
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
                                </motion.div>
                            </AnimatePresence>

                            {/* Step checklist */}
                            {status !== "EMPTY" && steps.length > 0 && (
                                <Box
                                    borderTop="1px solid var(--hairline)"
                                    borderBottom="1px solid var(--hairline)"
                                    py={4}
                                >
                                    <RunSteps steps={steps} now={Date.now()} />
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
                                        as={motion.button}
                                        whileHover={canRunAnalysis ? { scale: 1.02 } : undefined}
                                        whileTap={canRunAnalysis ? { scale: 0.98 } : undefined}
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

                    <RunningNow />
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
        </Box>
    )
}
