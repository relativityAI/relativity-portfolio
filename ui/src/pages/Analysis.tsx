import SearchBar from "@/components/SearchBar";
import PageHero from "@/components/PageHero";
import {
    Button, Flex, Text, Spinner, Box, Select, Input,
    createListCollection, Portal, HStack
} from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { MdInfoOutline, MdCheck, MdClose, MdArrowForward } from "react-icons/md";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, AgentService, DataService, SettingsService, API_BASE } from "@/db";
import { formatSeconds, agentDisplayName } from "@/utils";
import { RunSteps, type RunStep } from "./shared/RunStatus";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";

const MAX_POLL_RETRIES = 600;

const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    gemini: "Gemini",
    groq: "Groq",
    cerebras: "Cerebras",
    openrouter: "OpenRouter",
    anthropic: "Anthropic",
    ollama: "Ollama",
};
const providerLabel = (prefix: string) => PROVIDER_LABELS[prefix] || prefix;

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
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

function RunningNow({ agents }: { agents?: any[] }) {
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
        <AnimatePresence initial={false}>
        <Flex
            as={motion.div}
            key="runningnow"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: dur.base, ease }}
            overflow="hidden"
            align="center"
            gap={3}
            wrap="wrap"
            py={2.5}
            mb={1}
        >
            <HStack gap={1.5} flexShrink={0}>
                <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                <Text
                    fontSize="10.5px"
                    fontWeight={500}
                    color="var(--ink-tertiary)"
                    textTransform="uppercase"
                    letterSpacing="0.06em"
                >
                    Running now
                </Text>
            </HStack>
            {running.map((a) => {
                const rid = a.analysis_id || a._id || a.id;
                return (
                    <Link key={rid} to={`/analysis-result/${rid}`}>
                        <Flex align="center" gap={1.5} _hover={{ color: "var(--ink-primary)" }}>
                            <Text fontSize="12.5px" fontWeight={500} color="var(--ink-secondary)">
                                {a.share_name || a.symbol}
                            </Text>
                            <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                {agentDisplayName(a.agent_name || a.agent, agents || [])}
                            </Text>
                            <MdArrowForward size={12} color="var(--ink-tertiary)" />
                        </Flex>
                    </Link>
                );
            })}
        </Flex>
        </AnimatePresence>
    );
}

function StepSection({ n, title, done, children }: { n: string; title: string; done: boolean; children: any }) {
    return (
        <Box as={motion.div} variants={staggerItem} py={{ base: 4, md: 5 }}>
            <Flex align="center" gap={2.5} mb={4}>
                <Text
                    fontSize="12px"
                    fontFamily="var(--font-mono)"
                    fontWeight={500}
                    color="var(--accent-primary)"
                >
                    {n}
                </Text>
                <Text
                    fontSize="10.5px"
                    fontWeight={500}
                    color="var(--ink-secondary)"
                    textTransform="uppercase"
                    letterSpacing="0.06em"
                >
                    {title}
                </Text>
                <Box flex={1} h="1px" bg="var(--hairline)" />
                {done && <MdCheck size={12} color="var(--signal-positive)" aria-label={`${title} selected`} />}
            </Flex>
            {children}
        </Box>
    );
}

function FieldLabel({ children }: { children: any }) {
    return (
        <Text
            fontSize="10.5px"
            fontWeight={500}
            color="var(--ink-tertiary)"
            textTransform="uppercase"
            letterSpacing="0.06em"
            mb={2}
        >
            {children}
        </Text>
    );
}

const modelPrefix = (id: string) => id.split("/")[0];
const modelName = (id: string) => id.split("/").slice(1).join("/") || id;

function SegmentedControl({ value, onChange, options }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <Flex role="group" aria-label="Market source" border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden">
            {options.map((o) => {
                const active = value === o.value;
                return (
                    <Box
                        as="button"
                        key={o.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(o.value)}
                        flex={1}
                        py={2}
                        textAlign="center"
                        fontSize="13px"
                        fontWeight={active ? 600 : 500}
                        color={active ? "#fff" : "var(--ink-secondary)"}
                        bg={active ? "var(--accent-primary)" : "transparent"}
                        _hover={{ bg: active ? "var(--accent-primary)" : "var(--surface-recessed)", color: active ? "#fff" : "var(--ink-primary)" }}
                        transition="background 160ms, color 160ms"
                        cursor="pointer"
                    >
                        {o.label}
                    </Box>
                );
            })}
        </Flex>
    );
}



export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [latestAnalysis, setLatestAnalysis] = useState<any>(null);
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

    useEffect(() => {
        let cancelled = false;
        AnalysisService.listAnalyses()
            .then((data) => {
                if (cancelled || !Array.isArray(data) || data.length === 0) return;
                setLatestAnalysis(data.reduce((a, b) =>
                    +new Date(a.created_at ?? 0) > +new Date(b.created_at ?? 0) ? a : b
                ));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const [config, setConfig] = useState({
        source: "NSE",
        share: "",
        shareName: "",
        agent: "",
    });

    const sourceKeyMap: Record<string, { mainKey: string; secondaryKey: string; nameField: string }> = {
        SEC: { mainKey: "ticker", secondaryKey: "name", nameField: "name" },
        NSE: { mainKey: "SYMBOL", secondaryKey: "NAME", nameField: "NAME" },
    };

    const sourceKeys = sourceKeyMap[config.source] || sourceKeyMap.SEC;

    const agentOptions = useMemo(() => {
        const items = availableAgents.map((p: any) => ({ label: p.name, value: p._id || p.id || p.name }));
        return createListCollection({
            items,
            itemToString: (item: any) => item.label,
            itemToValue: (item: any) => item.value,
        });
    }, [availableAgents]);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [providerCount, setProviderCount] = useState(0);
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

    const fetchModels = useCallback(async () => {
        try {
            const [modelsData, settings] = await Promise.all([
                AnalysisService.getAvailableModels(),
                SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
            ]);
            const allModels = Array.isArray(modelsData) ? modelsData : [];
            const keys = Object.keys(settings?.llm_keys || {});
            setProviderCount(keys.filter((k) => k !== "tavily").length);
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

    const [validatingModel, setValidatingModel] = useState(false);
    const [modelError, setModelError] = useState<string | null>(null);

    const checkModel = useCallback(async (modelId: string) => {
        setValidatingModel(true);
        setModelError(null);
        try {
            const result = await AnalysisService.validateModel(modelId);
            if (!result.valid) {
                setModelError(result.error || "Model validation failed.");
                return false;
            }
            return true;
        } catch (e: any) {
            setModelError(e.response?.data?.error || e.message || "Model validation failed.");
            return false;
        } finally {
            setValidatingModel(false);
        }
    }, []);

    const runAnalysis = async () => {
        if (!config.source || !config.share || !config.agent) return;

        // Validate model first
        const isValid = await checkModel(selectedModel || availableModels[0]);
        if (!isValid) return;


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
        fetchAvailableAgents();
        fetchModels();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id, fetchAvailableAgents, fetchModels, fetchAnalysisData]);

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
                            if (isComplete) navigate(`/analysis-result/${correlationId}`);
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
    }, [status, correlationId, navigate]);

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
    const selectedAgent = useMemo(
        () => availableAgents.find((a: any) => (a._id || a.id) === config.agent || a.name === config.agent),
        [availableAgents, config.agent]
    );
    const siblingModelCount = useCallback(
        (id: string) => availableModels.filter((m) => modelPrefix(m) === modelPrefix(id)).length - 1,
        [availableModels]
    );
    const isConfigComplete = config.share !== "" && config.agent !== "";
    const canRunAnalysis = isConfigComplete;

    return (
        <Box
            bg="var(--surface-canvas)"
            minH="100%"
            display="flex"
            flexDirection="column"
            mx={{ base: -4, md: -16 }}
            my="-5"
        >
            <Box flex={1} w="full" minW={0}>
                <Flex direction="column" maxW="1240px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 4, md: 6 }}>
                    {/* Header */}
                    <Box w="full" mb={{ base: 3, md: 4 }}>
                        <PageHero>
                            <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={4} wrap="wrap">
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
                                        Run an analysis
                                    </Text>
                                    <Text fontSize="13px" color="var(--ink-secondary)">
                                        Configure the market, company, agent, and model — then start the run.
                                    </Text>
                                </Flex>
                                <Flex direction={{ base: "row", md: "column" }} align={{ base: "center", md: "flex-end" }} gap={{ base: 4, md: 1.5 }}>
                                    <Link to="/analysis-list" style={{ display: "block" }}>
                                        <Flex
                                            align="center"
                                            gap={1.5}
                                            fontSize="13px"
                                            fontWeight={500}
                                            color="var(--ink-secondary)"
                                            _hover={{ color: "var(--ink-primary)" }}
                                            cursor="pointer"
                                        >
                                            View past analyses
                                            <MdArrowForward size={15} color="var(--ink-tertiary)" />
                                        </Flex>
                                    </Link>
                                    {latestAnalysis && (
                                        <Link
                                            to={`/analysis-result/${latestAnalysis.analysis_id || latestAnalysis._id || latestAnalysis.id}`}
                                            title={`Latest analysis: ${latestAnalysis.share_name || latestAnalysis.symbol || ""}`}
                                            style={{ display: "block", whiteSpace: "nowrap" }}
                                        >
                                            <Flex align="center" gap={1}>
                                                <Text fontSize="11px" fontFamily="var(--font-tabular)" color="var(--ink-tertiary)" _hover={{ color: "var(--ink-secondary)" }}>
                                                    Latest{" "}
                                                    <Text as="span" color="var(--ink-secondary)">
                                                        {new Date(latestAnalysis.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                                    </Text>{" "}
                                                    ·{" "}
                                                    <Text as="span" display="inline-block" maxW="80px" overflow="hidden" textOverflow="ellipsis" verticalAlign="bottom">{latestAnalysis.symbol || latestAnalysis.share_name}</Text>
                                                </Text>
                                                <MdArrowForward size={12} color="var(--ink-tertiary)" />
                                            </Flex>
                                        </Link>
                                    )}
                                </Flex>
                            </Flex>
                        </PageHero>
                    </Box>

                    {/* Running now strip */}
                    <RunningNow agents={availableAgents} />

                    {/* Steps */}
                    <Flex direction="column" as={motion.div} variants={stagger} initial="initial" animate="animate">
                        {/* 01 — Company */}
                        <StepSection n="01" title="Company" done={!!config.share}>
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                <Box w={{ base: "full", md: "200px" }} flexShrink={0}>
                                    <FieldLabel>Market</FieldLabel>
                                    <SegmentedControl
                                        value={config.source}
                                        onChange={handleSourceChange}
                                        options={[
                                            { value: "NSE", label: "NSE" },
                                            { value: "SEC", label: "SEC" },
                                        ]}
                                    />
                                </Box>
                                <Box flex={1} minW={0}>
                                    <FieldLabel>Company</FieldLabel>
                                    <SearchBar
                                        key={config.source}
                                        url={`${API_BASE}/stocks/search`}
                                        mainKey={sourceKeys.mainKey}
                                        secondaryKey={sourceKeys.secondaryKey}
                                        onChange={handleConfigChange}
                                        field="share"
                                        params={searchParams}
                                        placeholder={config.source === "SEC" ? "Search US stocks (e.g., AAPL)" : "Search Indian stocks (e.g., RELIANCE)"}
                                    />
                                    {config.share && (
                                        <Flex align="center" gap={1.5} mt={2} minH="16px">
                                            {dataStatusLoading ? (
                                                <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
                                            ) : dataStatus ? (
                                                dataStatus.available ? (
                                                    <>
                                                        <MdCheck size={12} color="var(--signal-positive)" />
                                                        <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                                            Live data on file · {config.source}
                                                        </Text>
                                                    </>
                                                ) : (
                                                    <>
                                                        <MdInfoOutline size={12} color="var(--signal-caution)" />
                                                        <Text
                                                            fontSize="11px"
                                                            fontFamily="var(--font-mono)"
                                                            color="var(--ink-tertiary)"
                                                            title={dataStatus.error || undefined}
                                                        >
                                                            {dataStatus.keyed === false
                                                                ? "No data key configured — reports may not fetch"
                                                                : "No data on file yet — it will be pulled at run time"}
                                                        </Text>
                                                    </>
                                                )
                                            ) : null}
                                        </Flex>
                                    )}
                                </Box>
                            </Flex>
                        </StepSection>

                        {/* 02 — Agent */}
                        <StepSection n="02" title="Agent" done={!!config.agent}>
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                <Box w={{ base: "full", md: "380px" }} flexShrink={0}>
                                <FieldLabel>Agent</FieldLabel>
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
                                <Flex align="center" gap={1.5} mt={1.5}>
                                    <MdInfoOutline size={12} color="var(--ink-tertiary)" />
                                    <Text fontSize="11px" color="var(--ink-tertiary)">
                                        Create or edit agents in the{" "}
                                        <Link to="/agent/builder" style={{ color: "var(--accent-primary)" }}>
                                            Agent Builder
                                        </Link>
                                    </Text>
                                </Flex>
                                </Box>
                                <Box flex={1} minW={0} pt={{ base: 1, md: 5 }}>
                                    {selectedAgent ? (
                                        <Flex direction="column" gap={1}>
                                            <Flex align="baseline" gap={2} flexWrap="wrap">
                                                <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">
                                                    {selectedAgent.name}
                                                </Text>
                                                <Text fontSize="12px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                                                    <Text as="span" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" fontWeight={600} color="var(--ink-secondary)">
                                                        {selectedAgent.asset_evaluation?.qualitative?.length || 0}
                                                    </Text>{" "}
                                                    qual
                                                    <Text as="span" color="var(--ink-tertiary)" mx={1.5}>·</Text>
                                                    <Text as="span" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" fontWeight={600} color="var(--ink-secondary)">
                                                        {selectedAgent.asset_evaluation?.quantitative?.length || 0}
                                                    </Text>{" "}
                                                    quant
                                                </Text>
                                            </Flex>
                                            {(selectedAgent.philosophy || selectedAgent.persona?.philosophy_and_mindset) && (
                                                <Text fontSize="12px" color="var(--ink-tertiary)" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                                                    {selectedAgent.philosophy || selectedAgent.persona?.philosophy_and_mindset}
                                                </Text>
                                            )}
                                        </Flex>
                                    ) : (
                                        <Text fontSize="12px" color="var(--ink-tertiary)">
                                            Select an agent to see its parameters
                                        </Text>
                                    )}
                                </Box>
                            </Flex>
                        </StepSection>

                        {/* 03 — Model */}
                        <StepSection n="03" title="Model" done={!!selectedModel}>
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                <Box w={{ base: "full", md: "380px" }} flexShrink={0}>
                                <FieldLabel>Model</FieldLabel>
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
                                                        transition="background 160ms"
                                                        onClick={() => {
                                                            setSelectedModel(m);
                                                            setModelError(null);
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
                                {modelError && (
                                    <Text mt={1.5} fontSize="11.5px" color="var(--signal-negative)">
                                        {modelError}
                                    </Text>
                                )}
                                {validatingModel && (
                                    <Flex align="center" gap={1.5} mt={1.5}>
                                        <Spinner size="xs" color="var(--ink-secondary)" />
                                        <Text fontSize="11px" color="var(--ink-secondary)">Checking model access...</Text>
                                    </Flex>
                                )}
                                <Flex align="center" gap={1.5} mt={2}>
                                    <MdInfoOutline size={12} color="var(--ink-tertiary)" />
                                    <Text fontSize="11px" color="var(--ink-tertiary)">
                                        {providerCount > 0 ? `${providerCount} provider${providerCount === 1 ? "" : "s"} configured · add more in ` : "No API keys configured · add "}
                                        <Link to="/settings" style={{ color: "var(--accent-primary)" }}>
                                            Settings
                                        </Link>
                                    </Text>
                                </Flex>
                                </Box>
                                <Box flex={1} minW={0} pt={{ base: 1, md: 5 }}>
                                    {selectedModel ? (
                                        <Flex direction="column" gap={0.5}>
                                            <Flex align="center" gap={2}>
                                                <Text
                                                    fontSize="10.5px"
                                                    fontWeight={600}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--accent-primary)"
                                                >
                                                    {providerLabel(modelPrefix(selectedModel))}
                                                </Text>
                                                <MdCheck size={13} color="var(--signal-positive)" />
                                            </Flex>
                                            <Text mt={0.5} fontSize="16px" fontWeight={600} color="var(--ink-primary)" lineHeight="short" wordBreak="break-word">
                                                {modelName(selectedModel)}
                                            </Text>
                                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                                {selectedModel}
                                            </Text>
                                            <Text fontSize="12px" color="var(--ink-secondary)">
                                                {siblingModelCount(selectedModel)} other model{siblingModelCount(selectedModel) === 1 ? "" : "s"} from {providerLabel(modelPrefix(selectedModel))} · checked when the run starts
                                            </Text>
                                        </Flex>
                                    ) : (
                                        <Text fontSize="12px" color="var(--ink-tertiary)">
                                            Select a model to see its details
                                        </Text>
                                    )}
                                </Box>
                            </Flex>
                        </StepSection>
                    </Flex>

                    {/* Live progress while running */}
                    <AnimatePresence mode="wait" initial={false}>
                    {status === "PENDING" && (
                        <Box
                            key="progress"
                            as={motion.div}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: dur.base, ease }}
                            overflow="hidden"
                            borderTop="1px solid var(--hairline)"
                            py={5}
                        >
                            <FieldLabel>Progress</FieldLabel>
                            <RunSteps steps={steps} now={Date.now()} />
                        </Box>
                    )}
                    </AnimatePresence>

                    {loading && (
                        <Flex justify="center" align="center" gap={3} py={16} color="var(--ink-secondary)">
                            <Spinner size="sm" borderWidth="2px" />
                            <Text fontSize="13px">Loading analysis data…</Text>
                        </Flex>
                    )}

                    {/* Launch */}
                    <Flex direction="column" gap={4} mt={4} pt={5} pb={2} borderTop="1px solid var(--hairline)">
                        {/* Run spec */}
                        <Flex align="center" justify="center" flexWrap="wrap" columnGap={1.5} rowGap={1}>
                            {[
                                config.source,
                                config.share ? config.share.toUpperCase() : "—",
                                config.agent ? agentDisplayName(config.agent, availableAgents) || config.agent : "—",
                                selectedModel || "—",
                            ].map((part, i) => (
                                <HStack key={i} gap={1.5} minW={0}>
                                    {i > 0 && <Text fontSize="11px" color="var(--ink-tertiary)">·</Text>}
                                    <Text
                                        fontSize="13px"
                                        fontFamily="var(--font-tabular)"
                                        fontVariantNumeric="tabular-nums"
                                        fontWeight={part === "—" ? 400 : 500}
                                        color={part === "—" ? "var(--ink-tertiary)" : "var(--ink-primary)"}
                                    >
                                        {part}
                                    </Text>
                                </HStack>
                            ))}
                        </Flex>

                        {/* Action */}
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={status === "EMPTY" && id ? "resuming" : status}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                transition={{ duration: dur.fast, ease }}
                            >
                            {status === "PENDING" ? (
                                <Button size="lg" w="full" variant="surface" colorPalette="blue" disabled>
                                    <HStack gap={2}>
                                        <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                                        <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)">
                                            {id ? "Resuming" : "Running"}
                                        </Text>
                                        {elapsedTime > 0 && (
                                            <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)">
                                                {formatSeconds(elapsedTime)}
                                            </Text>
                                        )}
                                    </HStack>
                                </Button>
                            ) : status === "COMPLETED" ? (
                                <Box border="1px solid var(--hairline)" borderRadius="2px" bg="var(--surface-recessed)" p={{ base: 4, md: 5 }}>
                                    <Flex direction={{ base: "column", md: "row" }} align={{ md: "center" }} justify="center" gap={3} wrap="wrap">
                                        <HStack gap={2}>
                                            <MdCheck size={16} color="var(--signal-positive)" />
                                            <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)">Complete</Text>
                                            {analysisDuration && (
                                                <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)">
                                                    {analysisDuration}
                                                </Text>
                                            )}
                                        </HStack>
                                        {correlationId && (
                                            <Link to={`/analysis-result/${correlationId}`}>
                                                <Button size="lg" variant="surface" colorPalette="blue" px={8}>View report</Button>
                                            </Link>
                                        )}
                                        <Button
                                            size="lg"
                                            variant="subtle"
                                            color="var(--ink-secondary)"
                                            _hover={{ color: "var(--ink-primary)" }}
                                            fontWeight={500}
                                            onClick={() => {
                                                setStatus("EMPTY");
                                                setSteps([]);
                                            }}
                                        >
                                            Run again
                                        </Button>
                                    </Flex>
                                </Box>
                            ) : status === "ERROR" ? (
                                <Box border="1px solid var(--hairline)" borderRadius="2px" bg="var(--surface-recessed)" p={{ base: 4, md: 5 }}>
                                    <Flex direction={{ base: "column", md: "row" }} align={{ md: "center" }} justify="center" gap={3} wrap="wrap">
                                        <HStack gap={2}>
                                            <MdClose size={16} color="var(--signal-negative)" />
                                            <Text fontSize="14px" fontWeight={600} color="var(--signal-negative)">Failed</Text>
                                        </HStack>
                                        {correlationId && (
                                            <Link to={`/analysis-result/${correlationId}`}>
                                                <Button size="lg" variant="subtle" color="var(--ink-secondary)" _hover={{ color: "var(--ink-primary)" }} fontWeight={500}>View report</Button>
                                            </Link>
                                        )}
                                        <Button
                                            size="lg"
                                            variant="subtle"
                                            colorPalette="red"
                                            fontWeight={500}
                                            onClick={() => {
                                                setStatus("EMPTY");
                                                setSteps([]);
                                            }}
                                        >
                                            Try again
                                        </Button>
                                    </Flex>
                                </Box>
                            ) : status === "EMPTY" && id ? (
                                <Button size="lg" w="full" variant="surface" colorPalette="blue" disabled>
                                    <HStack gap={2}>
                                        <Spinner size="sm" borderWidth="2px" />
                                        <Text fontSize="14px" fontWeight={600}>Resuming analysis…</Text>
                                    </HStack>
                                </Button>
                            ) : (
                                <Box>
                                    <Button
                                        as={motion.button}
                                        whileHover={canRunAnalysis ? { scale: 1.01 } : undefined}
                                        whileTap={canRunAnalysis ? { scale: 0.99 } : undefined}
                                        size="lg"
                                        w="full"
                                        variant="surface"
                                        colorPalette="blue"
                                        fontWeight={600}
                                        fontSize="15px"
                                        onClick={runAnalysis}
                                        disabled={!canRunAnalysis}
                                        loading={status === "PENDING"}
                                        loadingText="Running…"
                                    >
                                        Start Analysis
                                    </Button>
                                    {!canRunAnalysis && (
                                        <Text mt={2} fontSize="11.5px" color="var(--ink-tertiary)" textAlign="center">
                                            Choose a company and an agent to enable the run
                                        </Text>
                                    )}
                                </Box>
                            )}
                            </motion.div>
                        </AnimatePresence>
                    </Flex>
                </Flex>
            </Box>

        </Box>
    )
}
