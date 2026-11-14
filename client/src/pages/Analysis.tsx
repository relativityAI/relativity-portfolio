import { Flex, Text, Spinner, Box } from "@chakra-ui/react";
import { useEffect, useState, useCallback, useRef, type ReactNode, type CSSProperties } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, API_BASE, type ScheduleRow } from "@/db";
import { HarnessAgentService, type HarnessAgent } from "@/lib/harnessAgents";
import { formatSeconds } from "@/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { TickerLogo } from "@/lib/sourceLogos";
import { AgentAvatar } from "@/components/shared/AgentCell";
import { Play, CalendarDays } from "lucide-react";
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

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";

const microLabel = {
    fontSize: "11px",
    fontFamily: "var(--font-body)",
    fontWeight: 400,
    color: "var(--ink-tertiary)",
};

const HOUR_CELLS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_STEPS = [0, 15, 30, 45];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Form section: a quiet title over whitespace-separated rows — no rules, no fills. */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Box pt={4}>
            <Text px={4} pb={1.5} fontSize="14px" fontWeight={500} color="var(--ink-secondary)">
                {title}
            </Text>
            {children}
        </Box>
    );
}

/** One label | field row — the label column aligns the fields; spacing does the rest. */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Flex direction={{ base: "column", md: "row" }}>
            <Box
                w={{ base: "full", md: "176px" }}
                flexShrink={0}
                px={4}
                py={{ base: 1.5, md: 3 }}
                display="flex"
                alignItems="center"
            >
                <Text {...microLabel}>{label}</Text>
            </Box>
            <Flex direction="column" gap={1.5} justify="center" flex={1} minW={0} px={3} py={{ base: 1, md: 2 }}>
                {children}
            </Flex>
        </Flex>
    );
}

/** Scheduled-mode picker: 24-hour grid + 15-minute steps, browser-local zone. */
function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [h, m] = value.split(":").map(Number);
    const set = (nh: number, nm: number) => onChange(`${pad2(nh)}:${pad2(nm)}`);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return (
        <Box w="full">
            <Flex justify="space-between" align="baseline" gap={2} mb={2}>
                <Text {...microLabel}>Every day at</Text>
                <Text fontSize="24px" fontWeight={300} lineHeight={1} color="var(--ink-primary)" fontVariantNumeric="tabular-nums">
                    {value}
                </Text>
            </Flex>
            <Box
                display="grid"
                gridTemplateColumns={{ base: "repeat(6, 1fr)", md: "repeat(12, 1fr)" }}
                gap={1}
            >
                {HOUR_CELLS.map((hr) => (
                    <Box
                        as="button"
                        key={hr}
                        onClick={() => set(hr, m)}
                        aria-pressed={hr === h}
                        aria-label={`${pad2(hr)}:00`}
                        border="none"
                        py={1}
                        borderRadius="6px"
                        bg={hr === h ? "var(--ink-primary)" : "transparent"}
                        color={hr === h ? "var(--surface-canvas)" : "var(--ink-secondary)"}
                        fontSize="12px"
                        fontWeight={300}
                        fontFamily="var(--font-body)"
                        cursor="pointer"
                        _hover={{ color: hr === h ? "var(--surface-canvas)" : "var(--ink-primary)" }}
                    >
                        {pad2(hr)}
                    </Box>
                ))}
            </Box>
            <Flex align="center" gap={1.5} mt={2} flexWrap="wrap">
                <Text {...microLabel} mr={1}>Minute</Text>
                {MINUTE_STEPS.map((mi) => (
                    <Box
                        as="button"
                        key={mi}
                        onClick={() => set(h, mi)}
                        aria-pressed={mi === m}
                        border="none"
                        px={2}
                        py={0.5}
                        borderRadius="6px"
                        bg={mi === m ? "var(--ink-primary)" : "transparent"}
                        color={mi === m ? "var(--surface-canvas)" : "var(--ink-secondary)"}
                        fontSize="11px"
                        fontWeight={300}
                        fontFamily="var(--font-body)"
                        cursor="pointer"
                    >
                        :{pad2(mi)}
                    </Box>
                ))}
                <Text fontSize="11px" fontWeight={300} color="var(--ink-tertiary)" ml="auto">
                    {tz}
                </Text>
            </Flex>
        </Box>
    );
}

/** Form action bar: status readout left, actions right — the run button lives here. */
function RunFooter({
    status,
    resuming,
    statusLine,
    canRun,
    scheduled,
    onRun,
    onReset,
    elapsedTime,
    analysisDuration,
    correlationId,
}: {
    status: StatusType;
    resuming: boolean;
    statusLine: string;
    canRun: boolean;
    scheduled: boolean;
    onRun: () => void;
    onReset: () => void;
    elapsedTime: number;
    analysisDuration: string;
    correlationId: string;
}) {
    const action: CSSProperties = { width: "auto", height: "40px", padding: "0 22px", borderRadius: "6px", boxShadow: "none", fontWeight: 300 };
    const ghost: CSSProperties = { height: "36px", borderRadius: "6px", fontWeight: 300, border: "none", background: "transparent" };

    return (
        <Flex align="center" justify="space-between" gap={3} flexWrap="wrap" px={4} py={3} mt={2} minH="60px">
            <Flex align="center" gap={2} minW={0} flex={1}>
                {status === "EMPTY" && (
                    <Text
                        fontSize="12px"
                        fontWeight={300}
                        color={statusLine ? "var(--ink-secondary)" : "var(--ink-tertiary)"}
                        minW={0}
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                    >
                        {statusLine || "Select a company to enable the run"}
                    </Text>
                )}
                {status === "PENDING" && (
                    <>
                        <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--ink-primary)">
                            {resuming ? "Resuming" : "Running"}
                        </Text>
                        {elapsedTime > 0 && (
                            <Text fontSize="12px" fontWeight={300} color="var(--ink-tertiary)" fontVariantNumeric="tabular-nums" ml="auto">
                                {formatSeconds(elapsedTime)}
                            </Text>
                        )}
                    </>
                )}
                {status === "COMPLETED" && (
                    <>
                        <MdCheck size={16} color="var(--signal-positive)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--ink-primary)">Complete</Text>
                        {analysisDuration && (
                            <Text fontSize="12px" fontWeight={300} color="var(--ink-tertiary)" ml="auto">{analysisDuration}</Text>
                        )}
                    </>
                )}
                {status === "ERROR" && (
                    <>
                        <MdClose size={16} color="var(--signal-negative)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--signal-negative)">Failed</Text>
                    </>
                )}
            </Flex>
            <Flex align="center" gap={2} flexShrink={0}>
                {status === "EMPTY" &&
                    (resuming ? (
                        <ResumingButton style={action}>
                            <Flex align="center" gap={2}>
                                <Spinner size="sm" borderWidth="2px" />
                                <Text fontSize="13px" fontWeight={300}>Resuming analysis…</Text>
                            </Flex>
                        </ResumingButton>
                    ) : (
                        <PrimaryButton onClick={onRun} disabled={!canRun} style={action}>
                            {scheduled ? <><CalendarDays size={16} /> Schedule daily run</> : <><Play size={16} /> Run analysis</>}
                        </PrimaryButton>
                    ))}
                {status === "PENDING" && (
                    <SecondaryButton onClick={onReset} style={ghost}>Run another</SecondaryButton>
                )}
                {status === "COMPLETED" && (
                    <>
                        {correlationId && (
                            <Link to={`/analysis-result/${correlationId}`} style={{ textDecoration: "none" }}>
                                <PrimaryButton style={action}>View report</PrimaryButton>
                            </Link>
                        )}
                        <SecondaryButton onClick={onReset} style={ghost}>Run again</SecondaryButton>
                    </>
                )}
                {status === "ERROR" && (
                    <>
                        {correlationId && (
                            <Link to={`/analysis-result/${correlationId}`} style={{ textDecoration: "none" }}>
                                <SecondaryButton style={ghost}>View report</SecondaryButton>
                            </Link>
                        )}
                        <SecondaryButton onClick={onReset} style={ghost}>Try again</SecondaryButton>
                    </>
                )}
            </Flex>
        </Flex>
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
    const statusLine = config.share
        ? `${config.share} · ${config.source} · ${runMode === "daily" ? `Daily ${scheduleTime}` : "Single run"}`
        : "";
    const statusChip =
        status === "EMPTY" ? "Draft" : status === "PENDING" ? "Running" : status === "COMPLETED" ? "Complete" : "Failed";

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
            <Box py={{ base: 4, md: 6 }} maxW="960px" mx="auto">
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

                {/* One flat form: title, quiet sections, action bar — spacing only, no rules. */}
                <Box>
                    <Flex align="center" justify="space-between" gap={3} px={4} py={2.5}>
                        <Text fontSize="14px" fontWeight={400} color="var(--ink-primary)">
                            New analysis run
                        </Text>
                        <Text {...microLabel}>{statusChip}</Text>
                    </Flex>

                    <FormSection title="Run settings">
                        <FormRow label="Mode">
                            <ToggleGroup
                                type="single"
                                value={runMode}
                                onValueChange={(v) => v && setRunMode(v as "once" | "daily")}
                                className="h-auto gap-1 border-none bg-transparent p-0"
                            >
                                <ToggleGroupItem
                                    value="once"
                                    className="h-8 rounded-[6px] px-3.5 text-[12px] font-light text-[var(--ink-secondary)] data-[state=on]:bg-[var(--ink-primary)] data-[state=on]:text-[var(--surface-canvas)] data-[state=on]:shadow-none"
                                >
                                    Single
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                    value="daily"
                                    className="h-8 rounded-[6px] px-3.5 text-[12px] font-light text-[var(--ink-secondary)] data-[state=on]:bg-[var(--ink-primary)] data-[state=on]:text-[var(--surface-canvas)] data-[state=on]:shadow-none"
                                >
                                    Scheduled
                                </ToggleGroupItem>
                            </ToggleGroup>
                        </FormRow>
                        {runMode === "daily" && (
                            <FormRow label="Run time">
                                <TimePicker value={scheduleTime} onChange={setScheduleTime} />
                            </FormRow>
                        )}
                        </FormSection>

                    <FormSection title="Company">
                        <FormRow label="Ticker">
                            <MenuDropdown
                                plain
                                logo={config.share ? <TickerLogo symbol={config.share} size={16}/> : undefined}
                                value={config.share ? `${config.source === "NSE" ? "🇮🇳" : "🇺🇸"} ${config.shareName || config.share}` : null}
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
                                            <Text px={3} py={2.5} fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                                Searching…
                                            </Text>
                                        )}
                                        {!stockLoading && stockItems.length === 0 && (
                                            <Text px={3} py={2.5} fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                                {stockQuery ? `Nothing matches “${stockQuery}”.` : "Start typing to search."}
                                            </Text>
                                        )}
                                        {stockItems.map((stock: any) => {
                                            const sym = stock.ticker || stock.SYMBOL || "";
                                            const nm = stock.name || stock.NAME || sym;
                                            const india = String(stock.source || "").toLowerCase() === "nse";
                                            const market = india ? "NSE" : "SEC";
                                            return (
                                                <DropdownItem
                                                    key={`${market}-${sym}`}
                                                    label={nm}
                                                    sub={`${india ? "🇮🇳" : "🇺🇸"} ${market}:${sym}`}
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
                        </FormRow>

</FormSection>

                    <FormSection title="Agent settings">
                        {/* Agent — the configured harness agents (Agents page) */}
                        {agents.length > 0 && (
                            <FormRow label="Agent">
                                <MenuDropdown
                                    plain
                                    logo={selectedAgent ? <AgentAvatar seed={selectedAgent.id} size={16}/> : undefined}
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
                                                    logo={<AgentAvatar seed={a.id} size={18}/>}
                                                    onClick={() => {
                                                        setAgentId(a.id);
                                                        close();
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    )}
                                </MenuDropdown>
                            </FormRow>
                        )}

                        <FormRow label="Model">
                            <Input
                                value={model}
                                onChange={(e) => {
                                    setModel(e.target.value);
                                    setModelError(null);
                                }}
                                placeholder="provider/model"
                                aria-label="Model id"
                                data-testid="run-model"
                                className="h-8 rounded-[6px] border-none shadow-none text-[13px] font-light font-[family-name:var(--font-body)]"
                            />
                            {modelError && (
                                <Text fontSize="11px" fontWeight={400} fontFamily="var(--font-body)" color="var(--signal-negative)">
                                    {modelError}
                                </Text>
                            )}
                        </FormRow>

                        <FormRow label="Max steps">
                            <Input
                                type="number"
                                min={1}
                                value={maxSteps}
                                onChange={(e) => setMaxSteps(e.target.value)}
                                placeholder="20"
                                aria-label="Max steps"
                                data-testid="run-max-steps"
                                className="h-8 rounded-[6px] border-none shadow-none text-[13px] font-light font-[family-name:var(--font-body)]"
                            />
                        </FormRow>

                        <FormRow label="Max tokens">
                            <Input
                                type="number"
                                min={1000}
                                value={maxTokens}
                                onChange={(e) => setMaxTokens(e.target.value)}
                                placeholder="200000"
                                aria-label="Max tokens"
                                data-testid="run-max-tokens"
                                className="h-8 rounded-[6px] border-none shadow-none text-[13px] font-light font-[family-name:var(--font-body)]"
                            />
                        </FormRow>
                    </FormSection>

                    <RunFooter
                        status={status}
                        resuming={!!id && status === "EMPTY"}
                        statusLine={statusLine}
                        canRun={canRunAnalysis && !starting}
                        scheduled={runMode === "daily"}
                        onRun={runMode === "daily" ? scheduleDaily : runAnalysis}
                        onReset={() => {
                            navigate("/analysis");
                            setStatus("EMPTY");
                            setRunError(null);
                            setSteps([]);
                        }}
                        elapsedTime={elapsedTime}
                        analysisDuration={analysisDuration}
                        correlationId={correlationId}
                    />
                </Box>

                {status === "EMPTY" && schedules.length > 0 && (
                    <Box mt={5}>
                        <Text {...microLabel} mb={2}>Active schedules</Text>
                        {schedules.map((s) => (
                            <Flex key={s.id} align="center" gap={2.5} py={1.5}>
                                <TickerLogo symbol={s.symbol} size={16} />
                                <Text
                                    fontSize="13px"
                                    fontWeight={400}
                                    fontFamily="var(--font-body)"
                                    color="var(--ink-primary)"
                                    minW={0}
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    whiteSpace="nowrap"
                                >
                                    {s.share_name || s.symbol}
                                </Text>
                                <Text fontSize="12px" fontWeight={300} fontFamily="var(--font-body)" color="var(--ink-tertiary)" ml="auto" whiteSpace="nowrap">
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
                                    border="none"
                                    background="transparent"
                                    color="var(--ink-tertiary)"
                                    cursor="pointer"
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
                            mt={5}
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
            </Box>
        </Box>
    );
}
