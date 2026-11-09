import { Flex, Text, Spinner, Box } from "@chakra-ui/react";
import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Building2, Cpu, Bot, CircleCheck, CircleDashed, CalendarClock } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, API_BASE, type ScheduleRow } from "@/db";
import { HarnessAgentService, type HarnessAgent } from "@/lib/harnessAgents";
import { formatSeconds } from "@/utils";
import { ModelLogo } from "@/lib/modelLogos";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";
import { TickerLogo } from "@/lib/sourceLogos";
import { toaster } from "@/compat/ui";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    MenuDropdown,
    DropdownItem,
    PrimaryButton,
    SecondaryButton,
    ResumingButton,
} from "./shared/AnalysisControls";
import { Input } from "@/components/ui/input";

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

// One config row: tick/pending marker + connector rail on the left, label
// pushed left and its control pushed right.
function StepRow({ label, icon, done, first, last, children }: {
    label: string;
    icon?: ReactNode;
    done: boolean;
    first?: boolean;
    last?: boolean;
    children: ReactNode;
}) {
    return (
        <Flex as={motion.div} variants={staggerItem} gap={3} align="stretch">
            <Flex direction="column" align="center" w="18px" flexShrink={0} aria-hidden="true">
                <Box w="1px" flex={1} bg={first ? "transparent" : "var(--hairline)"} />
                {done ? (
                    <CircleCheck size={16} color="var(--signal-positive)" />
                ) : (
                    <CircleDashed size={16} color="var(--ink-tertiary)" />
                )}
                <Box w="1px" flex={1} bg={last ? "transparent" : "var(--hairline)"} />
            </Flex>
            <Flex
                direction={{ base: "column", md: "row" }}
                justify="space-between"
                align={{ base: "stretch", md: "center" }}
                gap={{ base: 2, md: 4 }}
                flex={1}
                minW={0}
                py={3.5}
            >
                <Flex align="center" gap={2} minW={0}>
                    {icon && (
                        <span style={{ display: "inline-flex", flexShrink: 0, color: "var(--ink-tertiary)" }}>
                            {icon}
                        </span>
                    )}
                    <Text
                        fontSize="12.5px"
                        fontFamily="var(--font-body)"
                        fontWeight={500}
                        color="var(--ink-secondary)"
                        whiteSpace="nowrap"
                    >
                        {label}
                    </Text>
                </Flex>
                <Box w={{ base: "full", md: "320px" }} minW={0}>
                    {children}
                </Box>
            </Flex>
        </Flex>
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
    share: string;
    shareName: string;
    model: string;
    skillsLabel: string;
    skillsIcon?: React.ReactNode;
    budgetLabel: string;
    canRun: boolean;
    daily: boolean;
    onRun: () => void;
    elapsedTime: number;
    analysisDuration: string;
    correlationId: string;
    onReset: () => void;
}) {
    const { status } = props;

    const companyLabel = props.share ? (props.shareName || props.share) : "Not set";
    const modelLabel = props.model ? modelName(props.model) : "Not set";
    const modelSub = props.model ? `${providerLabel(modelPrefix(props.model))} · ${props.model}` : undefined;

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
                label="Model"
                icon={props.model ? <ModelLogo model={props.model} size={16} /> : undefined}
                value={modelLabel}
                sub={modelSub}
                muted={!props.model}
            />
            <SummaryRow label="Skill" icon={props.skillsIcon} value={props.skillsLabel} muted={props.skillsLabel === "Agent's skill"} />
            <SummaryRow label="Budget" value={props.budgetLabel} muted={props.budgetLabel === "Default"} />
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
                        {props.daily ? "Schedule daily run" : "Run Now"}
                    </PrimaryButton>
                )}
            </Box>
        </Box>
    );
}

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

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

    // CLI parity: the run page passes the same flags as
    // `cli.ts --real --symbol --model --max-steps --max-tokens`.
    // Market is fixed to SEC (the CLI's --source default); the persona comes
    // from the server's seeded default agent — the CLI has no --agent either.
    const [config, setConfig] = useState({
        source: "SEC",
        share: "",
        shareName: "",
    });

    const [stockQuery, setStockQuery] = useState("");
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [stockLoading, setStockLoading] = useState(false);
    const stockAbortRef = useRef<AbortController | null>(null);
    const stockDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        if (stockDebounceRef.current) clearTimeout(stockDebounceRef.current);
        if (stockAbortRef.current) stockAbortRef.current.abort();
        const query = stockQuery.trim();
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
                // One search across BOTH markets — the picked row decides the source.
                const params = new URLSearchParams({ query });
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
    }, [stockQuery]);

    const [model, setModel] = useState("opencode/deepseek-v4.1-flash");
    const [modelError, setModelError] = useState<string | null>(null);
    const [maxSteps, setMaxSteps] = useState("");
    const [maxTokens, setMaxTokens] = useState("");
    // Configured harness agents (the Agents page) — first = server default.
    const [agents, setAgents] = useState<HarnessAgent[]>([]);
    const [agentId, setAgentId] = useState("");

    useEffect(() => {
        HarnessAgentService.list()
            .then((list) => {
                setAgents(list);
                setAgentId((prev) => prev || list[0]?.id || "");
            })
            .catch(() => setAgents([]));
    }, []);

    const handleStockPick = useCallback((stock: any) => {
        // Rows from /stocks/search always carry both key styles; pick from the
        // row itself so NSE/SEC rows resolve correctly regardless of prior config.
        const src = String(stock.source || "").toUpperCase() === "NSE" ? "NSE" : "SEC";
        setConfig(prev => ({
            ...prev,
            source: src,
            share: stock.ticker || stock.SYMBOL || "",
            shareName: stock.name || stock.NAME || stock.ticker || stock.SYMBOL || "",
        }));
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
        if (id) {
            fetchAnalysisData(id);
        }
        // fetchAnalysisData is a stable useCallback; effect key is the route id.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const [starting, setStarting] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [runMode, setRunMode] = useState<"once" | "daily">("once");
    const [scheduleTime, setScheduleTime] = useState("21:00");
    const [schedules, setSchedules] = useState<ScheduleRow[]>([]);

    const loadSchedules = useCallback(() => {
        AnalysisService.listSchedules().then(setSchedules).catch(() => {});
    }, []);

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    const runAnalysis = async () => {
        if (starting || status !== "EMPTY") return;
        if (!config.share) return;

        setStarting(true);
        setRunError(null);
        try {
            const isValid = await checkModel(model.trim());
            if (!isValid) return;

            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                model: model.trim(),
                source: config.source,
                max_steps: maxSteps ? Number(maxSteps) : undefined,
                max_tokens: maxTokens ? Number(maxTokens) : undefined,
                agent_id: selectedAgent?.id,
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

    const scheduleDaily = async () => {
        if (starting || status !== "EMPTY" || !config.share || !scheduleTime) return;

        setStarting(true);
        setRunError(null);
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            await AnalysisService.createSchedule({
                symbol: config.share,
                share_name: config.shareName || config.share,
                source: config.source,
                model: model.trim(),
                agent_id: selectedAgent?.id,
                max_steps: maxSteps ? Number(maxSteps) : undefined,
                max_tokens: maxTokens ? Number(maxTokens) : undefined,
                time: scheduleTime,
                timezone,
            });
            toaster.create({
                title: "Daily run scheduled",
                description: `${config.shareName || config.share} · every day at ${scheduleTime} (${timezone})`,
                type: "success",
            });
            loadSchedules();
        } catch (error) {
            console.error("Schedule error:", error);
            toaster.create({
                title: "Couldn't schedule the run",
                description:
                    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                    (error as Error)?.message ||
                    "The schedule could not be created.",
                type: "error",
            });
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

                if (data.model) setModel(data.model);
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

    const isConfigComplete = config.share !== "" && !!model.trim();
    const canRunAnalysis = isConfigComplete && (runMode === "once" || !!scheduleTime);
    // Explicit pick, else the first configured agent (the server default).
    const selectedAgent = agents.find((a) => a.id === agentId) ?? agents[0] ?? null;
    const skillsLabel = selectedAgent?.name ?? "Agent's skill";
    const budgetLabel =
        [maxSteps && `${maxSteps} steps`, maxTokens && `${Number(maxTokens).toLocaleString()} tokens`]
            .filter(Boolean)
            .join(" · ") || "Default";

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
                            Running analysis…
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
                            {/* Schedule — once (default) or daily at a local time */}
                            <StepRow label="Schedule" icon={<CalendarClock size={13} />} done={runMode === "once" || !!scheduleTime} first>
                                <Flex gap={2} align="center">
                                    <ToggleGroup
                                        type="single"
                                        value={runMode}
                                        onValueChange={(v) => v && setRunMode(v as "once" | "daily")}
                                        className="h-8 flex-none rounded-[10px] gap-0.5 border border-[var(--hairline)] bg-transparent p-0.5"
                                    >
                                        <ToggleGroupItem
                                            value="once"
                                            className="h-7 rounded-[8px] px-3 text-[12px] font-normal data-[state=on]:bg-[var(--surface-recessed)] data-[state=on]:text-[var(--ink-primary)] data-[state=on]:shadow-none"
                                        >
                                            Once
                                        </ToggleGroupItem>
                                        <ToggleGroupItem
                                            value="daily"
                                            className="h-7 rounded-[8px] px-3 text-[12px] font-normal data-[state=on]:bg-[var(--surface-recessed)] data-[state=on]:text-[var(--ink-primary)] data-[state=on]:shadow-none"
                                        >
                                            Daily
                                        </ToggleGroupItem>
                                    </ToggleGroup>
                                    {runMode === "daily" && (
                                        <Input
                                            type="time"
                                            value={scheduleTime}
                                            onChange={(e) => setScheduleTime(e.target.value)}
                                            aria-label="Daily run time"
                                            data-testid="run-schedule-time"
                                            className="h-8 min-w-0 flex-1 rounded-[10px]"
                                        />
                                    )}
                                </Flex>
                            </StepRow>

                            {/* Company */}
                            <StepRow label="Company" icon={<Building2 size={13} />} done={!!config.share}>
                                <MenuDropdown
                                    value={config.share ? `${config.shareName || config.share}` : null}
                                    placeholder="Search company or symbol…"
                                    search={{
                                        value: stockQuery,
                                        onChange: setStockQuery,
                                        placeholder: "Search by company name or symbol…",
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
                                            {stockItems.map((stock: any) => {
                                                const sym = stock.ticker || stock.SYMBOL || "";
                                                const nm = stock.name || stock.NAME || sym;
                                                const market = String(stock.source || "").toLowerCase() === "nse" ? "NSE" : "SEC";
                                                return (
                                                    <DropdownItem
                                                        key={`${market}-${sym}`}
                                                        label={nm}
                                                        sub={sym}
                                                        tag={market}
                                                        selected={sym === config.share && market === config.source}
                                                        logo={<TickerLogo symbol={sym} size={18} />}
                                                        onClick={() => {
                                                            handleStockPick(stock);
                                                            close();
                                                        }}
                                                    />
                                                );
                                            })}
                                        </Box>
                                    )}
                                </MenuDropdown>
                            </StepRow>

                            {/* Agent — the configured harness agents (Agents page) */}
                            {agents.length > 0 && (
                                <StepRow label="Agent" icon={<Bot size={13} />} done={!!selectedAgent}>
                                    <MenuDropdown
                                        value={selectedAgent?.name ?? null}
                                        placeholder="Choose agent…"
                                    >
                                        {(close) => (
                                            <Box>
                                                {agents.map((a) => (
                                                    <DropdownItem
                                                        key={a.id}
                                                        label={a.name}
                                                        sub={a.skillIds.join(", ") || undefined}
                                                        selected={a.id === selectedAgent?.id}
                                                        onClick={() => {
                                                            setAgentId(a.id);
                                                            close();
                                                        }}
                                                    />
                                                ))}
                                            </Box>
                                        )}
                                    </MenuDropdown>
                                </StepRow>
                            )}

                            {/* Model + budget — CLI's --model, --max-steps, --max-tokens */}
                            <StepRow label="Model" icon={<Cpu size={13} />} done={!!model.trim()}>
                                <Input
                                    value={model}
                                    onChange={(e) => {
                                        setModel(e.target.value);
                                        setModelError(null);
                                    }}
                                    placeholder="provider/model"
                                    aria-label="Model id"
                                    data-testid="run-model"
                                    className="h-8 rounded-[10px]"
                                />
                                {modelError && (
                                    <Text mt={2} fontSize="11px" fontFamily="var(--font-body)" color="var(--signal-negative)">
                                        {modelError}
                                    </Text>
                                )}
                            </StepRow>

                            <StepRow label="Max steps" done>
                                <Input
                                    type="number"
                                    min={1}
                                    value={maxSteps}
                                    onChange={(e) => setMaxSteps(e.target.value)}
                                    placeholder="20"
                                    aria-label="Max steps"
                                    data-testid="run-max-steps"
                                    className="h-8 rounded-[10px]"
                                />
                            </StepRow>

                            <StepRow label="Max tokens" done last>
                                <Input
                                    type="number"
                                    min={1000}
                                    value={maxTokens}
                                    onChange={(e) => setMaxTokens(e.target.value)}
                                    placeholder="200000"
                                    aria-label="Max tokens"
                                    data-testid="run-max-tokens"
                                    className="h-8 rounded-[10px]"
                                />
                            </StepRow>
                        </Box>

                        {status === "EMPTY" && schedules.length > 0 && (
                            <Box mt={4} pt={4} borderTop="1px solid var(--hairline)">
                                <Text fontSize="12.5px" fontFamily="var(--font-body)" fontWeight={500} color="var(--ink-secondary)" mb={1}>
                                    Active schedules
                                </Text>
                                {schedules.map((s) => (
                                    <Flex key={s.id} align="center" gap={2.5} py={1.5}>
                                        <TickerLogo symbol={s.symbol} size={16} />
                                        <Text
                                            fontSize="13px"
                                            fontFamily="var(--font-body)"
                                            color="var(--ink-primary)"
                                            minW={0}
                                            overflow="hidden"
                                            textOverflow="ellipsis"
                                            whiteSpace="nowrap"
                                        >
                                            {s.share_name || s.symbol}
                                        </Text>
                                        <Text fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)" ml="auto" whiteSpace="nowrap">
                                            Daily at {s.time} · {s.timezone}
                                        </Text>
                                        <Box
                                            as="button"
                                            aria-label={`Delete schedule for ${s.share_name || s.symbol}`}
                                            onClick={async () => {
                                                try {
                                                    await AnalysisService.deleteSchedule(s.id);
                                                    loadSchedules();
                                                } catch {
                                                    // best-effort delete; the list refetches next time
                                                }
                                            }}
                                            display="flex"
                                            flexShrink={0}
                                            color="var(--ink-tertiary)"
                                            _hover={{ color: "var(--signal-negative)" }}
                                        >
                                            <MdClose size={14} />
                                        </Box>
                                    </Flex>
                                ))}
                            </Box>
                        )}

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
                                        subtitle={`${model} · gathering data, searching, scoring`}
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
                            share={config.share}
                            shareName={config.shareName}
                            model={model.trim()}
                            skillsLabel={skillsLabel}
                            skillsIcon={
                                selectedAgent ? <AgentAvatar agent={selectedAgent.id} size={16} /> : undefined
                            }
                            budgetLabel={budgetLabel}
                            canRun={canRunAnalysis && !starting}
                            daily={runMode === "daily"}
                            onRun={runMode === "daily" ? scheduleDaily : runAnalysis}
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
