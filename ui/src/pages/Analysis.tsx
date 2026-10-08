import { Flex, Text, Spinner, Box, HStack } from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { MdInfoOutline, MdCheck, MdClose, MdArrowForward } from "react-icons/md";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnalysisService, AgentService, SettingsService, API_BASE, isServerFreeModel } from "@/db";
import { formatSeconds, agentDisplayName } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import SkillAvatar from "@/components/shared/SkillAvatar";
import { useSkillLibrary } from "@/components/skills/SkillBrowser";
import { resolveAgent } from "@/lib/agentIdentity";
import { ModelLogo } from "@/lib/modelLogos";
import { AlertCircleIcon, Bot, ChevronDown, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList,
} from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, stagger, staggerItem, TypeText } from "@/lib/motion";
import { SourceMark, TickerLogo } from "@/lib/sourceLogos";

/** The one line this page opens with. */
const HEADLINE = "Which agent are we running today?";
const TAGLINE = "Market. Model. Magic.";

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

function StepSection({ done, collapsed, onToggle, summary, children }: { done: boolean; collapsed?: boolean; onToggle?: () => void; summary?: string; children: any }) {
    const headerIsButton = !!collapsed && !!onToggle;
    const summaryRow = (
        <>
            {summary && (
                <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" maxW="70%">
                    {summary}
                </Text>
            )}
            {done && <MdCheck size={12} color="var(--signal-positive)" aria-label="Selected" />}
        </>
    );
    return (
        <Box as={motion.div} variants={staggerItem} py={{ base: 4, md: 5 }}>
            {headerIsButton && (
                <Flex
                    as="button"
                    type="button"
                    onClick={onToggle}
                    align="center"
                    gap={2.5}
                    mb={4}
                    w="full"
                    cursor="pointer"
                    aria-expanded={false}
                    textAlign="left"
                >
                    {summaryRow}
                    <Text fontSize="10px" color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0} ml="auto">
                        Edit
                    </Text>
                </Flex>
            )}
            {/* Once a run has started the step locks: same one-line summary, no Edit. */}
            {collapsed && !headerIsButton && (
                <Flex align="center" gap={2.5} mb={4} w="full" textAlign="left">
                    {summaryRow}
                </Flex>
            )}
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



/** One compact selection chip used across both rail variants. */
function RailChip({ icon, label, sub, muted }: { icon?: React.ReactNode; label: string; sub?: string; muted?: boolean }) {
    return (
        <Flex align="center" gap={1.5} minW={0} flexGrow={1}>
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

/**
 * Run Now — a live call-to-action. Once every selection is made it keeps a
 * quiet heartbeat (a soft accent halo that breathes), signaling "tap me now"
 * without flashing. Reduced-motion users get the plain button via
 * MotionConfig reducedMotion="user".
 */
function RunNowCta({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
    const alive = !disabled;
    const beat = {
        duration: 2.2,
        ease: "easeInOut" as const,
        repeat: Infinity,
        times: [0, 0.12, 0.2, 0.32, 1],
    };
    return (
        <motion.div
            className="relative w-full"
            initial={false}
            animate={alive ? "heartbeat" : "still"}
            variants={{
                still: { scale: 1 },
                heartbeat: {
                    scale: [1, 1.025, 1, 1.012, 1],
                    transition: beat,
                },
            }}
        >
            <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-[3px] rounded-md"
                style={{ background: "color-mix(in srgb, var(--accent-primary) 16%, transparent)" }}
                animate={alive ? "heartbeat" : "still"}
                variants={{
                    still: { opacity: 0 },
                    heartbeat: {
                        opacity: [0, 0.9, 0, 0.45, 0],
                        transition: beat,
                    },
                }}
            />
            <Button size="lg" className="relative w-full font-semibold" onClick={onClick} disabled={disabled}>
                Run Now
            </Button>
        </motion.div>
    );
}

function RailWebSearch({ id, hasTavily, webSearch, setWebSearch }: { id: string; hasTavily: boolean; webSearch: boolean; setWebSearch: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
                <Label htmlFor={id} className="cursor-pointer text-[11.5px] font-medium text-[var(--ink-secondary)]">
                    Web search
                </Label>
                <p className="truncate text-[10.5px] text-[var(--ink-tertiary)]">
                    {hasTavily ? "Live sources beyond filings" : "Needs a Tavily key"}
                </p>
            </div>
            {hasTavily ? (
                <Switch
                    id={id}
                    size="sm"
                    checked={webSearch}
                    onCheckedChange={(next) => setWebSearch(!!next)}
                    className="shrink-0"
                />
            ) : (
                <Link to="/settings" className="shrink-0 text-[10.5px] text-[var(--accent-primary)] hover:underline">
                    Add
                </Link>
            )}
        </div>
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
    runMode: "agent" | "skill";
    skillName: string | null;
    skillObj: any;
    model: string;
    isDefaultModel: boolean;
    defaultModel: string;
    modelValidated: boolean;
    modelValidating: boolean;
    modelError: string | null;
    modelSiblings: number;
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
    const [personaOpen, setPersonaOpen] = useState(false);
    useEffect(() => setPersonaOpen(false), [props.agentName]);

    const companyLabel = props.share ? (props.shareName || props.share) : null;
    const agentDetail = typeof props.agentObj === "object" && props.agentObj ? props.agentObj : null;
    const persona = agentDetail?.philosophy || agentDetail?.persona?.philosophy_and_mindset || "";

    // ── Shared pieces ─────────────────────────────────────────────
    const companyChip = (
        <RailChip
            icon={
                props.share
                    ? <TickerLogo symbol={props.share} size={18} />
                    : <SourceMark source={props.source === "SEC" ? "sec" : "nse"} size={18} />
            }
            label={companyLabel || "Not set"}
            sub={props.share ? props.share.toUpperCase() : undefined}
            muted={!companyLabel}
        />
    );
    const agentChip = (
        <RailChip
            icon={props.agentName ? <AgentAvatar agent={props.agentObj ?? props.agentName} size={18} /> : undefined}
            label={props.agentName || "Not set"}
            muted={!props.agentName}
        />
    );
    const skillChip = (
        <RailChip
            icon={props.skillName ? <SkillAvatar skill={props.skillObj ?? props.skillName} size={18} /> : undefined}
            label={props.skillName || "Not set"}
            muted={!props.skillName}
        />
    );
    const modelChip = (
        <RailChip
            icon={props.model ? <ModelLogo model={props.model} size={15} /> : undefined}
            label={props.model ? modelName(props.model) : "Not set"}
            sub={props.model ? providerLabel(modelPrefix(props.model)) : undefined}
            muted={!props.model}
        />
    );

    // Rich "what exactly will run" blocks — the details that used to sit
    // beside each dropdown now live in the summary card itself.
    const agentBlock = props.agentName ? (
        <Flex direction="column" gap={2} minW={0}>
            <Flex align="center" gap={2.5} minW={0}>
                <AgentAvatar agent={props.agentObj ?? props.agentName} size={34} label={props.agentName} />
                <Box minW={0}>
                    <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                        {props.agentName}
                    </Text>
                    <Text fontSize="11px" color="var(--ink-tertiary)">
                        {agentDetail?.skills?.length || 0} skill{agentDetail?.skills?.length === 1 ? "" : "s"}
                    </Text>
                </Box>
            </Flex>
            {persona && (
                <Box minW={0}>
                    <Text fontSize="11px" color="var(--ink-secondary)" lineHeight="1.55" noOfLines={personaOpen ? undefined : 2}>
                        {persona}
                    </Text>
                    <button
                        type="button"
                        onClick={() => setPersonaOpen((v) => !v)}
                        className="mt-0.5 text-[10.5px] font-medium text-[var(--accent-primary)]"
                    >
                        {personaOpen ? "Show less" : "Read the persona"}
                    </button>
                </Box>
            )}
        </Flex>
    ) : null;

    const skillBlock = props.skillName ? (
        <Flex align="flex-start" gap={2.5} minW={0}>
            <SkillAvatar skill={props.skillObj ?? props.skillName} size={34} label={props.skillName} />
            <Box minW={0}>
                <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {props.skillName}
                </Text>
                <Text fontSize="10.5px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                    {props.skillObj?.category} · {props.skillObj?.source}
                </Text>
                <Text fontSize="11px" color="var(--ink-secondary)" lineHeight="1.55" noOfLines={2}>
                    {props.skillObj?.description}
                </Text>
            </Box>
        </Flex>
    ) : null;

    const modelDetail = props.model ? (
        <Flex direction="column" gap={1} minW={0}>
            <Flex align="center" gap={2}>
                <ModelLogo model={props.model} size={15} />
                <Text fontSize="10.5px" fontWeight={600} letterSpacing="0.06em" textTransform="uppercase" color="var(--accent-primary)">
                    {providerLabel(modelPrefix(props.model))}
                </Text>
                {props.isDefaultModel && (
                    <Text fontSize="9.5px" fontWeight={600} color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.04em" border="1px solid var(--hairline)" px={1.5} py={0.5} borderRadius="3px">
                        Recommended
                    </Text>
                )}
                {props.modelValidated && !props.modelValidating && !props.modelError && (
                    <MdCheck size={12} color="var(--signal-positive)" />
                )}
            </Flex>
            <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {modelName(props.model)}
            </Text>
            <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {props.model}
            </Text>
            <Text fontSize="10.5px" color="var(--ink-tertiary)">
                {props.modelSiblings > 0
                    ? `${props.modelSiblings} other model${props.modelSiblings === 1 ? "" : "s"} from `
                    : ""}
                {providerLabel(modelPrefix(props.model))}
                {props.model === props.defaultModel ? " · auto-selected default" : ""}
            </Text>
            {props.modelValidating ? (
                <Flex align="center" gap={1.5}>
                    <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
                    <Text fontSize="10.5px" color="var(--ink-tertiary)">Checking access…</Text>
                </Flex>
            ) : props.modelError ? (
                <Text fontSize="10.5px" color="var(--signal-negative)">Access could not be verified</Text>
            ) : props.modelValidated ? (
                <Text fontSize="10.5px" color="var(--signal-positive)">Access verified</Text>
            ) : null}
        </Flex>
    ) : null;

    const targetBlock = props.runMode === "skill"
        ? (skillBlock ?? skillChip)
        : (agentBlock ?? agentChip);

    const selectionBody = (
        <Flex direction="column" gap={3}>
            {companyChip}
            <Box borderTop="1px solid var(--hairline)" />
            {targetBlock}
            <Box borderTop="1px solid var(--hairline)" />
            {modelDetail ?? modelChip}
            <Box borderTop="1px solid var(--hairline)" my={0.5} />
            <RailWebSearch id="web-search-rail" hasTavily={props.hasTavily} webSearch={props.webSearch} setWebSearch={props.setWebSearch} />
        </Flex>
    );

    const actionArea = (() => {
        if (status === "PENDING") {
            return (
                <Flex direction="column" gap={2.5} w="full">
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
                    <Button variant="outline" onClick={props.onReset}>
                        Run another
                    </Button>
                </Flex>
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
                    <div className="flex w-full gap-2">
                        {props.correlationId && (
                            <Button asChild className="flex-1">
                                <Link to={`/analysis-result/${props.correlationId}`}>View report</Link>
                            </Button>
                        )}
                        <Button variant="outline" onClick={props.onReset}>
                            Run again
                        </Button>
                    </div>
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
                    <div className="flex w-full gap-2">
                        {props.correlationId && (
                            <Button asChild variant="outline" className="flex-1">
                                <Link to={`/analysis-result/${props.correlationId}`}>View report</Link>
                            </Button>
                        )}
                        <Button variant="outline" onClick={props.onReset} className="flex-1">
                            Try again
                        </Button>
                    </div>
                </Flex>
            );
        }
        // Idle / configuring (or resuming an in-flight run from a deep link)
        if (props.resuming) {
            return (
                <Button size="lg" className="w-full" disabled>
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
                <RunNowCta onClick={props.onRun} disabled={!props.canRun} />
                {!props.canRun && (
                    <Text mt={2} fontSize="11px" color="var(--ink-tertiary)" textAlign="center">
                        Choose a company and an agent or skill to enable the run
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
                w="360px"
                flexShrink={0}
            >
                <Card className="sticky top-[60px] gap-3 rounded-lg py-4 shadow-none">
                    <CardHeader className="px-4 pb-0">
                        <CardTitle className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                            Run summary
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4">
                        {status === "EMPTY" ? (
                            <Flex direction="column" gap={3}>
                                {selectionBody}
                                <Box borderTop="1px solid var(--hairline)" />
                                {actionArea}
                            </Flex>
                        ) : (
                            /* Run started: status + actions only — no edit affordances. */
                            actionArea
                        )}
                    </CardContent>
                </Card>
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
                    {props.runMode === "skill" ? skillChip : agentChip}
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
                    {selectionBody}
                </Box>
            )}
            <Box pt={2.5}>
                {status === "EMPTY" && !props.resuming ? (
                    <RunNowCta onClick={props.onRun} disabled={!props.canRun} />
                ) : status === "PENDING" ? (
                    <Button variant="outline" className="w-full mt-2.5" onClick={props.onReset}>
                        Run another
                    </Button>
                ) : status === "COMPLETED" ? (
                    <div className="mt-2.5 flex gap-2">
                        {props.correlationId && (
                            <Button asChild className="flex-1">
                                <Link to={`/analysis-result/${props.correlationId}`}>View report</Link>
                            </Button>
                        )}
                        <Button variant="outline" onClick={props.onReset}>
                            Run again
                        </Button>
                    </div>
                ) : status === "ERROR" ? (
                    <div className="mt-2.5 flex gap-2">
                        {props.correlationId && (
                            <Button asChild variant="outline" className="flex-1">
                                <Link to={`/analysis-result/${props.correlationId}`}>View report</Link>
                            </Button>
                        )}
                        <Button variant="outline" onClick={props.onReset} className="flex-1">
                            Try again
                        </Button>
                    </div>
                ) : null}
            </Box>
        </Box>
    );
}

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [recentRuns, setRecentRuns] = useState<any[]>([]);
    const [availableAgents, setAvailableAgents] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (status === "PENDING") {
            // Anchor to the run's persisted start, not page-load time, so a
            // refresh mid-run resumes the clock instead of restarting at 0.
            const start = startedAt ?? Date.now();
            const tick = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)));
            tick();
            const interval = setInterval(tick, 1000);
            return () => clearInterval(interval);
        }
    }, [status, startedAt]);

    useEffect(() => {
        let cancelled = false;
        AnalysisService.listAnalyses()
            .then((data) => {
                if (cancelled || !Array.isArray(data)) return;
                setRecentRuns(data);
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

    // Skill-evaluation mode: run a single skill standalone instead of the agent.
    const [runMode, setRunMode] = useState<"agent" | "skill">("agent");
    const [skillId, setSkillId] = useState("");
    const { library: skillLibrary } = useSkillLibrary();
    const selectedSkill = useMemo(
        () => skillLibrary.find((s: any) => s.id === skillId) || null,
        [skillLibrary, skillId]
    );

    const sourceKeyMap: Record<string, { mainKey: string; secondaryKey: string; nameField: string }> = {
        SEC: { mainKey: "ticker", secondaryKey: "name", nameField: "name" },
        NSE: { mainKey: "SYMBOL", secondaryKey: "NAME", nameField: "NAME" },
    };

    const sourceKeys = sourceKeyMap[config.source] || sourceKeyMap.SEC;

    // Company search runs server-side: the combobox only renders what the
    // endpoint returns for the current market, debounced while typing.
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
    const [providerCount, setProviderCount] = useState(0);
    const [selectedModel, setSelectedModel] = useState("");
    const [hasTavily, setHasTavily] = useState(false);
    const [webSearch, setWebSearch] = useState(true);
    const [modelValidated, setModelValidated] = useState(false);

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
            // LLM keys only — Tavily is web search, not a model provider, and
            // counting it left keyless users with Ollama-only model lists.
            const llmKeys = keys.filter((k) => k !== "tavily");
            const models = llmKeys.length > 0
                ? allModels.filter((m: string) => {
                    const provider = m.split("/")[0];
                    // Server-free providers (groq, gemini, cerebras, openrouter,
                    // …) run on the server's key pool — always offer them.
                    return provider === "ollama" || llmKeys.includes(provider) || isServerFreeModel(m);
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
    const [runError, setRunError] = useState<string | null>(null);
    const runAnalysis = async () => {
        // In-flight guard: the model check below awaits a network round-trip
        // before the POST fires, and during that window the button is still
        // rendered enabled — without this, a second click starts a duplicate run.
        if (starting || status !== "EMPTY") return;
        if (!config.source || !config.share) return;
        if (runMode === "skill" ? !skillId : !config.agent) return;

        setStarting(true);
        setRunError(null);
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
                run_mode: runMode,
                skill_id: runMode === "skill" ? skillId : undefined,
            });

            if (result && (result.corr_id || result.analysis_id)) {
                setSteps([]);
                setCorrelationId(result.corr_id || result.analysis_id);
                setStartedAt(Date.now());
                setStatus("PENDING");
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
                    agent: data.agent_name || data.agent || prev.agent,
                    source: exchangeSrc,
                }));

                setCorrelationId(analysisId);

                if (Array.isArray(data.steps)) setSteps(data.steps);
                // started_at is when the run actually began; created_at is
                // queue time. Prefer the former so the live clock is honest.
                const runStart = data.started_at || data.created_at;
                if (runStart) setStartedAt(+new Date(runStart));

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

    // Completed steps collapse to a one-line summary; the active step stays open.
    const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({});
    const stepSummary = (step: string) => {
        if (step === "company") return config.share ? `${config.source} · ${config.share.toUpperCase()}` : undefined;
        if (step === "agent") {
            const target = runMode === "skill"
                ? selectedSkill?.name
                : (config.agent ? agentDisplayName(config.agent, availableAgents) || config.agent : undefined);
            const model = selectedModel ? modelName(selectedModel) : undefined;
            return [target, model].filter(Boolean).join(" · ") || undefined;
        }
        return undefined;
    };

    // Steps stay open while the user configures the run — selecting a company
    // or an agent must not fold the form away under them. Everything collapses
    // only once a run is actually in flight.
    useEffect(() => {
        if (status === "PENDING" || status === "COMPLETED" || status === "ERROR") {
            setCollapsedSteps({ company: true, agent: true });
        }
    }, [status]);
    useEffect(() => {
        if (status === "EMPTY") setCollapsedSteps({});
    }, [status]);
    const siblingModelCount = useCallback(
        (id: string) => availableModels.filter((m) => modelPrefix(m) === modelPrefix(id)).length - 1,
        [availableModels]
    );
    const isConfigComplete = config.share !== "" && (runMode === "skill" ? !!skillId : !!config.agent);
    const canRunAnalysis = isConfigComplete;
    const modelSiblings = selectedModel ? siblingModelCount(selectedModel) : 0;

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
        >
            <Box flex={1} w="full" minW={0}>
                <Flex direction="column" maxW="1240px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 4, md: 6 }}>
                    {/* Opening line — the only untriggered motion on the page. */}
                    <Box w="full" mb={{ base: 5, md: 7 }}>
                        <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={4} wrap="wrap">
                            <Box>
                                <TypeText
                                    as="h1"
                                    text={HEADLINE}
                                    delay={0.15}
                                    className="text-[26px] leading-[1.15] font-semibold tracking-tight text-[var(--ink-primary)] md:text-[34px]"
                                />
                                <TypeText
                                    as="p"
                                    text={TAGLINE}
                                    delay={0.15 + (HEADLINE.length + 1) / 40}
                                    cps={60}
                                    className="mt-2 text-[13px] md:text-[15px] text-[var(--ink-tertiary)]"
                                />
                            </Box>
                            <Button variant="ghost" asChild className="shrink-0 gap-1.5 text-[13px]">
                                <Link to="/analysis-list">
                                    View past analyses
                                    <MdArrowForward size={15} color="var(--ink-tertiary)" />
                                </Link>
                            </Button>
                        </Flex>
                    </Box>

                    {/* Running now strip */}
                    <RunningNow agents={availableAgents} />

                    {/* A start that fails is reported here, in place. */}
                    <AnimatePresence initial={false}>
                        {status === "ERROR" && runError && (
                            <Box
                                as={motion.div}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: dur.base, ease }}
                                overflow="hidden"
                                mb={3}
                            >
                                <Alert variant="destructive" className="max-w-2xl">
                                    <AlertCircleIcon />
                                    <AlertTitle>Analysis did not start</AlertTitle>
                                    <AlertDescription>{runError}</AlertDescription>
                                </Alert>
                            </Box>
                        )}
                    </AnimatePresence>

                    {/* Two-zone layout: steps (main) + sticky summary rail (side). The rail
                        renders in normal flow below on mobile. */}
                    <Flex direction={{ base: "column", lg: "row" }} gap={{ base: 0, lg: 8 }} align={{ lg: "flex-start" }}>
                    <Flex direction="column" flex={1} minW={0} as={motion.div} variants={stagger} initial="initial" animate="animate">
                        {/* Company: market + ticker */}
                        <StepSection done={!!config.share} collapsed={!!collapsedSteps["company"]} onToggle={status === "EMPTY" ? () => setCollapsedSteps(p => ({ ...p, company: !p["company"] })) : undefined} summary={stepSummary("company")}>
                            <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                <Box w={{ base: "full", md: "180px" }} flexShrink={0}>
                                    <FieldLabel>Market</FieldLabel>
                                    <ToggleGroup
                                        type="single"
                                        value={config.source}
                                        onValueChange={(v: string) => { if (v) handleSourceChange(v); }}
                                        aria-label="Market"
                                    >
                                        <ToggleGroupItem value="NSE" aria-label="NSE, India" className="flex items-center justify-center gap-1.5">
                                            <SourceMark source="nse" size={16} />
                                            <Text fontSize="13px" lineHeight="1">NSE</Text>
                                        </ToggleGroupItem>
                                        <ToggleGroupItem value="SEC" aria-label="SEC, United States" className="flex items-center justify-center gap-1.5">
                                            <SourceMark source="sec" size={16} />
                                            <Text fontSize="13px" lineHeight="1">SEC</Text>
                                        </ToggleGroupItem>
                                    </ToggleGroup>
                                </Box>
                                <Box flex={1} minW={0}>
                                    <FieldLabel>Company</FieldLabel>
                                    <Combobox
                                        key={config.source}
                                        items={stockItems}
                                        value={config.share}
                                        filter={false}
                                        displayValue={config.share ? config.shareName || config.share : ""}
                                        itemToValue={(s: any) => s[sourceKeys.mainKey]}
                                        onQueryChange={setStockQuery}
                                        onValueChange={(v) => {
                                            if (!v) {
                                                setConfig(prev => ({ ...prev, share: "", shareName: "" }));
                                                return;
                                            }
                                            const item = stockItems.find((s: any) => s[sourceKeys.mainKey] === v);
                                            handleConfigChange("share", v, item);
                                        }}
                                    >
                                        <ComboboxInput
                                            placeholder={config.source === "SEC" ? "Search US stocks (e.g., AAPL)" : "Search Indian stocks (e.g., RELIANCE)"}
                                            showClear
                                        />
                                        <ComboboxContent>
                                            {stockLoading && (
                                                <div className="flex items-center justify-center gap-2 py-5 text-[13px] text-muted-foreground">
                                                    <Spinner size="xs" borderWidth="1px" color="var(--ink-tertiary)" />
                                                    Searching…
                                                </div>
                                            )}
                                            <ComboboxEmpty>
                                                {stockQuery
                                                    ? `Nothing matches “${stockQuery}”.`
                                                    : "Type a company name or ticker to search."}
                                            </ComboboxEmpty>
                                            <ComboboxList>
                                                {(stock: any) => (
                                                    <ComboboxItem
                                                        key={stock[sourceKeys.mainKey]}
                                                        value={stock[sourceKeys.mainKey]}
                                                    >
                                                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                                                            <span className="flex min-w-0 items-center gap-2">
                                                                <TickerLogo symbol={stock[sourceKeys.mainKey]} size={18} />
                                                                <span className="truncate text-[13px] font-medium">
                                                                    {stock[sourceKeys.mainKey]}
                                                                </span>
                                                            </span>
                                                            <span className="truncate text-[11px] text-muted-foreground">
                                                                {stock[sourceKeys.secondaryKey]}
                                                            </span>
                                                        </span>
                                                    </ComboboxItem>
                                                )}
                                            </ComboboxList>
                                        </ComboboxContent>
                                    </Combobox>
                                </Box>
                            </Flex>
                        </StepSection>

                        {/* Agent / Skill + Model — the "who runs the analysis" row */}
                        <StepSection
                            done={runMode === "skill" ? !!skillId : !!config.agent}
                            collapsed={!!collapsedSteps["agent"]}
                            onToggle={status === "EMPTY" ? () => setCollapsedSteps(p => ({ ...p, agent: !p["agent"] })) : undefined}
                            summary={stepSummary("agent")}
                        >
                            <Flex direction="column" gap={5}>
                                {/* Mode toggle: each option explains itself, no jargon needed. */}
                                <ToggleGroup
                                    type="single"
                                    value={runMode}
                                    onValueChange={(v) => { if (v) setRunMode(v as "agent" | "skill"); }}
                                    aria-label="Evaluation mode"
                                    className="w-full h-auto md:w-fit"
                                >
                                    <ToggleGroupItem
                                        value="agent"
                                        aria-label="Agent — runs the full agent with all its skills"
                                        className="group h-auto flex-col items-center justify-center gap-1 px-4 py-2 data-[state=on]:bg-[var(--accent-primary)] data-[state=on]:text-white"
                                    >
                                        <span className="flex items-center justify-center gap-1.5 text-[13px] font-semibold leading-none group-data-[state=on]:text-white">
                                            <Bot size={13} aria-hidden />
                                            Agent
                                        </span>
                                        <span className="text-[10px] leading-tight font-normal text-[var(--ink-tertiary)] group-data-[state=on]:text-white/80">
                                            Runs the full agent with many skills
                                        </span>
                                    </ToggleGroupItem>
                                    <ToggleGroupItem
                                        value="skill"
                                        aria-label="Skill — analyzes a single skill on its own"
                                        className="group h-auto flex-col items-center justify-center gap-1 px-4 py-2 data-[state=on]:bg-[var(--signal-positive)] data-[state=on]:text-white"
                                    >
                                        <span className="flex items-center justify-center gap-1.5 text-[13px] font-semibold leading-none group-data-[state=on]:text-white">
                                            <Target size={13} aria-hidden />
                                            Skill
                                        </span>
                                        <span className="text-[10px] leading-tight font-normal text-[var(--ink-tertiary)] group-data-[state=on]:text-white/80">
                                            Analyzes one skill on its own
                                        </span>
                                    </ToggleGroupItem>
                                </ToggleGroup>

                                <Flex direction={{ base: "column", md: "row" }} gap={{ base: 4, md: 6 }} align={{ md: "flex-start" }}>
                                    {runMode === "agent" ? (
                                        <Box flex={1} minW={0}>
                                            <FieldLabel>Agent</FieldLabel>
                                            <Combobox
                                                items={availableAgents}
                                                value={config.agent}
                                                itemToValue={(a: any) => a._id || a.id || a.name}
                                                itemToString={(a: any) => a.name}
                                                onValueChange={(v) => setConfig(prev => ({ ...prev, agent: v }))}
                                            >
                                                <ComboboxInput placeholder="Select an agent" showClear />
                                                <ComboboxContent>
                                                    <ComboboxEmpty>No agents found.</ComboboxEmpty>
                                                    <ComboboxList>
                                                        {(agent: any) => {
                                                            const value = agent._id || agent.id || agent.name;
                                                            const skillCount = (agent.skills || []).length;
                                                            return (
                                                                <ComboboxItem key={value} value={value} searchText={agent.name}>
                                                                    <AgentAvatar agent={agent} size={22} />
                                                                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                                                                        {agent.name}
                                                                    </span>
                                                                    <span className="shrink-0 text-[11px] text-muted-foreground/60">
                                                                        {skillCount} skill{skillCount === 1 ? "" : "s"}
                                                                    </span>
                                                                </ComboboxItem>
                                                            );
                                                        }}
                                                    </ComboboxList>
                                                </ComboboxContent>
                                            </Combobox>
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
                                    ) : (
                                        <Box flex={1} minW={0}>
                                            <FieldLabel>Skill</FieldLabel>
                                            <Combobox
                                                items={skillLibrary}
                                                value={skillId}
                                                itemToValue={(s: any) => s.id}
                                                itemToString={(s: any) => s.name}
                                                onValueChange={(v) => setSkillId(v)}
                                            >
                                                <ComboboxInput placeholder="Select a skill" showClear />
                                                <ComboboxContent>
                                                    <ComboboxEmpty>No skills found.</ComboboxEmpty>
                                                    <ComboboxList>
                                                        {(skill: any) => (
                                                            <ComboboxItem key={skill.id} value={skill.id} searchText={skill.name}>
                                                                <SkillAvatar skill={skill} size={22} />
                                                                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                                                                    {skill.name}
                                                                </span>
                                                                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                                                                    {skill.category}
                                                                </span>
                                                            </ComboboxItem>
                                                        )}
                                                    </ComboboxList>
                                                </ComboboxContent>
                                            </Combobox>
                                            <Flex align="center" gap={1.5} mt={1.5}>
                                                <MdInfoOutline size={12} color="var(--ink-tertiary)" />
                                                <Text fontSize="11px" color="var(--ink-tertiary)">
                                                    Just this skill — no agent, no persona. Useful for testing it on its own.
                                                </Text>
                                            </Flex>
                                        </Box>
                                    )}
                                    <Box flex={1} minW={0}>
                                        <FieldLabel>Model</FieldLabel>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface-panel px-3 py-1.5 text-left transition-colors hover:border-ink-tertiary focus-visible:border-accent-primary"
                                                    style={{ borderColor: "var(--hairline)", background: "var(--surface-panel)", minHeight: "36px" }}
                                                    aria-label="Model"
                                                >
                                                    {selectedModel ? (
                                                        <>
                                                            <ModelLogo model={selectedModel} size={15} />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-[12.5px] font-medium leading-tight" style={{ color: "var(--ink-primary)" }}>
                                                                    {modelName(selectedModel)}
                                                                </span>
                                                                <span className="block truncate font-mono text-[10px] leading-tight" style={{ color: "var(--ink-tertiary)" }}>
                                                                    {selectedModel}
                                                                </span>
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="flex-1 text-[12.5px]" style={{ color: "var(--ink-tertiary)" }}>Select model</span>
                                                    )}
                                                    <ChevronDown size={14} color="var(--ink-tertiary)" style={{ flexShrink: 0 }} />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 w-72 overflow-y-auto">
                                                {(() => {
                                                    const groups = new Map<string, string[]>();
                                                    for (const m of availableModels) {
                                                        const p = modelPrefix(m);
                                                        if (!groups.has(p)) groups.set(p, []);
                                                        groups.get(p)!.push(m);
                                                    }
                                                    // Recommended model's group leads, and the model leads within it.
                                                    const order = [...groups.keys()];
                                                    if (defaultModel) {
                                                        const dp = modelPrefix(defaultModel);
                                                        if (order.includes(dp)) {
                                                            order.splice(order.indexOf(dp), 1);
                                                            order.unshift(dp);
                                                            groups.set(dp, [defaultModel, ...groups.get(dp)!.filter(m => m !== defaultModel)]);
                                                        }
                                                    }
                                                    return order.map((prefix) => (
                                                        <DropdownMenuGroup key={prefix}>
                                                            <DropdownMenuLabel>
                                                                <Flex align="center" gap={1.5}>
                                                                    <ModelLogo model={prefix} size={12} />
                                                                    <Text fontSize="10px" fontWeight={600} color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.06em">
                                                                        {providerLabel(prefix)}
                                                                    </Text>
                                                                    <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" ml="auto">
                                                                        {groups.get(prefix)!.length}
                                                                    </Text>
                                                                </Flex>
                                                            </DropdownMenuLabel>
                                                            {groups.get(prefix)!.map((m) => (
                                                                <DropdownMenuItem key={m} value={m} onClick={() => { setSelectedModel(m); setModelError(null); }}>
                                                                    <ModelLogo model={m} size={15} />
                                                                    <Box minW={0} flex={1}>
                                                                        <Text as="span" display="block" fontSize="12.5px" fontWeight={m === selectedModel ? 600 : 500} color="var(--ink-primary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" lineHeight="1.3">
                                                                            {modelName(m)}
                                                                        </Text>
                                                                        <Text as="span" display="block" fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" lineHeight="1.3">
                                                                            {m}
                                                                        </Text>
                                                                    </Box>
                                                                    {m === defaultModel && (
                                                                        <Text fontSize="9.5px" fontWeight={600} color="var(--accent-primary)" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0}>
                                                                            Recommended
                                                                        </Text>
                                                                    )}
                                                                    {m === selectedModel && <MdCheck size={13} color="var(--signal-positive)" flexShrink={0} />}
                                                                </DropdownMenuItem>
                                                            ))}
                                                        </DropdownMenuGroup>
                                                    ));
                                                })()}
                                                {availableModels.length === 0 && (
                                                    <DropdownMenuItem disabled>No models available</DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        {validatingModel && (
                                            <Flex align="center" gap={1.5} mt={1.5}>
                                                <Spinner size="xs" color="var(--ink-secondary)" />
                                                <Text fontSize="11px" color="var(--ink-secondary)">Checking model access…</Text>
                                            </Flex>
                                        )}
                                        {modelError && (
                                            <Text mt={2} fontSize="11.5px" color="var(--signal-negative)">
                                                {modelError}
                                            </Text>
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
                                </Flex>
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
                        runMode={runMode}
                        skillName={selectedSkill?.name || null}
                        skillObj={selectedSkill}
                        model={selectedModel || ""}
                        isDefaultModel={!!selectedModel && selectedModel === defaultModel}
                        defaultModel={defaultModel}
                        modelValidated={modelValidated}
                        modelValidating={validatingModel}
                        modelError={modelError}
                        modelSiblings={modelSiblings}
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
                            // Clear the route id too: resuming = !!id && EMPTY, so
                            // staying on /analysis/:id would re-render as "Resuming".
                            navigate("/analysis");
                            setStatus("EMPTY");
                            setRunError(null);
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
                                        <Text fontSize="13px">Analysis in progress. This page updates automatically.</Text>
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
                                <Box maxW="460px" mb={4}>
                                    <Progress value={runProgressPct(steps)}>
                                        <ProgressLabel>Analysis progress</ProgressLabel>
                                        <ProgressValue />
                                    </Progress>
                                </Box>
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
                    runMode={runMode}
                    skillName={selectedSkill?.name || null}
                    skillObj={selectedSkill}
                    model={selectedModel || ""}
                    isDefaultModel={!!selectedModel && selectedModel === defaultModel}
                    defaultModel={defaultModel}
                    modelValidated={modelValidated}
                    modelValidating={validatingModel}
                    modelError={modelError}
                    modelSiblings={modelSiblings}
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
                        navigate("/analysis");
                        setStatus("EMPTY");
                        setRunError(null);
                        setSteps([]);
                    }}
                />
            </Box>

        </Box>
    )
}
