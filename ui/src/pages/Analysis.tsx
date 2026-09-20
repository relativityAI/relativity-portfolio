import SearchBar from "@/components/SearchBar";
import PageHero from "@/components/PageHero";
import {
    Button, Flex, Text, Spinner, Box, Select, Input,
    createListCollection, Portal, HStack, VStack, Switch
} from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { MdInfoOutline, MdCheck, MdClose, MdArrowForward } from "react-icons/md";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, AgentService, DataService, SettingsService, API_BASE } from "@/db";
import { formatSeconds, agentDisplayName } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { resolveAgent } from "@/lib/agentIdentity";
import { ModelLogo } from "@/lib/modelLogos";
import { type RunStep } from "./shared/RunStatus";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";
import { SOURCE_DEFS, SourceMark, type SourceKey } from "@/lib/sourceLogos";

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
                rowGap={1}
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
                                <AgentAvatar agent={resolveAgent(a.agent_name || a.agent, agents || [])} size={16} />
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

function StepSection({ n, title, done, collapsed, onToggle, summary, children }: { n: string; title: string; done: boolean; collapsed?: boolean; onToggle?: () => void; summary?: string; children: any }) {
    const headerIsButton = !!collapsed && !!onToggle;
    return (
        <Box as={motion.div} variants={staggerItem} py={{ base: 4, md: 5 }}>
            <Flex
                as={headerIsButton ? "button" : "div"}
                type={headerIsButton ? "button" : undefined}
                onClick={headerIsButton ? onToggle : undefined}
                align="center"
                gap={2.5}
                mb={4}
                w="full"
                cursor={headerIsButton ? "pointer" : undefined}
                aria-expanded={headerIsButton ? false : undefined}
            >
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
                {collapsed && summary && (
                    <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" maxW="60%">
                        {summary}
                    </Text>
                )}
                {done && <MdCheck size={12} color="var(--signal-positive)" aria-label={`${title} selected`} />}
                {headerIsButton && (
                    <Text fontSize="10px" color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0}>
                        Edit
                    </Text>
                )}
            </Flex>
            {collapsed ? null : children}
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
                        minH="44px"
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

/** One compact selection chip used across both rail variants. */
function RailChip({ icon, label, sub, muted }: { icon?: React.ReactNode; label: string; sub?: string; muted?: boolean }) {
    return (
        <Flex align="center" gap={1.5} minW={0}>
            {icon}
            <Box minW={0}>
                <Text
                    fontSize="12px"
                    fontWeight={muted ? 400 : 500}
                    color={muted ? "var(--ink-tertiary)" : "var(--ink-primary)"}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                >
                    {label}
                </Text>
                {sub && (
                    <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                        {sub}
                    </Text>
                )}
            </Box>
        </Flex>
    );
}

function RailWebSearch({ hasTavily, webSearch, setWebSearch }: { hasTavily: boolean; webSearch: boolean; setWebSearch: (v: boolean) => void }) {
    return (
        <Flex align="center" justify="space-between" gap={2} py={2}>
            <Box minW={0}>
                <Text fontSize="11.5px" fontWeight={500} color="var(--ink-secondary)">Web search</Text>
                <Text fontSize="10.5px" color="var(--ink-tertiary)" noOfLines={1}>
                    {hasTavily ? "Live sources beyond filings" : "Needs a Tavily key"}
                </Text>
            </Box>
            {hasTavily ? (
                <Switch.Root checked={webSearch} onCheckedChange={(e) => setWebSearch(e.checked)} colorPalette="blue" size="sm" flexShrink={0}>
                    <Switch.HiddenInput />
                    <Switch.Control>
                        <Switch.Thumb />
                    </Switch.Control>
                </Switch.Root>
            ) : (
                <Link to="/settings" style={{ flexShrink: 0 }}>
                    <Text fontSize="10.5px" color="var(--accent-primary)">Add</Text>
                </Link>
            )}
        </Flex>
    );
}

/**
 * AnalysisSummaryRail — the persistent "here's what will run / is running" card.
 * Desktop: sticky alongside the steps. Mobile: sticky bottom bar (condensed
 * line + Start; tap to expand the full summary). One component, four states.
 */
function AnalysisSummaryRail(props: {
    variant: "rail" | "bar";
    status: StatusType;
    resuming: boolean;
    source: string;
    share: string;
    shareName: string;
    agentName: string | null;
    agentObj: any;
    model: string;
    isDefaultModel: boolean;
    dataStatus: any;
    dataStatusLoading: boolean;
    hasTavily: boolean;
    webSearch: boolean;
    setWebSearch: (v: boolean) => void;
    typicalDuration: string | null;
    canRun: boolean;
    onRun: () => void;
    elapsedTime: number;
    analysisDuration: string;
    correlationId: string;
    onReset: () => void;
}) {
    const { variant, status } = props;
    const [expanded, setExpanded] = useState(false);

    const companyLabel = props.share ? (props.shareName || props.share) : null;

    // ── Shared pieces ─────────────────────────────────────────────
    const dataAvailIcon =
        props.dataStatusLoading ? (
            <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
        ) : props.dataStatus ? (
            props.dataStatus.available ? (
                <MdCheck size={13} color="var(--signal-positive)" />
            ) : (
                <MdInfoOutline size={13} color="var(--signal-caution)" />
            )
        ) : null;

    const companyChip = (
        <RailChip
            icon={<SourceMark source={props.source === "SEC" ? "sec" : "nse"} size={14} />}
            label={companyLabel || "—"}
            sub={props.share ? props.share.toUpperCase() : undefined}
            muted={!companyLabel}
        />
    );
    const agentChip = (
        <RailChip
            icon={props.agentName ? <AgentAvatar agent={props.agentObj ?? props.agentName} size={18} /> : undefined}
            label={props.agentName || "—"}
            muted={!props.agentName}
        />
    );
    const modelChip = (
        <RailChip
            icon={props.model ? <ModelLogo model={props.model} size={15} /> : undefined}
            label={props.model ? modelName(props.model) : "—"}
            sub={props.model ? providerLabel(modelPrefix(props.model)) : undefined}
            muted={!props.model}
        />
    );

    const idleBody = (
        <Flex direction="column" gap={2.5}>
            <Flex direction="column" gap={2.5}>
                {companyChip}
                <Flex align="center" gap={1.5} pl={0.5} minH="13px">
                    {dataAvailIcon}
                    {props.dataStatus && !props.dataStatus.available && (
                        <Text fontSize="10px" color="var(--ink-tertiary)" noOfLines={1}>
                            {props.dataStatus.keyed === false ? "Live data isn't set up yet" : "Data will be pulled at run time"}
                        </Text>
                    )}
                </Flex>
                {agentChip}
                {modelChip}
                {props.isDefaultModel && props.model && (
                    <Text fontSize="9.5px" fontWeight={600} color="var(--accent-primary)" textTransform="uppercase" letterSpacing="0.05em" pl={0.5}>
                        Recommended
                    </Text>
                )}
                <Box borderTop="1px solid var(--hairline)" my={0.5} />
                <RailWebSearch hasTavily={props.hasTavily} webSearch={props.webSearch} setWebSearch={props.setWebSearch} />
            </Flex>
        </Flex>
    );

    const actionArea = (() => {
        if (status === "PENDING") {
            return (
                <HStack gap={2}>
                    <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                    <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">
                        {props.resuming ? "Resuming" : "Running"}
                    </Text>
                    {props.elapsedTime > 0 && (
                        <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)">
                            {formatSeconds(props.elapsedTime)}
                        </Text>
                    )}
                </HStack>
            );
        }
        if (status === "COMPLETED") {
            return (
                <Flex direction="column" gap={2} w="full">
                    <HStack gap={2}>
                        <MdCheck size={16} color="var(--signal-positive)" />
                        <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">Complete</Text>
                        {props.analysisDuration && (
                            <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)">
                                {props.analysisDuration}
                            </Text>
                        )}
                    </HStack>
                    <HStack gap={2} w="full">
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1 }}>
                                <Button size="md" w="full" variant="surface" colorPalette="blue">View report</Button>
                            </Link>
                        )}
                        <Button size="md" variant="subtle" color="var(--ink-secondary)" _hover={{ color: "var(--ink-primary)" }} fontWeight={500} onClick={props.onReset}>
                            Run again
                        </Button>
                    </HStack>
                    {idleBody}
                </Flex>
            );
        }
        if (status === "ERROR") {
            return (
                <Flex direction="column" gap={2} w="full">
                    <HStack gap={2}>
                        <MdClose size={16} color="var(--signal-negative)" />
                        <Text fontSize="13px" fontWeight={600} color="var(--signal-negative)">Failed</Text>
                    </HStack>
                    <HStack gap={2} w="full">
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1 }}>
                                <Button size="md" variant="subtle" color="var(--ink-secondary)" _hover={{ color: "var(--ink-primary)" }} fontWeight={500} w="full">View report</Button>
                            </Link>
                        )}
                        <Button size="md" variant="subtle" colorPalette="red" fontWeight={500} onClick={props.onReset} w="full">Try again</Button>
                    </HStack>
                    {idleBody}
                </Flex>
            );
        }
        // Idle / configuring (or resuming an in-flight run from a deep link)
        if (props.resuming) {
            return (
                <Button size="lg" w="full" variant="surface" colorPalette="blue" disabled>
                    <HStack gap={2}>
                        <Spinner size="sm" borderWidth="2px" />
                        <Text fontSize="14px" fontWeight={600}>Resuming analysis…</Text>
                    </HStack>
                </Button>
            );
        }
        return (
            <>
                <Text fontSize="11px" color="var(--ink-tertiary)" textAlign="center" mb={2}>
                    {props.typicalDuration ? `Typically takes ${props.typicalDuration}` : "Typically takes a few minutes"}
                </Text>
                <Button
                    size="lg"
                    w="full"
                    variant="surface"
                    colorPalette="blue"
                    fontWeight={600}
                    fontSize="15px"
                    onClick={props.onRun}
                    disabled={!props.canRun}
                >
                    Start Analysis
                </Button>
                {!props.canRun && (
                    <Text mt={2} fontSize="11px" color="var(--ink-tertiary)" textAlign="center">
                        Choose a company and an agent to enable the run
                    </Text>
                )}
            </>
        );
    })();

    // ── Desktop rail ──────────────────────────────────────────────
    if (variant === "rail") {
        return (
            <Box
                as={motion.div}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur.base, ease }}
                w="320px"
                flexShrink={0}
            >
                <Box
                    position="sticky"
                    top="72px"
                    border="1px solid var(--hairline)"
                    borderRadius="2px"
                    bg="var(--surface-panel)"
                    p={4}
                >
                    <Text fontSize="10.5px" fontWeight={500} color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.06em" mb={3}>
                        Run summary
                    </Text>
                    {status === "PENDING" ? (
                        <Flex direction="column" gap={3}>
                            {actionArea}
                            <Flex direction="column" gap={1.5} pt={1} borderTop="1px solid var(--hairline)">
                                {companyChip}
                                {agentChip}
                                {modelChip}
                            </Flex>
                        </Flex>
                    ) : (
                        <Flex direction="column" gap={3}>
                            {idleBody}
                            <Box borderTop="1px solid var(--hairline)" />
                            {actionArea}
                        </Flex>
                    )}
                </Box>
            </Box>
        );
    }

    // ── Mobile bottom bar ─────────────────────────────────────────
    return (
        <Box
            as={motion.div}
            initial={{ y: 60 }}
            animate={{ y: 0 }}
            transition={{ duration: dur.base, ease }}
            position="fixed"
            bottom={0}
            left={0}
            right={0}
            zIndex={20}
            borderTop="1px solid var(--hairline)"
            bg="var(--surface-panel)"
            boxShadow="0 -4px 16px rgba(0,0,0,0.06)"
            px={{ base: 4, md: 8 }}
            pt={2.5}
            pb={"calc(12px + env(safe-area-inset-bottom))"}
        >
            {/* Condensed one-line: chips + status; tap to expand (idle only) */}
            <Flex
                as={status === "EMPTY" && !props.resuming ? "button" : "div"}
                type={status === "EMPTY" && !props.resuming ? "button" : undefined}
                onClick={status === "EMPTY" && !props.resuming ? () => setExpanded((v) => !v) : undefined}
                align="center"
                gap={2.5}
                w="full"
                cursor={status === "EMPTY" && !props.resuming ? "pointer" : undefined}
            >
                {status === "PENDING" ? (
                    <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                ) : status === "COMPLETED" ? (
                    <MdCheck size={14} color="var(--signal-positive)" />
                ) : status === "ERROR" ? (
                    <MdClose size={14} color="var(--signal-negative)" />
                ) : null}
                <Flex align="center" gap={2} minW={0} flex={1} overflow="hidden">
                    {companyChip}
                    <Text fontSize="11px" color="var(--ink-tertiary)">·</Text>
                    {agentChip}
                    <Text fontSize="11px" color="var(--ink-tertiary)">·</Text>
                    {modelChip}
                </Flex>
                {status === "PENDING" && props.elapsedTime > 0 && (
                    <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)" flexShrink={0}>
                        {formatSeconds(props.elapsedTime)}
                    </Text>
                )}
            </Flex>
            {expanded && status === "EMPTY" && !props.resuming && (
                <Box pt={2} mt={2} borderTop="1px solid var(--hairline)">
                    {idleBody}
                </Box>
            )}
            <Box pt={2.5}>
                {status === "EMPTY" && !props.resuming ? (
                    <Button
                        size="md"
                        w="full"
                        variant="surface"
                        colorPalette="blue"
                        fontWeight={600}
                        onClick={props.onRun}
                        disabled={!props.canRun}
                    >
                        Start Analysis
                    </Button>
                ) : status === "PENDING" ? null : status === "COMPLETED" ? (
                    <HStack gap={2} mt={2.5}>
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1 }}>
                                <Button size="md" w="full" variant="surface" colorPalette="blue">View report</Button>
                            </Link>
                        )}
                        <Button size="md" variant="subtle" color="var(--ink-secondary)" _hover={{ color: "var(--ink-primary)" }} fontWeight={500} onClick={props.onReset}>Run again</Button>
                    </HStack>
                ) : status === "ERROR" ? (
                    <HStack gap={2} mt={2.5}>
                        {props.correlationId && (
                            <Link to={`/analysis-result/${props.correlationId}`} style={{ flex: 1 }}>
                                <Button size="md" w="full" variant="subtle" color="var(--ink-secondary)" _hover={{ color: "var(--ink-primary)" }} fontWeight={500}>View report</Button>
                            </Link>
                        )}
                        <Button size="md" variant="subtle" colorPalette="red" fontWeight={500} onClick={props.onReset}>Try again</Button>
                    </HStack>
                ) : null}
            </Box>
        </Box>
    );
}

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [latestAnalysis, setLatestAnalysis] = useState<any>(null);
    const [recentRuns, setRecentRuns] = useState<any[]>([]);
    const [availableAgents, setAvailableAgents] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    const [dataStatus, setDataStatus] = useState<any>(null);
    const [dataStatusLoading, setDataStatusLoading] = useState(false);
    const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

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
                if (cancelled || !Array.isArray(data)) return;
                setRecentRuns(data);
                if (data.length === 0) return;
                setLatestAnalysis(data.reduce((a, b) =>
                    +new Date(a.created_at ?? 0) > +new Date(b.created_at ?? 0) ? a : b
                ));
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, []);

    const [config, setConfig] = useState({
        source: "NSE",
        share: "",
        shareName: "",
        agent: "",
    });

    const exchangeSource: SourceKey = config.source === "NSE" ? "nse" : "sec";

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
    const [defaultModel, setDefaultModel] = useState("");
    const [providerCount, setProviderCount] = useState(0);
    const [selectedModel, setSelectedModel] = useState("");
    const [modelQuery, setModelQuery] = useState("");
    const [hasTavily, setHasTavily] = useState(false);
    const [webSearch, setWebSearch] = useState(true);
    const debouncedModelQuery = useDebounce(modelQuery, 200);
    const [showModelList, setShowModelList] = useState(false);
    const modelRef = useRef<HTMLDivElement>(null);
    const [dropUp, setDropUp] = useState(false);
    const [modelValidated, setModelValidated] = useState(false);

    const filteredModels = useMemo(() => {
        if (!debouncedModelQuery.trim()) return availableModels;
        const q = debouncedModelQuery.toLowerCase();
        return availableModels.filter(m => m.toLowerCase().includes(q));
    }, [availableModels, debouncedModelQuery]);

    // Group the (filtered) models by provider so the list scans by maker
    // first, model second. The recommended model's group leads, and the
    // recommended model itself leads within its group.
    const groupedModels = useMemo(() => {
        const order: string[] = [];
        const byPrefix: Record<string, string[]> = {};
        for (const m of filteredModels) {
            const p = modelPrefix(m);
            if (!byPrefix[p]) {
                byPrefix[p] = [];
                order.push(p);
            }
            byPrefix[p].push(m);
        }
        if (defaultModel) {
            const dp = modelPrefix(defaultModel);
            if (order.includes(dp)) {
                order.splice(order.indexOf(dp), 1);
                order.unshift(dp);
                byPrefix[dp] = [defaultModel, ...byPrefix[dp].filter(m => m !== defaultModel)];
            }
        }
        return order.map(prefix => ({ prefix, models: byPrefix[prefix] }));
    }, [filteredModels, defaultModel]);

    const openModelList = useCallback(() => {
        // Flip the panel upward when there isn't room below (mobile keyboards
        // shrink the viewport; bottom-of-page inputs would clip).
        const rect = modelRef.current?.getBoundingClientRect();
        setDropUp(!!rect && window.innerHeight - rect.bottom < 260);
        setShowModelList(true);
    }, []);

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
            const [modelsData, settings, def] = await Promise.all([
                AnalysisService.getAvailableModels(),
                SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
                AnalysisService.getDefaultModel().catch(() => ({ model_id: "" })),
            ]);
            const allModels = Array.isArray(modelsData) ? modelsData : [];
            setDefaultModel(def?.model_id || "");
            const keys = Object.keys(settings?.llm_keys || {});
            const hasTv = keys.includes("tavily");
            setHasTavily(hasTv);
            setWebSearch(hasTv);
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
                const recommended = models.includes(def?.model_id || "") ? def.model_id : "";
                return recommended || models[0] || "";
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

    // Validate the model the moment it's picked — a bad model should be
    // discovered at selection time, not after the user hits Start.
    useEffect(() => {
        if (!selectedModel || status !== "EMPTY" || id) return;
        setModelValidated(false);
        const t = setTimeout(() => {
            checkModel(selectedModel).then((ok) => {
                if (ok) setModelValidated(true);
            });
        }, 500);
        return () => clearTimeout(t);
    }, [selectedModel, status, id, checkModel]);

    const [starting, setStarting] = useState(false);
    const runAnalysis = async () => {
        // In-flight guard: the model check below awaits a network round-trip
        // before the POST fires, and during that window the button is still
        // rendered enabled — without this, a second click starts a duplicate run.
        if (starting || status !== "EMPTY") return;
        if (!config.source || !config.share || !config.agent) return;

        setStarting(true);
        try {
            // Validate model first
            const isValid = await checkModel(selectedModel || availableModels[0]);
            if (!isValid) return;

            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                agent_name: config.agent,
                model: selectedModel || undefined,
                source: config.source,
                web_search: webSearch,
            });

            if (result && (result.corr_id || result.analysis_id)) {
                setSteps([]);
                setCorrelationId(result.corr_id || result.analysis_id);
                setStartedAt(Date.now());
                setStatus("PENDING");
            }
        } catch (error) {
            console.error("Run analysis error:", error);
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
                    agent: data.agent_name || data.agent || prev.agent,
                    source: exchangeSrc,
                }));

                setCorrelationId(analysisId);

                if (Array.isArray(data.steps)) setSteps(data.steps);
                if (data.created_at) setStartedAt(+new Date(data.created_at));

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

    // Completed steps collapse to a one-line summary; the active step stays open.
    const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({});
    const stepSummary = (step: string) => {
        if (step === "company") return config.share ? `${config.source} · ${config.share.toUpperCase()}` : undefined;
        if (step === "agent") return config.agent ? agentDisplayName(config.agent, availableAgents) || config.agent : undefined;
        if (step === "model") return selectedModel ? modelName(selectedModel) : undefined;
        return undefined;
    };
    const persona = selectedAgent?.philosophy || selectedAgent?.persona?.philosophy_and_mindset || "";
    const [personaOpen, setPersonaOpen] = useState(false);
    useEffect(() => { setPersonaOpen(false); }, [config.agent]);

    // Collapse a step once it's complete and the user has moved on: company
    // collapses when an agent is chosen, agent when a model exists, model only
    // when the run actually starts. Editing re-opens the step.
    useEffect(() => {
        if (config.share && config.agent) setCollapsedSteps(p => ({ ...p, company: true }));
        if (config.share && config.agent && selectedModel) setCollapsedSteps(p => ({ ...p, agent: true }));
    }, [config.share, config.agent, selectedModel]);
    useEffect(() => {
        if (status === "PENDING" || status === "COMPLETED" || status === "ERROR") {
            setCollapsedSteps({ company: true, agent: true, model: true });
        }
    }, [status]);
    useEffect(() => {
        if (status === "EMPTY") setCollapsedSteps({});
    }, [status]);
    const siblingModelCount = useCallback(
        (id: string) => availableModels.filter((m) => modelPrefix(m) === modelPrefix(id)).length - 1,
        [availableModels]
    );
    const isConfigComplete = config.share !== "" && config.agent !== "";
    const canRunAnalysis = isConfigComplete;

    // Real historical average from completed runs, so the "typically takes"
    // line sets an honest expectation instead of a guess.
    const typicalDuration = useMemo(() => {
        const ds = (recentRuns || [])
            .filter((a: any) => ["complete", "completed", "success"].includes(String(a.status || "").toLowerCase()))
            .map((a: any) => Number(a.duration))
            .filter((d) => Number.isFinite(d) && d > 0);
        if (ds.length === 0) return null;
        const avg = ds.reduce((s, d) => s + d, 0) / ds.length;
        if (avg < 60) return "under a minute";
        if (avg < 90) return "about a minute";
        return `about ${Math.round(avg / 60)} minutes`;
    }, [recentRuns]);

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

                    {/* Two-zone layout: steps (main) + sticky summary rail (side). The rail
                        renders in normal flow below on mobile. */}
                    <Flex direction={{ base: "column", lg: "row" }} gap={{ base: 0, lg: 8 }} align={{ lg: "flex-start" }}>
                    <Flex direction="column" flex={1} minW={0} as={motion.div} variants={stagger} initial="initial" animate="animate">
                        {/* 01 — Company */}
                        <StepSection n="01" title="Company" done={!!config.share} collapsed={!!collapsedSteps["company"]} onToggle={() => setCollapsedSteps(p => ({ ...p, company: !p["company"] }))} summary={stepSummary("company")}>
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
                                    <Flex
                                        align="center"
                                        gap={1.5}
                                        mt={2}
                                        title={`${SOURCE_DEFS[exchangeSource].full} · ${SOURCE_DEFS.voyager.full}`}
                                    >
                                        <SourceMark source={exchangeSource} size={17} />
                                        <SourceMark source="voyager" size={17} />
                                    </Flex>
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
                                                            ? "Live data isn't set up for this market yet — the run may be limited"
                                                            : "First analysis here — data will be pulled when the run starts"}
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
                        <StepSection n="02" title="Agent" done={!!config.agent} collapsed={!!collapsedSteps["agent"]} onToggle={() => setCollapsedSteps(p => ({ ...p, agent: !p["agent"] }))} summary={stepSummary("agent")}>
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
                                                    {agentOptions.items.map((item: any) => {
                                                        const agent = availableAgents.find((p: any) => (p._id || p.id || p.name) === item.value);
                                                        return (
                                                            <Select.Item item={item} key={item.value}>
                                                                <Flex align="center" gap={2} minW={0} flex={1}>
                                                                    <AgentAvatar agent={agent ?? item.label} size={22} />
                                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                                </Flex>
                                                                <Select.ItemIndicator />
                                                            </Select.Item>
                                                        );
                                                    })}
                                                </Select.Content>
                                            </Select.Positioner>
                                        </Portal>
                                    </Select.Root>
                                    <Flex align="center" gap={1.5} mt={1.5}>
                                        <MdInfoOutline size={12} color="var(--ink-tertiary)" />
                                        <Text fontSize="11px" color="var(--ink-tertiary)">
                                            Create or edit agents in the{" "}
                                            <Link to="/agent/new" style={{ color: "var(--accent-primary)" }}>
                                                Agent Builder
                                            </Link>
                                        </Text>
                                    </Flex>
                                </Box>
                                <Box flex={1} minW={0} pt={{ base: 1, md: 5 }}>
                                    {selectedAgent ? (
                                        <Flex direction="row" align="flex-start" gap={2.5} minW={0}>
                                            <AgentAvatar agent={selectedAgent} size={48} label={selectedAgent.name} />
                                            <Flex direction="column" gap={1} minW={0}>
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
                                                {persona && (
                                                    <Box minW={0} w="full">
                                                        <AnimatePresence initial={false}>
                                                            {personaOpen && (
                                                                <Box
                                                                    as={motion.div}
                                                                    initial={{ height: 0, opacity: 0 }}
                                                                    animate={{ height: "auto", opacity: 1 }}
                                                                    exit={{ height: 0, opacity: 0 }}
                                                                    transition={{ duration: dur.base, ease }}
                                                                    overflow="hidden"
                                                                >
                                                                    <Box borderLeft="2px solid var(--hairline)" pl={3} py={1} mb={2} maxH="160px" overflowY="auto">
                                                                        <Text fontSize="12px" color="var(--ink-secondary)" lineHeight="1.6" whiteSpace="pre-line">
                                                                            {persona}
                                                                        </Text>
                                                                    </Box>
                                                                </Box>
                                                            )}
                                                        </AnimatePresence>
                                                        {!personaOpen && (
                                                            <Text fontSize="12px" color="var(--ink-tertiary)" lineHeight="1.6" noOfLines={2}>
                                                                {persona}
                                                            </Text>
                                                        )}
                                                        <Text
                                                            as="button"
                                                            fontSize="11px"
                                                            fontWeight={500}
                                                            color="var(--accent-primary)"
                                                            cursor="pointer"
                                                            mt={1}
                                                            onClick={() => setPersonaOpen((v) => !v)}
                                                        >
                                                            {personaOpen ? "Hide persona" : "Read full persona"}
                                                        </Text>
                                                    </Box>
                                                )}
                                            </Flex>
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
                        <StepSection n="03" title="Model" done={!!selectedModel} collapsed={!!collapsedSteps["model"]} onToggle={() => setCollapsedSteps(p => ({ ...p, model: !p["model"] }))} summary={stepSummary("model")}>
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                <Box w={{ base: "full", md: "380px" }} flexShrink={0}>
                                    <FieldLabel>Model</FieldLabel>
                                    <Box width="full" position="relative" ref={modelRef}>
                                        <Input
                                            placeholder="Search model (e.g., qwen, gpt, claude)..."
                                            value={showModelList ? modelQuery : selectedModel}
                                            onChange={(e) => {
                                                setModelQuery(e.target.value);
                                                openModelList();
                                            }}
                                            onFocus={() => {
                                                setModelQuery(selectedModel);
                                                openModelList();
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
                                                    initial={{ opacity: 0, y: dropUp ? 4 : -4, height: 0 }}
                                                    animate={{ opacity: 1, y: 0, height: "auto" }}
                                                    exit={{ opacity: 0, y: dropUp ? 4 : -4, height: 0 }}
                                                    transition={{ duration: dur.base, ease }}
                                                    position="absolute"
                                                    top={dropUp ? undefined : "100%"}
                                                    bottom={dropUp ? "100%" : undefined}
                                                    left={0}
                                                    right={0}
                                                    zIndex={10}
                                                    mt={dropUp ? 0 : 1}
                                                    mb={dropUp ? 1 : 0}
                                                    maxH="240px"
                                                    overflowY="auto"
                                                    border="1px solid var(--hairline)"
                                                    borderRadius="2px"
                                                    bg="var(--surface-panel)"
                                                >
                                                    {groupedModels.length > 0 ? (
                                                        groupedModels.map(g => (
                                                            <Box key={g.prefix}>
                                                                <Flex
                                                                    px={2.5}
                                                                    py={1.5}
                                                                    bg="var(--surface-recessed)"
                                                                    align="center"
                                                                    gap={1.5}
                                                                    position="sticky"
                                                                    top={0}
                                                                    zIndex={1}
                                                                >
                                                                    <ModelLogo model={g.prefix} size={12} />
                                                                    <Text
                                                                        fontSize="10px"
                                                                        fontWeight={600}
                                                                        color="var(--ink-tertiary)"
                                                                        textTransform="uppercase"
                                                                        letterSpacing="0.06em"
                                                                    >
                                                                        {providerLabel(g.prefix)}
                                                                    </Text>
                                                                    <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" ml="auto">
                                                                        {g.models.length}
                                                                    </Text>
                                                                </Flex>
                                                                {g.models.map(m => (
                                                                    <Flex
                                                                        key={m}
                                                                        align="center"
                                                                        gap={2.5}
                                                                        px={2.5}
                                                                        py={2}
                                                                        minH="44px"
                                                                        cursor="pointer"
                                                                        bg={m === selectedModel ? "var(--surface-recessed)" : undefined}
                                                                        _hover={{ bg: "var(--surface-recessed)" }}
                                                                        transition="background 160ms"
                                                                        onClick={() => {
                                                                            setSelectedModel(m);
                                                                            setModelError(null);
                                                                            setModelQuery("");
                                                                            setShowModelList(false);
                                                                        }}
                                                                    >
                                                                        <ModelLogo model={m} size={15} />
                                                                        <Box minW={0} flex={1}>
                                                                            <Text
                                                                                as="span"
                                                                                display="block"
                                                                                fontSize="12.5px"
                                                                                fontWeight={m === selectedModel ? 600 : 500}
                                                                                color="var(--ink-primary)"
                                                                                overflow="hidden"
                                                                                textOverflow="ellipsis"
                                                                                whiteSpace="nowrap"
                                                                            >
                                                                                {modelName(m)}
                                                                            </Text>
                                                                            <Text
                                                                                as="span"
                                                                                display="block"
                                                                                fontSize="10.5px"
                                                                                fontFamily="var(--font-mono)"
                                                                                color="var(--ink-tertiary)"
                                                                                overflow="hidden"
                                                                                textOverflow="ellipsis"
                                                                                whiteSpace="nowrap"
                                                                            >
                                                                                {m}
                                                                            </Text>
                                                                        </Box>
                                                                        {m === defaultModel && (
                                                                            <Text
                                                                                fontSize="9.5px"
                                                                                fontWeight={600}
                                                                                color="var(--accent-primary)"
                                                                                textTransform="uppercase"
                                                                                letterSpacing="0.05em"
                                                                                flexShrink={0}
                                                                            >
                                                                                Recommended
                                                                            </Text>
                                                                        )}
                                                                        {m === selectedModel && <MdCheck size={13} color="var(--signal-positive)" flexShrink={0} />}
                                                                    </Flex>
                                                                ))}
                                                            </Box>
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
                                                <ModelLogo model={selectedModel} size={16} />
                                                <Text
                                                    fontSize="10.5px"
                                                    fontWeight={600}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="var(--accent-primary)"
                                                >
                                                    {providerLabel(modelPrefix(selectedModel))}
                                                </Text>
                                                {modelValidated && !validatingModel && !modelError && (
                                                    <MdCheck size={13} color="var(--signal-positive)" />
                                                )}
                                            </Flex>
                                            <Text mt={0.5} fontSize="16px" fontWeight={600} color="var(--ink-primary)" lineHeight="short" wordBreak="break-word">
                                                {modelName(selectedModel)}
                                            </Text>
                                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                                {selectedModel}
                                            </Text>
                                            <Text fontSize="12px" color="var(--ink-secondary)">
                                                {siblingModelCount(selectedModel)} other model{siblingModelCount(selectedModel) === 1 ? "" : "s"} from {providerLabel(modelPrefix(selectedModel))}
                                            </Text>
                                            {validatingModel ? (
                                                <Flex align="center" gap={1.5}>
                                                    <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
                                                    <Text fontSize="11px" color="var(--ink-tertiary)">Checking access…</Text>
                                                </Flex>
                                            ) : modelError ? (
                                                <Text fontSize="11px" color="var(--signal-negative)">Access could not be verified</Text>
                                            ) : modelValidated ? (
                                                <Text fontSize="11px" color="var(--signal-positive)">Access verified</Text>
                                            ) : null}
                                            {selectedModel === defaultModel && (
                                                <Text fontSize="11px" color="var(--accent-primary)" fontFamily="var(--font-mono)">
                                                    auto-selected default
                                                </Text>
                                            )}
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

                    {/* Summary rail — desktop: sticky side card. Hidden on mobile,
                        where the fixed bottom bar variant below takes over. */}
                    <Box display={{ base: "none", lg: "block" }}>
                    <AnalysisSummaryRail
                        variant="rail"
                        status={status}
                        resuming={!!id && status === "EMPTY"}
                        source={config.source}
                        share={config.share}
                        shareName={config.shareName}
                        agentName={config.agent ? agentDisplayName(config.agent, availableAgents) || config.agent : null}
                        agentObj={resolveAgent(config.agent, availableAgents)}
                        model={selectedModel || ""}
                        isDefaultModel={!!selectedModel && selectedModel === defaultModel}
                        dataStatus={dataStatus}
                        dataStatusLoading={dataStatusLoading}
                        hasTavily={hasTavily}
                        webSearch={webSearch}
                        setWebSearch={setWebSearch}
                        typicalDuration={typicalDuration}
                        canRun={canRunAnalysis && !starting}
                        onRun={runAnalysis}
                        elapsedTime={elapsedTime}
                        analysisDuration={analysisDuration}
                        correlationId={correlationId}
                        onReset={() => {
                            setStatus("EMPTY");
                            setSteps([]);
                        }}
                    />
                    </Box>
                    </Flex>

                    {/* While a run is active the main column below the rail row shows the
                        live trace — the form is compacted into the rail above. */}
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
                                borderTop="1px solid var(--hairline)"
                                mt={5}
                                pt={5}
                            >
                                <Flex justify="space-between" align="center" mb={3}>
                                    <HStack gap={3} color="var(--ink-secondary)">
                                        <Spinner size="sm" borderWidth="2px" />
                                        <Text fontSize="13px">Analysis in progress — this page updates automatically.</Text>
                                    </HStack>
                                    {elapsedTime > 0 && (
                                        <Text
                                            fontSize="12px"
                                            color="var(--ink-tertiary)"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            whiteSpace="nowrap"
                                        >
                                            {formatSeconds(elapsedTime)}
                                        </Text>
                                    )}
                                </Flex>
                                <AgentActivity
                                    title={`Analyzing ${config.shareName || config.share} with ${agentDisplayName(config.agent, availableAgents) || config.agent}`}
                                    subtitle={`${selectedModel || "default model"} · gathering data, searching, scoring`}
                                    agent={resolveAgent(config.agent, availableAgents)}
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
                            <Text fontSize="13px">Loading analysis data…</Text>
                        </Flex>
                    )}

                    {/* Spacer: clears the fixed mobile bottom bar; small on desktop */}
                    <Box display={{ base: "block", lg: "none" }} h="150px" />
                    <Box display={{ base: "none", lg: "block" }} h={10} />
                </Flex>
            </Box>

            {/* Mobile: sticky bottom bar replaces the rail's position in the flow */}
            <Box display={{ base: "block", lg: "none" }}>
                <AnalysisSummaryRail
                    variant="bar"
                    status={status}
                    resuming={!!id && status === "EMPTY"}
                    source={config.source}
                    share={config.share}
                    shareName={config.shareName}
                    agentName={config.agent ? agentDisplayName(config.agent, availableAgents) || config.agent : null}
                    agentObj={resolveAgent(config.agent, availableAgents)}
                    model={selectedModel || ""}
                    isDefaultModel={!!selectedModel && selectedModel === defaultModel}
                    dataStatus={dataStatus}
                    dataStatusLoading={dataStatusLoading}
                    hasTavily={hasTavily}
                    webSearch={webSearch}
                    setWebSearch={setWebSearch}
                    typicalDuration={typicalDuration}
                    canRun={canRunAnalysis && !starting}
                    onRun={runAnalysis}
                    elapsedTime={elapsedTime}
                    analysisDuration={analysisDuration}
                    correlationId={correlationId}
                    onReset={() => {
                        setStatus("EMPTY");
                        setSteps([]);
                    }}
                />
            </Box>

        </Box>
    )
}
