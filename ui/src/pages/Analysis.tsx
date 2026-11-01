import { Flex, Text, Spinner, Box } from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, SettingsService, API_BASE, isServerFreeModel } from "@/db";
import { HarnessAgentService, type HarnessAgent } from "@/lib/harnessAgents";
import { formatSeconds } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { ModelLogo } from "@/lib/modelLogos";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";
import { TickerLogo, SourceMark } from "@/lib/sourceLogos";
import {
    MenuDropdown,
    DropdownItem,
    PrimaryButton,
    SecondaryButton,
    ResumingButton,
} from "./shared/AnalysisControls";

const MAX_POLL_RETRIES = 600;

// Preferred model selected when the user hasn't picked one and it's available.
const PREFERRED_DEFAULT_MODEL = "groq/openai/gpt-oss-120b";

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

function StepHeader({ title, done }: { title: string; done?: boolean }) {
    return (
        <Flex align="center" gap={2} mb={2}>
            <Text
                fontSize="12.5px"
                fontFamily="var(--font-body)"
                fontWeight={500}
                color="var(--ink-secondary)"
            >
                {title}
            </Text>
            {done && <MdCheck size={13} color="var(--signal-positive)" />}
        </Flex>
    );
}

function FieldLabel({ children }: { children: any }) {
    return (
        <Text
            fontSize="11px"
            fontFamily="var(--font-body)"
            fontWeight={400}
            color="var(--ink-tertiary)"
            letterSpacing="0.02em"
            mb={1}
        >
            {children}
        </Text>
    );
}

const modelPrefix = (id: string) => id.split("/")[0];
const modelName = (id: string) => id.split("/").slice(1).join("/") || id;

function SummaryRow({ label, value, sub, muted, icon }: { label: string; value: string; sub?: string; muted?: boolean; icon?: React.ReactNode }) {
    return (
        <Flex direction="column" gap={0.5} py={1.5}>
            <Text fontSize="10px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-tertiary)">
                {label}
            </Text>
            <Flex align="center" gap={2} minW={0}>
                {icon && <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
                <Text
                    fontSize="14px"
                    fontWeight={muted ? 300 : 400}
                    fontFamily="var(--font-body)"
                    color={muted ? "var(--ink-tertiary)" : "var(--ink-primary)"}
                    minW={0}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                >
                    {value}
                </Text>
            </Flex>
            {sub && (
                <Text fontSize="11px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {sub}
                </Text>
            )}
        </Flex>
    );
}



function AnalysisSummary(props: {
    status: StatusType;
    resuming: boolean;
    source: string;
    share: string;
    shareName: string;
    agentName: string | null;
    model: string;
    canRun: boolean;
    onRun: () => void;
    elapsedTime: number;
    analysisDuration: string;
    correlationId: string;
    onReset: () => void;
}) {
    const { status } = props;

    const companyLabel = props.share ? (props.shareName || props.share) : "Not set";
    const targetLabel = props.agentName || "Not set";
    const modelLabel = props.model ? modelName(props.model) : "Not set";
    const modelSub = props.model ? `${providerLabel(modelPrefix(props.model))} · ${props.model}` : undefined;
    const sourceKey = (props.source || "").toUpperCase().includes("SEC") ? "sec" : "nse";

    if (status === "PENDING") {
        return (
            <Box p={4}>
                <Flex direction="column" gap={3}>
                    <Flex align="center" gap={2.5}>
                        <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="14px" fontWeight={400} fontFamily="var(--font-body)" color="var(--ink-primary)">
                            {props.resuming ? "Resuming" : "Running"}
                        </Text>
                        {props.elapsedTime > 0 && (
                            <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" ml="auto">
                                {formatSeconds(props.elapsedTime)}
                            </Text>
                        )}
                    </Flex>
                    <SecondaryButton onClick={props.onReset}>
                        Run another
                    </SecondaryButton>
                </Flex>
            </Box>
        );
    }

    if (status === "COMPLETED") {
        return (
            <Box p={4}>
                <Flex direction="column" gap={3}>
                    <Flex align="center" gap={2.5}>
                        <MdCheck size={16} color="var(--signal-positive)" />
                        <Text fontSize="14px" fontWeight={400} fontFamily="var(--font-body)" color="var(--ink-primary)">
                            Complete
                        </Text>
                        {props.analysisDuration && (
                            <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" ml="auto">
                                {props.analysisDuration}
                            </Text>
                        )}
                    </Flex>
                    <Flex gap={2}>
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1, display: "block", textDecoration: "none" }}>
                                <PrimaryButton>View report</PrimaryButton>
                            </Link>
                        )}
                        <SecondaryButton flex onClick={props.onReset}>
                            Run again
                        </SecondaryButton>
                    </Flex>
                </Flex>
            </Box>
        );
    }

    if (status === "ERROR") {
        return (
            <Box p={4}>
                <Flex direction="column" gap={3}>
                    <Flex align="center" gap={2.5}>
                        <MdClose size={16} color="var(--signal-negative)" />
                        <Text fontSize="14px" fontWeight={400} fontFamily="var(--font-body)" color="var(--signal-negative)">
                            Failed
                        </Text>
                    </Flex>
                    <Flex gap={2}>
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1, display: "block", textDecoration: "none" }}>
                                <SecondaryButton style={{ width: "100%" }}>View report</SecondaryButton>
                            </Link>
                        )}
                        <SecondaryButton flex onClick={props.onReset}>
                            Try again
                        </SecondaryButton>
                    </Flex>
                </Flex>
            </Box>
        );
    }

    return (
        <Box p={4}>
            <Text fontSize="15px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-primary)" mb={2}>
                Config summary
            </Text>
            <SummaryRow
                label="Company"
                icon={props.share ? <TickerLogo symbol={props.share} size={16} /> : undefined}
                value={companyLabel}
                sub={props.share ? props.share.toUpperCase() : undefined}
                muted={!props.share}
            />
            <SummaryRow
                label="Market"
                icon={props.source ? <SourceMark source={sourceKey} size={16} /> : undefined}
                value={props.source || "Not set"}
                muted={!props.source}
            />
            <SummaryRow
                label="Agent"
                icon={props.agentName ? <AgentAvatar agent={props.agentName} size={16} /> : undefined}
                value={targetLabel}
                muted={!props.agentName}
            />
            <SummaryRow
                label="Model"
                icon={props.model ? <ModelLogo model={props.model} size={16} /> : undefined}
                value={modelLabel}
                sub={modelSub}
                muted={!props.model}
            />
            <Box pt={3} mt={1}>
                {props.resuming ? (
                    <ResumingButton>
                        <Flex align="center" gap={2}>
                            <Spinner size="sm" borderWidth="2px" />
                            <Text fontSize="14px" fontWeight={400} fontFamily="var(--font-body)">Resuming analysis…</Text>
                        </Flex>
                    </ResumingButton>
                ) : (
                    <PrimaryButton onClick={props.onRun} disabled={!props.canRun}>
                        Run Now
                    </PrimaryButton>
                )}
            </Box>
        </Box>
    );
}

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [availableAgents, setAvailableAgents] = useState<HarnessAgent[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (status === "PENDING") {
            const start = startedAt ?? Date.now();
            const tick = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)));
            tick();
            const interval = setInterval(tick, 1000);
            return () => clearInterval(interval);
        }
    }, [status, startedAt]);

    const [config, setConfig] = useState({
        source: "NSE",
        share: "",
        shareName: "",
    });

    const sourceKeyMap: Record<string, { mainKey: string; secondaryKey: string; nameField: string }> = {
        SEC: { mainKey: "ticker", secondaryKey: "name", nameField: "name" },
        NSE: { mainKey: "SYMBOL", secondaryKey: "NAME", nameField: "NAME" },
    };

    const sourceKeys = sourceKeyMap[config.source] || sourceKeyMap.SEC;

    const [stockQuery, setStockQuery] = useState("");
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [stockLoading, setStockLoading] = useState(false);
    const stockAbortRef = useRef<AbortController | null>(null);
    const stockDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        if (stockDebounceRef.current) clearTimeout(stockDebounceRef.current);
        if (stockAbortRef.current) stockAbortRef.current.abort();
        const query = stockQuery.trim();
        const source = config.source;
        stockDebounceRef.current = setTimeout(async () => {
            if (!query) {
                setStockItems([]);
                setStockLoading(false);
                return;
            }
            setStockLoading(true);
            const controller = new AbortController();
            stockAbortRef.current = controller;
            try {
                const params = new URLSearchParams({ query, source });
                const response = await fetch(`${API_BASE}/stocks/search?${params}`, {
                    signal: controller.signal,
                });
                const data = await response.json();
                if (!controller.signal.aborted) setStockItems(Array.isArray(data) ? data : []);
            } catch (err: any) {
                if (err?.name !== "AbortError") setStockItems([]);
            } finally {
                if (!controller.signal.aborted) setStockLoading(false);
            }
        }, 300);
        return () => {
            if (stockDebounceRef.current) clearTimeout(stockDebounceRef.current);
        };
    }, [stockQuery, config.source]);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [defaultModel, setDefaultModel] = useState("");
    const [selectedModel, setSelectedModel] = useState("");
    const [modelError, setModelError] = useState<string | null>(null);
    const [modelQuery, setModelQuery] = useState("");
    const [outputTemplates, setOutputTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState("");

    useEffect(() => {
        HarnessAgentService.listTemplates().then(setOutputTemplates).catch(() => setOutputTemplates([]));
    }, []);

    const fetchModels = useCallback(async () => {
        try {
            const [modelsData, settings, def] = await Promise.all([
                AnalysisService.getAvailableModels(),
                SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
                AnalysisService.getDefaultModel().catch(() => ({ model_id: "" })),
            ]);
            const allModels = Array.isArray(modelsData) ? modelsData : [];
            const keys = Object.keys(settings?.llm_keys || {});
            const llmKeys = keys.filter((k) => k !== "tavily");
            const models = llmKeys.length > 0
                ? allModels.filter((m: string) => {
                    const provider = m.split("/")[0];
                    return provider === "ollama" || llmKeys.includes(provider) || isServerFreeModel(m);
                })
                : allModels;
            setAvailableModels(models);
            const preferred = models.includes(PREFERRED_DEFAULT_MODEL)
                ? PREFERRED_DEFAULT_MODEL
                : models.includes(def?.model_id || "") ? def.model_id : "";
            setDefaultModel(preferred);
            setSelectedModel(prev => {
                if (prev && models.includes(prev)) return prev;
                return preferred || models[0] || "";
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
        setStockQuery("");
        setStockItems([]);
        setConfig(prev => ({
            ...prev,
            source: value,
            share: "",
            shareName: "",
        }));
    }, []);

    const fetchAvailableAgents = useCallback(async () => {
        try {
            const data = await HarnessAgentService.list();
            setAvailableAgents(Array.isArray(data) ? data : []);
        } catch {
            setAvailableAgents([]);
        }
    }, []);

    const checkModel = useCallback(async (modelId: string) => {
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
        }
    }, []);

    useEffect(() => {
        fetchAvailableAgents();
        fetchModels();
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id, fetchAvailableAgents, fetchModels]);

    const [starting, setStarting] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [selectedAgentId, setSelectedAgentId] = useState<string>("");
    const selectedAgent = useMemo(
        () => availableAgents.find((a) => a.id === selectedAgentId) || null,
        [availableAgents, selectedAgentId]
    );

    const runAnalysis = async () => {
        if (starting || status !== "EMPTY") return;
        if (!config.source || !config.share || !selectedAgentId) return;

        setStarting(true);
        setRunError(null);
        try {
            const isValid = await checkModel(selectedModel || availableModels[0]);
            if (!isValid) return;

            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                agent_id: selectedAgentId,
                model: selectedModel || undefined,
                source: config.source,
                output_template_id: selectedTemplateId || undefined,
            });

            if (result?.id) {
                navigate(`/analysis-result/${result.id}`);
            } else {
                setRunError(result?.errors?.join("; ") || "Run failed");
            }
        } catch (error: any) {
            console.error("Run analysis error:", error);
            setRunError(
                error?.response?.data?.error ||
                error?.message ||
                "The run could not be started. Check your selection and try again."
            );
            setStatus("ERROR");
        } finally {
            setStarting(false);
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
                    source: exchangeSrc,
                }));

                setCorrelationId(analysisId);

                if (Array.isArray(data.steps)) setSteps(data.steps);
                const runStart = data.started_at || data.created_at;
                if (runStart) setStartedAt(+new Date(runStart));

                const s = (data.status || "").toLowerCase();
                if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success" || s === "budget_exhausted") {
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
                        if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success" || s === "budget_exhausted") {
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

    const isConfigComplete = config.share !== "" && !!selectedAgentId;
    const canRunAnalysis = isConfigComplete;

    return (
        <Box
            bg="var(--surface-canvas)"
            minH="100vh"
            fontFamily="var(--font-body)"
        >
            {starting && (
                <Box
                    position="fixed"
                    inset="0"
                    zIndex={50}
                    bg="var(--surface-canvas)"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    opacity={0.92}
                >
                    <Flex direction="column" align="center" gap={3}>
                        <Spinner size="lg" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="13px" fontFamily="var(--font-body)" color="var(--ink-secondary)">
                            Running {selectedAgent?.name || "agent"}…
                        </Text>
                    </Flex>
                </Box>
            )}
            <Box py={{ base: 4, md: 6 }}>
                <AnimatePresence initial={false}>
                    {status === "ERROR" && runError && (
                        <Box
                            as={motion.div}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: dur.base, ease }}
                            overflow="hidden"
                            mb={4}
                        >
                            <Alert variant="destructive">
                                <AlertTitle>Analysis did not start</AlertTitle>
                                <AlertDescription>{runError}</AlertDescription>
                            </Alert>
                        </Box>
                    )}
                </AnimatePresence>

                <Flex direction={{ base: "column", lg: "row" }} gap={{ base: 0, lg: 6 }} align="flex-start">
                    <Flex direction="column" flex={1} minW={0}>
                        <Text fontSize="15px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-primary)" mb={3}>
                            Choose Run config
                        </Text>
                        <Box
                            as={motion.div}
                            variants={stagger}
                            initial="initial"
                            animate="animate"
                            display="flex"
                            flexDirection="column"
                        >
                            {/* Company */}
                            <Box
                                as={motion.div}
                                variants={staggerItem}
                                py={{ base: 5, md: 6 }}
                            >
                                <Flex direction={{ base: "column", md: "row" }} gap={{ base: 5, md: 6 }}>
                                    <Box w={{ base: "full", md: "150px" }} flexShrink={0}>
                                        <FieldLabel>Market</FieldLabel>
                                        <MenuDropdown value={config.source} placeholder="Market">
                                            {(close) => (
                                                <Box>
                                                    {(["NSE", "SEC"] as const).map((m) => (
                                                        <DropdownItem
                                                            key={m}
                                                            label={m === "SEC" ? "SEC · United States" : "NSE · India"}
                                                            selected={config.source === m}
                                                            logo={<SourceMark source={m.toLowerCase() as "nse" | "sec"} size={16} />}
                                                            onClick={() => {
                                                                handleSourceChange(m);
                                                                close();
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                            )}
                                        </MenuDropdown>
                                    </Box>
                                    <Box flex={1} minW={0}>
                                        <FieldLabel>Company</FieldLabel>
                                        <MenuDropdown
                                            value={config.share ? `${config.shareName || config.share}` : null}
                                            placeholder="Search companies..."
                                            search={{
                                                value: stockQuery,
                                                onChange: setStockQuery,
                                                placeholder: config.source === "SEC" ? "Search US stocks" : "Search Indian stocks",
                                            }}
                                        >
                                            {(close) => (
                                                <Box>
                                                    {stockLoading && (
                                                        <Flex align="center" justify="center" gap={2} py={4} fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                                            <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
                                                            Searching…
                                                        </Flex>
                                                    )}
                                                    {!stockLoading && stockItems.length === 0 && (
                                                        <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" textAlign="center" py={3}>
                                                            {stockQuery ? `Nothing matches "${stockQuery}".` : "Start typing to search."}
                                                        </Text>
                                                    )}
                                                    {stockItems.map((stock: any) => (
                                                        <DropdownItem
                                                            key={stock[sourceKeys.mainKey]}
                                                            label={stock[sourceKeys.mainKey]}
                                                            sub={stock[sourceKeys.secondaryKey]}
                                                            selected={stock[sourceKeys.mainKey] === config.share}
                                                            logo={<TickerLogo symbol={stock[sourceKeys.mainKey]} size={18} />}
                                                            onClick={() => {
                                                                handleConfigChange("share", stock[sourceKeys.mainKey], stock);
                                                                close();
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                            )}
                                        </MenuDropdown>
                                    </Box>
                                </Flex>
                            </Box>

                            {/* Agent + Model, side by side */}
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 0, md: 6 }} align="flex-start">
                            <Box
                                as={motion.div}
                                variants={staggerItem}
                                py={{ base: 5, md: 6 }}
                                flex={1}
                                minW={0}
                            >
                                <StepHeader title="Agent" done={!!selectedAgentId} />
                                <Box>
                                    <MenuDropdown
                                        value={selectedAgent?.name || null}
                                        placeholder="Select an agent"
                                    >
                                        {(close) => (
                                            <Box>
                                                {availableAgents.length === 0 && (
                                                    <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" textAlign="center" py={3}>
                                                        No agents found. Create one in the agent console first.
                                                    </Text>
                                                )}
                                                {availableAgents.map((agent) => (
                                                    <DropdownItem
                                                        key={agent.id}
                                                        label={agent.name}
                                                        selected={agent.id === selectedAgentId}
                                                        logo={<AgentAvatar agent={agent} size={18} />}
                                                        onClick={() => {
                                                            setSelectedAgentId(agent.id);
                                                            close();
                                                        }}
                                                    />
                                                ))}
                                            </Box>
                                        )}
                                    </MenuDropdown>
                                </Box>
                            </Box>

                            {/* Model */}
                            <Box
                                as={motion.div}
                                variants={staggerItem}
                                py={{ base: 5, md: 6 }}
                                flex={1}
                                minW={0}
                            >
                                <StepHeader title="Model" done={!!selectedModel} />
                                <MenuDropdown
                                    value={selectedModel ? modelName(selectedModel) : null}
                                    placeholder="Select model"
                                    logo={selectedModel ? <ModelLogo model={selectedModel} size={16} /> : undefined}
                                    search={{ value: modelQuery, onChange: setModelQuery, placeholder: "Search models" }}
                                >
                                    {(close) => (
                                        <Box>
                                            {availableModels.length === 0 && (
                                                <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" textAlign="center" py={3}>
                                                    No models available
                                                </Text>
                                            )}
                                            {(() => {
                                                const q = modelQuery.trim().toLowerCase();
                                                const matching = q
                                                    ? availableModels.filter((m) =>
                                                        m.toLowerCase().includes(q) || modelName(m).toLowerCase().includes(q) ||
                                                        providerLabel(modelPrefix(m)).toLowerCase().includes(q))
                                                    : availableModels;
                                                const groups = new Map<string, string[]>();
                                                for (const m of matching) {
                                                    const p = modelPrefix(m);
                                                    if (!groups.has(p)) groups.set(p, []);
                                                    groups.get(p)!.push(m);
                                                }
                                                const order = [...groups.keys()];
                                                if (defaultModel && !q) {
                                                    const dp = modelPrefix(defaultModel);
                                                    if (order.includes(dp)) {
                                                        order.splice(order.indexOf(dp), 1);
                                                        order.unshift(dp);
                                                        groups.set(dp, [defaultModel, ...groups.get(dp)!.filter(m => m !== defaultModel)]);
                                                    }
                                                }
                                                if (matching.length === 0) {
                                                    return (
                                                        <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" textAlign="center" py={3}>
                                                            Nothing matches "{modelQuery}".
                                                        </Text>
                                                    );
                                                }
                                                return order.map((prefix) => (
                                                    <Box key={prefix}>
                                                        <Text fontSize="10px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-tertiary)" px={3} pt={2} pb={1}>
                                                            {providerLabel(prefix)}
                                                        </Text>
                                                        {groups.get(prefix)!.map((m) => (
                                                            <DropdownItem
                                                                key={m}
                                                                label={modelName(m)}
                                                                sub={m}
                                                                selected={m === selectedModel}
                                                                logo={<ModelLogo model={m} size={16} />}
                                                                onClick={() => {
                                                                    setSelectedModel(m);
                                                                    setModelError(null);
                                                                    setModelQuery("");
                                                                    close();
                                                                }}
                                                            />
                                                        ))}
                                                    </Box>
                                                ));
                                            })()}
                                        </Box>
                                    )}
                                </MenuDropdown>
                                {modelError && (
                                    <Text mt={2} fontSize="11px" fontFamily="var(--font-body)" color="var(--signal-negative)">
                                        {modelError}
                                    </Text>
                                )}
                            </Box>

                            {/* Output format (plain Box — same motion typing gap as the steps above, minus one error) */}
                            <Box py={{ base: 5, md: 6 }} flex={1} minW={0}>
                                <StepHeader title="Output format" done={!!selectedTemplateId} />
                                <MenuDropdown
                                    value={outputTemplates.find((t) => t.id === selectedTemplateId)?.name ?? null}
                                    placeholder="Contract only"
                                >
                                    {(close) => (
                                        <Box>
                                            <DropdownItem
                                                label="Contract only"
                                                sub="Output contract, no template"
                                                selected={!selectedTemplateId}
                                                onClick={() => {
                                                    setSelectedTemplateId("");
                                                    close();
                                                }}
                                            />
                                            {outputTemplates.map((t) => (
                                                <DropdownItem
                                                    key={t.id}
                                                    label={t.name}
                                                    sub={t.description || t.id}
                                                    selected={t.id === selectedTemplateId}
                                                    onClick={() => {
                                                        setSelectedTemplateId(t.id);
                                                        close();
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    )}
                                </MenuDropdown>
                            </Box>
                            </Flex>
                        </Box>

                        <AnimatePresence mode="wait" initial={false}>
                            {status === "PENDING" && correlationId && (
                                <Box
                                    key="progress"
                                    as={motion.div}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: dur.base, ease }}
                                    overflow="hidden"
                                    mt={4}
                                    pt={4}
                                >
                                    <Flex justify="space-between" align="center" mb={4}>
                                        <Flex align="center" gap={2.5}>
                                            <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                                            <Text fontSize="13px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-secondary)">
                                                Analysis in progress.
                                            </Text>
                                        </Flex>
                                        {elapsedTime > 0 && (
                                            <Text
                                                fontSize="12px"
                                                fontFamily="var(--font-body)"
                                                color="var(--ink-tertiary)"
                                                fontVariantNumeric="tabular-nums"
                                                whiteSpace="nowrap"
                                            >
                                                {formatSeconds(elapsedTime)}
                                            </Text>
                                        )}
                                    </Flex>
                                    <Box maxW="400px" mb={5}>
                                        <Progress value={runProgressPct(steps)}>
                                            <ProgressLabel>Progress</ProgressLabel>
                                            <ProgressValue />
                                        </Progress>
                                    </Box>
                                    <AgentActivity
                                        title={`Analyzing ${config.shareName || config.share}`}
                                        subtitle={`${selectedModel || "default model"} · gathering data, searching, scoring`}
                                        streamUrl={`/analysis/${correlationId}/stream`}
                                        steps={steps}
                                        startedAt={startedAt}
                                        active
                                    />
                                </Box>
                            )}
                        </AnimatePresence>

                        {loading && (
                            <Flex justify="center" align="center" gap={3} py={16} color="var(--ink-secondary)">
                                <Spinner size="sm" borderWidth="2px" />
                                <Text fontSize="13px" fontFamily="var(--font-body)">Loading analysis data…</Text>
                            </Flex>
                        )}
                    </Flex>

                    {/* Rule between the picker and its summary: vertical beside
                        lg, horizontal once the columns stack. */}
                    <Box
                        w={{ base: "full", lg: "1px" }}
                        h={{ base: "1px", lg: "auto" }}
                        bg="var(--hairline)"
                        alignSelf="stretch"
                    />

                    <Box
                        w={{ base: "full", lg: "320px" }}
                        flexShrink={0}
                        position={{ base: "static", lg: "sticky" }}
                        top={{ base: "auto", lg: "32px" }}
                    >
                        <AnalysisSummary
                            status={status}
                            resuming={!!id && status === "EMPTY"}
                            source={config.source}
                            share={config.share}
                            shareName={config.shareName}
                            agentName={selectedAgent?.name || null}
                            model={selectedModel || ""}
                            canRun={canRunAnalysis && !starting}
                            onRun={runAnalysis}
                            elapsedTime={elapsedTime}
                            analysisDuration={analysisDuration}
                            correlationId={correlationId}
                            onReset={() => {
                                navigate("/analysis");
                                setStatus("EMPTY");
                                setRunError(null);
                                setSteps([]);
                            }}
                        />
                    </Box>
                </Flex>
            </Box>
        </Box>
    );
}
