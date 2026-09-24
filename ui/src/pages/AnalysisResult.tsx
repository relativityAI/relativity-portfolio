import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
    Box,
    Flex,
    Text,
    Spinner,
    Container,
    Button,
    Grid,
    Table,
    HStack,
    VStack,
    Tabs,
} from "@chakra-ui/react";
import { AnalysisService, AgentService, API_BASE } from "@/db";
import axios from "axios";
import { formatSeconds, agentDisplayName } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { resolveAgent } from "@/lib/agentIdentity";
import { ModelLogo } from "@/lib/modelLogos";
import type { TraceEvent } from "./shared/TracePanel";
import AgentActivity from "../components/shared/AgentActivity";
import ReactMarkdown from "react-markdown";
import { MdArrowBack, MdDownload, MdExpandMore, MdExpandLess } from "react-icons/md";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { CountUp, dur, ease } from "@/lib/motion";
import { SOURCE_DEFS, SourceMark, sourcesUsedForParam, type SourceKey } from "@/lib/sourceLogos";
import { ReportBlockRenderer } from "../components/builder/ReportBlockRenderer";
import {
    currencyForSource,
    formatCurrencyForMarket,
    bandForScore,
    scoreSignal as bandSignal,
    stripScoreScaffolding,
    coverageLabel,
    insufficientCoverage,
} from "@/lib/analysisFormat";
import { summarizeToolResult } from "@/lib/toolResultSummary";

const TABS = ["report", "reasoning"] as const;
type Tab = (typeof TABS)[number];

function scoreSignal(score: number): "positive" | "caution" | "negative" {
    // Shared band semantics (0.7/D4): one scale, one definition.
    return bandSignal(score);
}

function signalColor(signal: "positive" | "caution" | "negative"): string {
    if (signal === "positive") return "var(--signal-positive)";
    if (signal === "caution") return "var(--signal-caution)";
    return "var(--signal-negative)";
}

function formatDuration(sec: number): string {
    if (sec == null) return "N/A";
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }
    return `${sec.toFixed(1)}s`;
}

function formatValue(val: any, type?: string, currency: "INR" | "USD" = "USD"): string {
    if (val == null) return "—";
    if (type === "currency" && typeof val === "number") return formatCurrencyForMarket(val, currency);
    if (typeof val === "number") {
        if (Number.isInteger(val)) return val.toLocaleString();
        return val.toFixed(2);
    }
    return String(val);
}

function formatToolOutput(val: any): string {
    if (val == null) return "";
    if (typeof val === "string") return val;
    try {
        return JSON.stringify(val, null, 2);
    } catch {
        return String(val);
    }
}

const OP_SYMBOL: Record<string, string> = {
    gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between",
};

function isMacroSection(section: string): boolean {
    return String(section || "").toLowerCase().includes("macro");
}

function generateVerdict(totalScore: number | null, quant: Record<string, any>, qual: Record<string, any>): string {
    if (totalScore == null) return "Analysis completed. Review quantitative and qualitative sections for details.";
    // E3 fix: everything here is on the 0–100 scale now (the old code compared
    // 0–100 scores against 0.7/0.4, labelling almost anything "supportive").
    const quantEntries = Object.values(quant);
    const live = quantEntries.filter((m: any) => !m.price_unavailable);
    const passed = live.filter((m: any) => (m.score ?? 0) >= 70).length;
    const failed = live.filter((m: any) => (m.score ?? 0) < 40).length;
    const unavailable = quantEntries.length - live.length;
    const qualEntries = Object.values(qual);
    const qualScored = qualEntries.filter((p) => !p.error);
    const qualAvg = qualScored.length > 0
        ? qualScored.reduce((s, p) => s + (p.score ?? 0), 0) / qualScored.length
        : 0;
    const macroScored = qualScored.filter((p) => isMacroSection(p.section));
    const macroAvg = macroScored.length > 0
        ? macroScored.reduce((s, p) => s + (p.score ?? 0), 0) / macroScored.length
        : null;

    let sentence = `Passes ${passed} of ${quantEntries.length} quantitative gates`;
    if (failed > 0) {
        const failedNames = live
            .filter((m: any) => (m.score ?? 0) < 40)
            .slice(0, 3)
            .map((m: any) => m.metric_name)
            .join(", ");
        sentence += `; ${failed} underperforming${failedNames ? ` (${failedNames})` : ""}`;
    }
    sentence += ".";
    if (unavailable > 0) {
        sentence += ` ${unavailable} price-dependent ${unavailable === 1 ? "criterion" : "criteria"} not scored (live price unavailable).`;
    }
    if (qualScored.length > 0) {
        const qualLabel = qualAvg >= 70 ? "supportive" : qualAvg >= 40 ? "moderately supportive" : "mixed";
        sentence += ` Qualitative narrative is ${qualLabel}.`;
    }
    if (macroAvg != null) {
        const macroLabel = macroAvg >= 70 ? "supportive" : macroAvg >= 40 ? "moderately supportive" : "mixed";
        sentence += ` Macro (market) narrative is ${macroLabel}.`;
    }
    if (qualEntries.some((p) => p.error)) {
        sentence += " Some qualitative parameters failed to score.";
    }
    return sentence;
}

export function tokensUsed(qualAnalysis: Record<string, any>): { input: number; output: number; total: number } | null {
    let input = 0;
    let output = 0;
    for (const entry of Object.values(qualAnalysis)) {
        const t = entry?.tokens;
        if (!t) continue;
        input += typeof t.input === "number" ? t.input : 0;
        output += typeof t.output === "number" ? t.output : 0;
    }
    if (input + output === 0) return null;
    return { input, output, total: input + output };
}

export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export default function AnalysisResult() {
    const { id } = useParams();
    const reducedMotion = useReducedMotion();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pdfState, setPdfState] = useState<"idle" | "busy" | "error">("idle");
    const [activeTab, setActiveTab] = useState<Tab>("report");
    const [sortByScore, setSortByScore] = useState<"asc" | "desc" | null>(null);
    const [activeSection, setActiveSection] = useState<string>("");
    const [elapsed, setElapsed] = useState(0);

    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

    const [agents, setAgents] = useState<any[]>([]);

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => {
                if (Array.isArray(data)) setAgents(data);
            })
            .catch(() => {});
    }, []);

    const agentName = (raw: string | undefined) => agentDisplayName(raw, agents) || raw;

    const statusKey = (analysis?.status || "").toLowerCase();
    const terminalStatuses = ["complete", "completed", "success", "error", "failed"];
    const isRunning = !!analysis && !terminalStatuses.includes(statusKey);
    const isComplete = !!analysis && terminalStatuses.includes(statusKey);
    const isErrorEarly = statusKey === "error" || statusKey === "failed";

    useEffect(() => {
        if (!isRunning) {
            setElapsed(0);
            return;
        }
        setElapsed(0);
        const start = Date.now();
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isRunning]);

    const fetchCancelled = useRef(false);
    const fetchTimer = useRef<number | null>(null);
    useEffect(() => {
        fetchCancelled.current = false;
        const run = () => {
            if (fetchCancelled.current || !id) return;
            (async () => {
                try {
                    setLoading(true);
                    const data = await AnalysisService.readAnalysis(id);
                    if (fetchCancelled.current) return;
                    if (data) {
                        setAnalysis(data);
                        const s = (data.status || "").toLowerCase();
                        if (s === "pending" || s === "running" || s === "processing") {
                            fetchTimer.current = window.setTimeout(run, 3000);
                        }
                    } else {
                        setError("Analysis not found");
                    }
                } catch {
                    if (!fetchCancelled.current) setError("Failed to load analysis result");
                } finally {
                    if (!fetchCancelled.current) setLoading(false);
                }
            })();
        };
        run();
        return () => {
            fetchCancelled.current = true;
            if (fetchTimer.current != null) window.clearTimeout(fetchTimer.current);
        };
    }, [id]);

    // While a run is ongoing, the only populated tab is the live reasoning view.
    useEffect(() => {
        if (isRunning) {
            setActiveTab("reasoning");
            return;
        }
    }, [isRunning]);

    // U3: when a run finishes (running → complete without error), land the user
    // on the report. A user who deliberately switched tabs after completion is
    // not yanked — this only fires on the completion transition.
    const prevIsRunning = useRef(false);
    useEffect(() => {
        const wasRunning = prevIsRunning.current;
        prevIsRunning.current = isRunning;
        if (wasRunning && !isRunning && !isErrorEarly) {
            setActiveTab("report");
        }
    }, [isRunning, isErrorEarly]);

    // U4: the Report tab is not populated while a run is in progress.
    const reportAvailable = isComplete;

    const handleTabChange = useCallback((details: { value: string }) => {
        const tab = details.value as Tab;
        setActiveTab(tab);
        // Only scroll the tab panel into view when its top is above the
        // viewport (hidden under the sticky bar); never force-scroll otherwise.
        requestAnimationFrame(() => {
            const el = document.getElementById("tab-panels");
            if (el) {
                const top = el.getBoundingClientRect().top;
                if (top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }, []);

    const registerSection = useCallback((key: string, el: HTMLElement | null) => {
        sectionRefs.current[key] = el;
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting);
                if (visible.length > 0) {
                    const top = visible.reduce((a, b) =>
                        a.boundingClientRect.top < b.boundingClientRect.top ? a : b
                    );
                    setActiveSection(top.target.getAttribute("data-section") || "");
                }
            },
            { rootMargin: "-120px 0px -60% 0px", threshold: 0 }
        );

        Object.values(sectionRefs.current).forEach((el) => {
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [analysis]);

    // Resolve reported citedKeys/sourceKeys to concrete data points for captions.
    const evidenceLookup = useMemo(() => {
        const m: Record<string, string> = {};
        const quant = analysis?.quantitative_analysis || {};
        for (const [k, d] of Object.entries(quant)) {
            const label = d.metric_name || k;
            const rule = `${OP_SYMBOL[d.operator] || "="} ${d.threshold ?? "—"}`;
            const line = d.price_unavailable
                ? `${label} → N/A (no live price)`
                : `${label} ${rule} → ${d.value ?? "—"} · score ${Math.round((d.score ?? 0) * 10) / 10}`;
            m[k] = line;
            m[label] = line;
        }
        const qual = analysis?.qualitative_analysis || {};
        for (const [k, p] of Object.entries(qual)) {
            const line = p.error ? `score N/A (${p.error})` : `score ${Math.round((p.score ?? 0) * 10) / 10}`;
            m[k] = line;
        }
        return m;
    }, [analysis]);

    if (loading && !analysis) {
        // 5e: skeleton of the real layout instead of a bare spinner — no layout shift.
        return (
            <Box bg="var(--surface-canvas)" minH="100%">
                <Container maxW="1120px" mx="auto" px={{ base: 4, md: 6 }} py={6}>
                    <VStack gap={4} align="stretch">
                        <HStack justify="space-between" align="center">
                            <HStack gap={3}>
                                <Box h="24px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" />
                                <Box h="24px" w="180px" bg="var(--surface-recessed)" borderRadius="6px" />
                            </HStack>
                            <Box h="28px" w="120px" bg="var(--surface-recessed)" borderRadius="6px" />
                        </HStack>
                        <Box h="20px" w="60%" bg="var(--surface-recessed)" borderRadius="6px" />
                        <Box border="1px solid var(--hairline)" borderRadius="6px" p={6}>
                            <HStack gap={8} align="flex-start">
                                <Box>
                                    <Box h="16px" w="160px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="52px" w="110px" bg="var(--surface-recessed)" borderRadius="6px" />
                                </Box>
                                <Box flex={1}>
                                    <Box h="16px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="6px" w="100%" bg="var(--surface-recessed)" borderRadius="3px" />
                                </Box>
                                <Box flex={1}>
                                    <Box h="16px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="6px" w="100%" bg="var(--surface-recessed)" borderRadius="3px" />
                                </Box>
                            </HStack>
                        </Box>
                        {[0, 1, 2].map((i) => (
                            <Box key={i} border="1px solid var(--hairline)" borderRadius="6px" px={4} py={3}>
                                <HStack justify="space-between">
                                    <Box h="16px" w={`${45 - i * 8}%`} bg="var(--surface-recessed)" borderRadius="6px" />
                                    <Box h="16px" w="48px" bg="var(--surface-recessed)" borderRadius="6px" />
                                </HStack>
                            </Box>
                        ))}
                        <Flex justify="center" py={2}>
                            <Spinner size="sm" borderWidth="2px" color="var(--ink-secondary)" />
                        </Flex>
                    </VStack>
                </Container>
            </Box>
        );
    }

    if (error) {
        return (
            <Container maxW="960px" py={12}>
                <Flex direction="column" align="center" minH="50vh" gap={4}>
                    <Box maxW="520px">
                        <Callout tone="negative" title="Something went wrong">
                            {error}
                        </Callout>
                    </Box>
                    <HStack gap={3}>
                        <Link to="/analysis-list" style={{ textDecoration: "none" }}>
                            <Button variant="subtle" size="sm" color="var(--ink-secondary)">
                                <MdArrowBack style={{ marginRight: 6 }} /> Back to List
                            </Button>
                        </Link>
                        <Button
                            variant="solid"
                            size="sm"
                            onClick={() => {
                                setError(null);
                                setLoading(true);
                                fetchTimer.current != null && window.clearTimeout(fetchTimer.current);
                                fetchCancelled.current = false;
                                (async () => {
                                    try {
                                        const data = await AnalysisService.readAnalysis(id!);
                                        if (data) setAnalysis(data);
                                        else setError("Analysis not found");
                                    } catch {
                                        setError("Failed to load analysis result");
                                    } finally {
                                        setLoading(false);
                                    }
                                })();
                            }}
                        >
                            Retry
                        </Button>
                    </HStack>
                </Flex>
            </Container>
        );
    }

    if (!analysis) return null;

    const s = (analysis.status || "").toLowerCase();
    const isError = s === "error" || s === "failed";

    const exchangeSource: SourceKey = /nse/i.test(String(analysis.source || "")) ? "nse" : "sec";
    const quantAnalysis: Record<string, any> = analysis.quantitative_analysis || {};
    const qualAnalysis: Record<string, any> = analysis.qualitative_analysis || {};
    const toolCalls = analysis.qualitative_tool_calls || {};
    const docs: any[] = analysis.documents || [];
    const webSrc: string[] = analysis.web_sources || [];

    const tokenUse = tokensUsed(qualAnalysis);
    const traceCount = Array.isArray(analysis.trace) ? analysis.trace.length : 0;

    const assetQuant = Object.entries(quantAnalysis)
        .filter(([, d]) => !isMacroSection(d?.section))
        .map(([key, d]) => ({ key, ...d, _score: d.score ?? 0 }));
    const macroQuant = Object.entries(quantAnalysis)
        .filter(([, d]) => isMacroSection(d?.section))
        .map(([key, d]) => ({ key, ...d, _score: d.score ?? 0 }));
    const assetQual = Object.entries(qualAnalysis).filter(([, d]) => !isMacroSection(d?.section));
    const macroQual = Object.entries(qualAnalysis).filter(([, d]) => isMacroSection(d?.section));

    const downloadPdf = async () => {
        if (!analysis) return;
        try {
            setPdfState("busy");
            const res = await axios.get(`${API_BASE}/analysis/${encodeURIComponent(id)}/pdf`, { responseType: "blob" });
            if (!res.data || !(res.data instanceof Blob)) throw new Error("No PDF received");
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(analysis.share_name || analysis.symbol || "analysis").replace(/\s+/g, "-")}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setPdfState("idle");
        } catch (e: any) {
            setPdfState("error");
            console.error("PDF export failed:", e);
        }
    };

    const totalScore: number | null = analysis.total_score;
    const quantScore: number | null = analysis.quantitative_score;
    const qualScore: number | null = analysis.qualitative_score;
    const coverage: number | null = analysis.coverage ?? null;
    const runCurrency = currencyForSource(analysis.source);
    // U2: low coverage must never show a big headline number AND a suppression
    // message — the hero renders "—" and the caution callout explains why.
    const lowCoverage = insufficientCoverage(coverage);

    const verdictSentence = generateVerdict(totalScore, quantAnalysis, qualAnalysis);

    const quantEntries = Object.entries(quantAnalysis).map(([key, data]: [string, any]) => ({
        key,
        ...data,
        _score: data.score ?? 0,
    }));

    if (sortByScore) {
        const byScore = (a, b) =>
            sortByScore === "asc" ? a._score - b._score : b._score - a._score;
        assetQuant.sort(byScore);
        macroQuant.sort(byScore);
    }

    const metaLine = [
        analysis.model,
        analysis.source,
        analysis.agent_name ? agentName(analysis.agent_name) : null,
        analysis.created_at ? new Date(analysis.created_at).toLocaleDateString() : null,
    ]
        .filter(Boolean)
        .join("  ·  ");

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Container maxW="1120px" mx="auto" px={{ base: 4, md: 6 }} py={6}>
                {/* Sticky identity + utility bar */}                    <Box
                    as={motion.div}
                    initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                    position="sticky"
                    top={0}
                    zIndex={20}
                    bg="var(--surface-canvas)"
                    borderBottom="1px solid var(--hairline)"
                    pb={3}
                    pt={2}
                    mb={5}
                    data-print-hide
                >
                    <Flex justify="space-between" align="center" gap={3} wrap="wrap" minH="44px">
                        <HStack gap={3} align="center" minW={0}>
                            <Link
                                to="/analysis-list"
                                aria-label="Back to analyses"
                                fontSize="sm"
                                color="var(--ink-secondary)"
                                _hover={{ color: "var(--ink-primary)" }}
                                display="inline-flex"
                                alignItems="center"
                                gap={1}
                                flexShrink={0}
                                px={1}
                                py={1}
                            >
                                <MdArrowBack aria-hidden="true" />
                                <Text as="span" display={{ base: "none", sm: "inline" }} fontSize="13px">
                                    Analyses
                                </Text>
                            </Link>
                            <Text
                                fontSize="17px"
                                fontWeight={600}
                                color="var(--ink-primary)"
                                lineHeight="short"
                                truncate
                            >
                                {analysis.share_name || analysis.symbol}
                            </Text>
                            <Text
                                fontSize="13px"
                                fontFamily="var(--font-mono)"
                                color="var(--ink-tertiary)"
                                fontWeight={400}
                                display={{ base: "none", md: "inline" }}
                            >
                                {analysis.symbol}
                            </Text>
                        </HStack>
                        <HStack gap={3} align="center">
                            <HStack
                                gap={1.5}
                                align="center"
                                px={2.5}
                                py={1}
                                borderRadius="full"
                                border="1px solid var(--hairline)"
                                bg="var(--surface-panel)"
                                aria-live="polite"
                            >
                                <motion.span
                                    animate={
                                        isRunning
                                            ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }
                                            : {}
                                    }
                                    transition={{ repeat: Infinity, duration: 1.4 }}
                                    style={{
                                        width: 7,
                                        height: 7,
                                        borderRadius: "50%",
                                        background: isError
                                            ? "var(--signal-negative)"
                                            : isComplete
                                            ? "var(--signal-positive)"
                                            : "var(--signal-caution)",
                                        display: "inline-block",
                                    }}
                                />
                                <Text fontSize="12px" color="var(--ink-secondary)">
                                    {isError ? "Failed" : isComplete ? "Complete" : "Running"}
                                </Text>
                            </HStack>
                            {isComplete && (
                                <Button
                                    as={motion.button}
                                    whileTap={{ scale: 0.96 }}
                                    variant="subtle"
                                    size="sm"
                                    color="var(--ink-secondary)"
                                    _hover={{ color: "var(--ink-primary)" }}
                                    onClick={downloadPdf}
                                    disabled={pdfState === "busy"}
                                    aria-label="Download as PDF"
                                >
                                    <MdDownload style={{ marginRight: 4 }} aria-hidden="true" />{" "}
                                    <Text as="span" display={{ base: "none", md: "inline" }}>
                                        {pdfState === "busy" ? "Generating PDF…" : pdfState === "error" ? "Export failed — retry" : "Download as PDF"}
                                    </Text>
                                </Button>
                            )}
                        </HStack>
                    </Flex>
                </Box>

                {/* Meta line + token line: non-sticky sub-header, visible at all widths */}
                <Box mb={5}>
                    {metaLine && (
                        <Text
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            mb={tokenUse && isComplete ? 1 : 0}
                            overflowWrap={{ base: "anywhere", md: "normal" }}
                        >
                            {metaLine}
                        </Text>
                    )}
                    {tokenUse && isComplete && (
                        <Text
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                        >
                            Tokens · {formatTokens(tokenUse.total)} net
                            <Text as="span" color="var(--ink-tertiary)" opacity={0.75}>
                                {`  (${formatTokens(tokenUse.input)} in / ${formatTokens(tokenUse.output)} out)`}
                            </Text>
                        </Text>
                    )}
                </Box>

                {analysis.price_data === "unavailable" && (
                    <Box mb={6}>
                        <Callout tone="caution" title="Live price data unavailable">
                            No live price feed for this instrument — valuation and technical criteria are shown as N/A.
                        </Callout>
                    </Box>
                )}

                {analysis.error && (
                    <Box mb={6}>
                        <Callout tone="negative" title="Analysis Error">
                            <Text
                                as="span"
                                fontFamily="var(--font-mono)"
                                whiteSpace="pre-wrap"
                                wordBreak="break-word"
                                fontSize="12.5px"
                            >
                                {analysis.error}
                            </Text>
                        </Callout>
                    </Box>
                )}

                {/* U6: section nav — highlights the section currently in view
                    via the existing IntersectionObserver scroll-spy. */}
                {isComplete && (
                    <SectionNav
                        active={activeSection}
                        onJump={(key) => {
                            const el = sectionRefs.current[key];
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                    />
                )}

                {/* Verdict band — the 3-second read */}
                {isComplete && (
                    <Box mb={6} as={motion.div} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                        <Grid
                            templateColumns={{ base: "1fr", md: "auto 1fr 1fr" }}
                            columnGap={{ base: 6, md: 10 }}
                            rowGap={4}
                            alignItems="start"
                            mb={4}
                        >
                            {/* Hero score */}
                            <Box>
                                <Flex align="center" gap={2} mb={1} minHeight="26px">
                                    <AgentAvatar agent={resolveAgent(analysis.agent_name, agents)} size={26} />
                                    <Text
                                        fontSize="12px"
                                        fontWeight={500}
                                        color="var(--ink-secondary)"
                                        noOfLines={1}
                                    >
                                        {analysis.report
                                            ? analysis.report.heroLabel
                                            : `Alignment with ${agentName(analysis.agent_name) || "Agent"}`}
                                    </Text>
                                </Flex>
                                {totalScore != null && !lowCoverage ? (
                                    <HStack gap={2} align="baseline">
                                        <Text
                                            fontSize="52px"
                                            fontWeight={600}
                                            lineHeight="1"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            letterSpacing="-0.02em"
                                            color="var(--ink-primary)"
                                        >
                                            <CountUp value={analysis.report ? analysis.report.heroPct : totalScore} decimals={1} />
                                        </Text>
                                        <Text fontSize="15px" color="var(--ink-tertiary)" fontWeight={500}>
                                            / 100
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="52px" fontWeight={600} lineHeight="1" fontFamily="var(--font-tabular)" color="var(--ink-tertiary)">
                                        —
                                    </Text>
                                )}
                                <Text fontSize="12px" color="var(--ink-tertiary)" mt={1} noOfLines={1}>
                                    How well this matches {agentName(analysis.agent_name) || "the agent"}'s criteria
                                </Text>
                            </Box>

                            {/* Quant bar */}
                            <Box minW="120px">
                                <Text
                                    fontSize="12px"
                                    fontWeight={500}
                                    color="var(--ink-secondary)"
                                    mb={1}
                                    minHeight="26px"
                                >
                                    Quantitative
                                </Text>
                                {quantScore != null ? (
                                    <HStack gap={3} mt={2}>
                                        <Box flex={1} h="6px" bg="var(--surface-recessed)" borderRadius="3px" overflow="hidden">
                                            <Box
                                                as={motion.div}
                                                h="100%"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${quantScore}%` }}
                                                transition={{ duration: 0.7, ease, delay: 0.15 }}
                                                bg={signalColor(scoreSignal(quantScore))}
                                                borderRadius="3px"
                                            />
                                        </Box>
                                        <Text
                                            fontSize="15px"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-primary)"
                                            minW="56px"
                                            textAlign="right"
                                        >
                                            <CountUp value={quantScore} decimals={1} />
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="14px" color="var(--ink-tertiary)" mt={2}>Not scored</Text>
                                )}
                            </Box>

                            {/* Qual bar */}
                            <Box minW="120px">
                                <Text
                                    fontSize="12px"
                                    fontWeight={500}
                                    color="var(--ink-secondary)"
                                    mb={1}
                                    minHeight="26px"
                                >
                                    Qualitative
                                </Text>
                                {qualScore != null ? (
                                    <HStack gap={3} mt={2}>
                                        <Box flex={1} h="6px" bg="var(--surface-recessed)" borderRadius="3px" overflow="hidden">
                                            <Box
                                                as={motion.div}
                                                h="100%"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${qualScore}%` }}
                                                transition={{ duration: 0.7, ease, delay: 0.25 }}
                                                bg={signalColor(scoreSignal(qualScore))}
                                                borderRadius="3px"
                                            />
                                        </Box>
                                        <Text
                                            fontSize="15px"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-primary)"
                                            minW="56px"
                                            textAlign="right"
                                        >
                                            <CountUp value={qualScore} decimals={1} />
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="14px" color="var(--ink-tertiary)" mt={2}>Not scored</Text>
                                )}
                            </Box>
                        </Grid>

                        {/* Verdict sentence — only shown in fallback (no LLM report) */}
                        {!analysis.report && (
                        <Text
                            fontSize="14px"
                            color="var(--ink-secondary)"
                            mt={3}
                            lineHeight="relaxed"
                            maxW="70ch"
                        >
                            {verdictSentence}
                        </Text>
                        )}

                        {/* Band pill + coverage chip next to the score (U1/U2): how much of
                            the rubric the number actually rests on. Low coverage shows the
                            caution inline — never a big number AND a suppression message. */}
                        <HStack gap={2} mt={4} flexWrap="wrap">
                            {totalScore != null && !lowCoverage && (
                                <Box
                                    px={3}
                                    py={1}
                                    borderRadius="full"
                                    border="1px solid var(--hairline)"
                                    bg="var(--surface-panel)"
                                >
                                    <Text fontSize="12px" fontWeight={500} color={bandForScore(totalScore).color}>
                                        {bandForScore(totalScore).label}
                                    </Text>
                                </Box>
                            )}
                            {coverage != null && (
                                <Box
                                    px={3}
                                    py={1}
                                    borderRadius="full"
                                    border="1px solid var(--hairline)"
                                    bg="var(--surface-panel)"
                                >
                                    <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                        {coverageLabel(coverage)} of rubric scored
                                    </Text>
                                </Box>
                            )}
                        </HStack>
                        {lowCoverage && (
                            <Box mt={3} maxW="70ch">
                                <Callout tone="caution" title="Not enough of the rubric could be scored to give a reliable headline score.">
                                    Only {coverageLabel(coverage)} of the criteria had usable data. Review the breakdowns below — unscored criteria are excluded, not failed.
                                </Callout>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Running status line */}
                {isRunning && (
                    <Box key="running" mb={4}>
                        <Flex justify="space-between" align="center">
                            <HStack gap={3} color="var(--ink-secondary)">
                                <Spinner size="sm" borderWidth="2px" />
                                <Text fontSize="13px">Analysis in progress — this page updates automatically.</Text>
                            </HStack>
                            {elapsed > 0 && (
                                <Text
                                    fontSize="12px"
                                    color="var(--ink-tertiary)"
                                    fontFamily="var(--font-tabular)"
                                    fontVariantNumeric="tabular-nums"
                                    whiteSpace="nowrap"
                                >
                                    {formatSeconds(elapsed)}
                                </Text>
                            )}
                        </Flex>
                    </Box>
                )}

                {/* Report tabs (live reasoning tab while running) */}
                <Box key="report" id="tab-panels" css={{ scrollMarginTop: "64px" }}>
                    <Tabs.Root
                        value={activeTab}
                        onValueChange={handleTabChange}
                        variant="line"
                        size="sm"
                    >
                        <Tabs.List
                            gap={0}
                            borderBottom="1px solid var(--hairline)"
                            mb={6}
                            overflowX="auto"
                            flexWrap="nowrap"
                            css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
                            data-print-hide
                        >
                            {TABS.map((tab) => {
                                const disabled = tab === "report" && !reportAvailable;
                                return (
                                <Tabs.Trigger
                                    key={tab}
                                    value={tab}
                                    fontSize="13px"
                                    fontWeight={activeTab === tab ? 600 : 400}
                                    color={activeTab === tab ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                                    textTransform="capitalize"
                                    px={{ base: 3, md: 4 }}
                                    py={2.5}
                                    minH={{ base: "44px", md: "auto" }}
                                    flexShrink={0}
                                    whiteSpace="nowrap"
                                    position="relative"
                                    _hover={{ color: disabled ? "var(--ink-tertiary)" : "var(--ink-primary)" }}
                                    _selected={{
                                        color: "var(--ink-primary)",
                                        fontWeight: 600,
                                    }}
                                    transition="none"
                                    disabled={disabled}
                                    opacity={disabled ? 0.55 : 1}
                                    cursor={disabled ? "not-allowed" : "pointer"}
                                >
                                    {tab}
                                    {disabled && (
                                        <Text as="span" fontSize="11px" color="var(--ink-tertiary)" ml={1.5} display={{ base: "none", md: "inline" }}>
                                            · available when complete
                                        </Text>
                                    )}
                                    {activeTab === tab && (
                                        <Box as={motion.div} layoutId="tab-underline" position="absolute" bottom={0} left={0} right={0} h="2px" bg="var(--accent-primary)" />
                                    )}
                                </Tabs.Trigger>
                                );
                            })}
                        </Tabs.List>

                        {/* ── Report ── */}
                        <Tabs.Content value="report">
                            <Box ref={(el) => registerSection("report", el)} data-section="report" css={{ scrollMarginTop: "72px" }}>
                                {isComplete ? (
                                    <Box>
                                        {/* Decision-first order (E1): synthesis and verdict
                                            first, evidence-dense breakdowns after. */}
                                        {analysis.report ? (
                                            <Box mb={8}>
                                                <SectionHeader label="Executive Report & Synthesis" count={analysis.report.blocks.length} />
                                                {analysis.report.partial && (
                                                    <Box mb={4}>
                                                        <Callout tone="caution" title="Partial Result">
                                                            Some qualitative parameters failed to score. The synthesis is based on partial data.
                                                        </Callout>
                                                    </Box>
                                                )}
                                                {analysis.report.source === "fallback" && (
                                                    <Box mb={4}>
                                                        <Callout tone="caution">
                                                            AI narrative was unavailable for this run; this synthesis was assembled deterministically from the scored breakdowns below.
                                                        </Callout>
                                                    </Box>
                                                )}
                                                <ReportBlockRenderer blocks={analysis.report.blocks} lookup={evidenceLookup} />
                                            </Box>
                                        ) : (
                                            <Box mb={6}>
                                                <Callout tone="caution">
                                                    No executive synthesis for this run — review the parameter breakdowns below.
                                                </Callout>
                                            </Box>
                                        )}

                                        {/* Breakdowns after the decision (E1) */}
                                        <Box mb={10} data-section="quantitative" ref={(el: any) => registerSection("quantitative", el)} css={{ scrollMarginTop: "72px" }}>
                                            <SectionHeader label="Quantitative Breakdown" count={quantEntries.length} />
                                            <Box mb={8}>
                                                <SourceLegend exchangeSource={exchangeSource} />
                                                <SubHeader label="Asset" count={assetQuant.length} />
                                                <QuantTable
                                                    entries={assetQuant}
                                                    sortByScore={sortByScore}
                                                    setSortByScore={setSortByScore}
                                                    formatValue={(val, type) => formatValue(val, type, runCurrency)}
                                                />
                                                {macroQuant.length > 0 && (
                                                    <Box mt={6}>
                                                        <SubHeader label="Macro" count={macroQuant.length} />
                                                        <QuantTable
                                                            entries={macroQuant}
                                                            sortByScore={sortByScore}
                                                            setSortByScore={setSortByScore}
                                                            formatValue={(val, type) => formatValue(val, type, runCurrency)}
                                                        />
                                                    </Box>
                                                )}
                                            </Box>
                                        </Box>

                                            {/* U5: one expandable list per qualitative parameter
                                                — score and reasoning live in the same place. */}
                                            <Box mb={10} data-section="qualitative" ref={(el: any) => registerSection("qualitative", el)} css={{ scrollMarginTop: "72px" }}>
                                                <SectionHeader label="Qualitative Breakdown" count={Object.keys(qualAnalysis).length} />
                                                <Box mb={8}>
                                                    <SubHeader label="Asset" count={assetQual.length} />
                                                    <QualExpandableTable
                                                        entries={assetQual}
                                                        toolCalls={toolCalls}
                                                        exchangeSource={exchangeSource}
                                                        onSwitchToReasoning={() => handleTabChange({ value: "reasoning" })}
                                                    />
                                                    {macroQual.length > 0 && (
                                                        <Box mt={6}>
                                                            <SubHeader label="Macro" count={macroQual.length} />
                                                            <QualExpandableTable
                                                                entries={macroQual}
                                                                toolCalls={toolCalls}
                                                                exchangeSource={exchangeSource}
                                                                onSwitchToReasoning={() => handleTabChange({ value: "reasoning" })}
                                                            />
                                                        </Box>
                                                    )}
                                                </Box>
                                            </Box>

                                            {/* U7: sources you can actually open */}
                                            {(docs.length > 0 || webSrc.length > 0) && (
                                                <Box data-section="sources" ref={(el: any) => registerSection("sources", el)} css={{ scrollMarginTop: "72px" }}>
                                                    <SectionHeader label="Sources" count={docs.length + webSrc.length} />
                                                    <SourcesPanel docs={docs} webSrc={webSrc} analysis={analysis} agentName={agentName(analysis.agent_name)} />
                                                </Box>
                                            )}
                                        </Box>
                                ) : (
                                    <EmptyState message="Waiting for the analysis to complete — the report appears here when it's done." />
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Reasoning (full agent trace, live while running) ── */}
                        <Tabs.Content value="reasoning">
                            <Box>
                                <SectionHeader label="Agent Reasoning" count={traceCount} />
                                {isRunning ? (
                                    <AgentActivity
                                        title={`Analyzing ${analysis.share_name || analysis.symbol || "…"} with ${agentName(analysis.agent_name)}`}
                                        subtitle={`${analysis.model || "default model"} · gathering data, searching, scoring`}
                                        agent={resolveAgent(analysis.agent_name, agents)}
                                        streamUrl={`/analysis/${id}/stream`}
                                        steps={analysis.steps || []}
                                        startedAt={analysis.created_at ? +new Date(analysis.created_at) : undefined}
                                        active
                                        maxHeight={480}
                                    />
                                ) : (
                                    <AgentActivity
                                        title={`Reasoning history — ${analysis.share_name || analysis.symbol || "…"} with ${agentName(analysis.agent_name)}`}
                                        subtitle={`${analysis.model || "default model"} · full tool and thought trace`}
                                        agent={resolveAgent(analysis.agent_name, agents)}
                                        events={analysis.trace || []}
                                        steps={analysis.steps || []}
                                        active={false}
                                        maxHeight={480}
                                    />
                                )}
                            </Box>
                        </Tabs.Content>

                    </Tabs.Root>
                    </Box>
            </Container>
        </Box>
    );
}

/* ─── Sub-components ─── */

/** 5d: one shared callout for caution/negative/info — replaces 5 copy-pasted blocks. */
function Callout({
    tone,
    title,
    children,
}: {
    tone: "caution" | "negative" | "info";
    title?: string;
    children: React.ReactNode;
}) {
    const color =
        tone === "negative"
            ? "var(--signal-negative)"
            : tone === "caution"
              ? "var(--signal-caution)"
              : "var(--accent-primary)";
    return (
        <Box
            borderLeft={`3px solid ${color}`}
            bg="var(--surface-panel)"
            border="1px solid var(--hairline)"
            borderLeftWidth="3px"
            borderRadius="6px"
            pl={4}
            pr={4}
            py={3}
        >
            {title && (
                <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)" mb={1}>
                    {title}
                </Text>
            )}
            <Text fontSize="13px" color="var(--ink-secondary)">
                {children}
            </Text>
        </Box>
    );
}

const SECTION_NAV_ITEMS: { key: string; label: string }[] = [
    { key: "report", label: "Summary" },
    { key: "quantitative", label: "Quantitative" },
    { key: "qualitative", label: "Qualitative" },
    { key: "sources", label: "Sources" },
];

function SectionNav({ active, onJump }: { active: string; onJump: (key: string) => void }) {
    return (
        <Flex
            gap={1}
            mb={4}
            wrap="wrap"
            role="navigation"
            aria-label="Report sections"
            data-print-hide
        >
            {SECTION_NAV_ITEMS.map((item) => {
                const isActive = active === item.key;
                return (
                    <Box
                        key={item.key}
                        as="button"
                        onClick={() => onJump(item.key)}
                        px={3}
                        py={1}
                        borderRadius="full"
                        fontSize="12px"
                        fontWeight={isActive ? 600 : 400}
                        color={isActive ? "var(--ink-primary)" : "var(--ink-secondary)"}
                        bg={isActive ? "var(--surface-recessed)" : "transparent"}
                        border="1px solid"
                        borderColor={isActive ? "var(--hairline)" : "transparent"}
                        cursor="pointer"
                        _hover={{ color: "var(--ink-primary)" }}
                        aria-current={isActive ? "true" : undefined}
                    >
                        {item.label}
                    </Box>
                );
            })}
        </Flex>
    );
}

// 5f: no per-header fade/slide — the only entrance animation is the hero's,
// and it's disabled under prefers-reduced-motion.
function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
        <Flex align="center" gap={2} mb={4}>
            <Text
                fontSize="13px"
                fontWeight={600}
                color="var(--ink-primary)"
                letterSpacing="0.04em"
            >
                {label}
            </Text>
            {count > 0 && (
                <Box
                    as="span"
                    fontSize="12px"
                    fontFamily="var(--font-mono)"
                    color="var(--ink-tertiary)"
                    px={2}
                    py={0.5}
                    borderRadius="full"
                    bg="var(--surface-recessed)"
                >
                    {count}
                </Box>
            )}
            <Box flex={1} h="1px" bg="var(--hairline)" ml={2} />
        </Flex>
    );
}

function SubHeader({ label, count }: { label: string; count: number }) {
    return (
        <Flex align="center" gap={2} mb={2}>
            <Text
                fontSize="13px"
                fontWeight={600}
                color="var(--ink-secondary)"
            >
                {label}
            </Text>
            {count > 0 && (
                <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                    {count}
                </Text>
            )}
        </Flex>
    );
}

function SourceLegend({ exchangeSource }: { exchangeSource: SourceKey }) {
    // D5: never name the upstream data engine to investors; name the evidence
    // class instead (exchange filings, transcripts, announcements).
    return (
        <Flex align="center" gap={1.5} mb={3} flexWrap="wrap">
            <SourceMark source={exchangeSource} size={13} />
            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                Scored from exchange filings and company disclosures
            </Text>
        </Flex>
    );
}

// ─── Shared table primitives (Phase 3a) ───────────────────────────────────

const thProps = {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--ink-tertiary)",
    py: 3,
    px: 4,
} as const;

const cellProps = {
    fontSize: "14px",
    px: 4,
    py: 3,
} as const;

/** U9: explicit pass/fail text next to the score — never color-only. */
function scoreWord(sig: "positive" | "caution" | "negative"): string {
    if (sig === "positive") return "meets";
    if (sig === "caution") return "partial";
    return "misses";
}

/**
 * ScoreCell: tabular number + a text marker so pass/fail isn't color-only.
 * `na` renders an explicit N/A with its reason in the title.
 */
function ScoreCell({ score, na, naReason }: { score: number | null; na?: boolean; naReason?: string }) {
    if (na || score == null) {
        return (
            <Text fontSize="14px" color="var(--ink-tertiary)" title={naReason}>
                N/A{naReason ? " — price unavailable" : ""}
            </Text>
        );
    }
    const sig = scoreSignal(score);
    return (
        <VStack gap={0} align="end">
            <Text
                fontFamily="var(--font-tabular)"
                fontVariantNumeric="tabular-nums"
                fontWeight={500}
                color={signalColor(sig)}
            >
                {score.toFixed(1)}
            </Text>
            <Text fontSize="11.5px" color="var(--ink-tertiary)">
                {scoreWord(sig)}
            </Text>
        </VStack>
    );
}

function QuantTable({
    entries,
    sortByScore,
    setSortByScore,
    formatValue: fmt,
}: {
    entries: any[];
    sortByScore: "asc" | "desc" | null;
    setSortByScore: (v: "asc" | "desc" | null) => void;
    formatValue: (val: any, type?: string) => string;
}) {
    const toggleSort = () => {
        if (sortByScore === null) setSortByScore("asc");
        else if (sortByScore === "asc") setSortByScore("desc");
        else setSortByScore(null);
    };

    const ariaSort = sortByScore === "asc" ? "ascending" : sortByScore === "desc" ? "descending" : "none";

    return (
        <Box border="1px solid var(--hairline)" borderRadius="6px" overflow="hidden">
            {/* Desktop table (>= md) */}
            <Box overflowX="auto" display={{ base: "none", md: "block" }}>
                <Table.Root size="sm" variant="line" minWidth="660px">
                    <Table.Header>
                        <Table.Row bg="var(--surface-recessed)">
                            <Table.ColumnHeader {...thProps}>Metric</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps}>Target</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps} textAlign="right">Actual</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps} textAlign="right">Weight</Table.ColumnHeader>
                            <Table.ColumnHeader
                                {...thProps}
                                textAlign="right"
                                aria-sort={ariaSort as any}
                            >
                                <Flex justify="flex-end">
                                    <Box
                                        as="button"
                                        onClick={toggleSort}
                                        aria-label={`Sort by score ${ariaSort}`}
                                        fontSize="12px"
                                        fontWeight={500}
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--ink-primary)" }}
                                        cursor="pointer"
                                        bg="transparent"
                                        border="none"
                                        p={0}
                                    >
                                        Score <Box as="span" display="inline-block" w="14px" textAlign="left" aria-hidden="true">
                                            {sortByScore === "asc" ? "↑" : sortByScore === "desc" ? "↓" : "↕"}
                                        </Box>
                                    </Box>
                                </Flex>
                            </Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {entries.map((m) => {
                            const isNA = !!m.price_unavailable;
                            const metricScore = isNA ? null : (m.score ?? 0);
                            const sig = metricScore == null ? null : scoreSignal(metricScore);
                            const indicator = sig ? signalColor(sig) : "var(--hairline)";
                            return (
                                <Table.Row
                                    key={m.key}
                                    css={{
                                        // A3: inset indicator instead of borderLeft so the
                                        // header text aligns exactly with cell text.
                                        "& > td:first-of-type": {
                                            boxShadow: `inset 3px 0 0 ${indicator}`,
                                        },
                                    }}
                                    _hover={{ bg: "var(--surface-recessed)" }}
                                    transition="background 160ms"
                                >
                                    <Table.Cell
                                        fontWeight={500}
                                        color="var(--ink-primary)"
                                        title={m.key}
                                        {...cellProps}
                                    >
                                        {m.metric_name || m.key}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-secondary)"
                                        {...cellProps}
                                    >
                                        {OP_SYMBOL[m.operator] || m.operator} {fmt(m.threshold, m.metric_type)}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontFamily="var(--font-mono)"
                                        fontVariantNumeric="tabular-nums"
                                        fontWeight={500}
                                        color={isNA ? "var(--ink-tertiary)" : "var(--ink-primary)"}
                                        textAlign="right"
                                        {...cellProps}
                                    >
                                        {isNA ? "N/A" : fmt(m.value, m.metric_type)}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontFamily="var(--font-mono)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-secondary)"
                                        textAlign="right"
                                        {...cellProps}
                                    >
                                        {m.weightage != null ? m.weightage : "—"}
                                    </Table.Cell>
                                    <Table.Cell textAlign="right" {...cellProps}>
                                        <ScoreCell
                                            score={metricScore}
                                            na={isNA}
                                            naReason="Live price unavailable for this criterion"
                                        />
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })}
                    </Table.Body>
                </Table.Root>
            </Box>
            {/* U12: mobile cards instead of a hidden-columns table */}
            <VStack gap={0} align="stretch" display={{ base: "block", md: "none" }}>
                {entries.map((m) => {
                    const isNA = !!m.price_unavailable;
                    const metricScore = isNA ? null : (m.score ?? 0);
                    const sig = metricScore == null ? null : scoreSignal(metricScore);
                    return (
                        <Box
                            key={m.key}
                            px={4}
                            py={3}
                            borderBottom="1px solid var(--hairline)"
                            css={{
                                boxShadow: `inset 3px 0 0 ${sig ? signalColor(sig) : "var(--hairline)"}`,
                            }}
                        >
                            <Flex justify="space-between" align="baseline" gap={3}>
                                <Text fontSize="14px" fontWeight={500} color="var(--ink-primary)" noOfLines={1}>
                                    {m.metric_name || m.key}
                                </Text>
                                <ScoreCell score={metricScore} na={isNA} naReason="Live price unavailable" />
                            </Flex>
                            <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" mt={0.5}>
                                {OP_SYMBOL[m.operator] || m.operator} {fmt(m.threshold, m.metric_type)}
                                {m.value != null && !isNA ? ` · actual ${fmt(m.value, m.metric_type)}` : ""}
                            </Text>
                        </Box>
                    );
                })}
            </VStack>
        </Box>
    );
}

function QualTable({
    entries,
    toolCalls,
    exchangeSource,
}: {
    entries: [string, any][];
    toolCalls: Record<string, any[]>;
    exchangeSource: SourceKey;
}) {
    return (
        <Box border="1px solid var(--hairline)" borderRadius="6px" overflow="hidden">
            {/* Desktop table (>= md) */}
            <Box overflowX="auto" display={{ base: "none", md: "block" }}>
                <Table.Root size="sm" variant="line" minWidth="660px">
                    <Table.Header>
                        <Table.Row bg="var(--surface-recessed)">
                            <Table.ColumnHeader {...thProps}>Parameter</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps}>Data source</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps} textAlign="right">Weight</Table.ColumnHeader>
                            <Table.ColumnHeader {...thProps} textAlign="right">Score</Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {entries.map(([paramName, d]) => {
                            const hasError = !!d?.error;
                            const score = hasError ? null : typeof d?.score === "number" ? d.score : 0;
                            const sig = score == null ? null : scoreSignal(score);
                            const usedSources: SourceKey[] = sourcesUsedForParam(toolCalls[paramName])
                                .map((k) => (k === "exchange" ? exchangeSource : k));
                            return (
                                <Table.Row
                                    key={paramName}
                                    css={{
                                        "& > td:first-of-type": {
                                            boxShadow: `inset 3px 0 0 ${sig ? signalColor(sig) : "var(--signal-negative)"}`,
                                        },
                                    }}
                                    _hover={{ bg: "var(--surface-recessed)" }}
                                    transition="background 160ms"
                                >
                                    <Table.Cell fontWeight={500} color="var(--ink-primary)" {...cellProps}>
                                        <Flex align="center" gap={2}>
                                            <Text fontWeight={500} color="var(--ink-primary)">{paramName}</Text>
                                            {hasError && (
                                                <Text
                                                    as="span"
                                                    fontSize="12px"
                                                    px={1.5}
                                                    borderRadius="full"
                                                    bg="color-mix(in srgb, var(--signal-negative) 10%, transparent)"
                                                    color="var(--signal-negative)"
                                                    title={String(d.error)}
                                                >
                                                    scoring failed
                                                </Text>
                                            )}
                                        </Flex>
                                    </Table.Cell>
                                    <Table.Cell px={4} py={3}>
                                        {usedSources.length > 0 && (
                                            <Flex align="center" gap={1}>
                                                {usedSources.map((k) => (
                                                    <Flex
                                                        key={k}
                                                        align="center"
                                                        gap={1}
                                                        title={`${SOURCE_DEFS[k].label} — ${SOURCE_DEFS[k].full}`}
                                                    >
                                                        <SourceMark source={k} size={13} muted={k === "voyager"} />
                                                        <Text fontSize="11.5px" color="var(--ink-tertiary)">
                                                            {SOURCE_DEFS[k].label}
                                                        </Text>
                                                    </Flex>
                                                ))}
                                            </Flex>
                                        )}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-secondary)"
                                        textAlign="right"
                                        {...cellProps}
                                    >
                                        {d?.weightage != null ? d.weightage : "—"}
                                    </Table.Cell>
                                    <Table.Cell textAlign="right" {...cellProps}>
                                        {hasError ? (
                                            <Text fontSize="14px" color="var(--signal-negative)">—</Text>
                                        ) : (
                                            <ScoreCell score={score} />
                                        )}
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })}
                    </Table.Body>
                </Table.Root>
            </Box>
            {/* U12: mobile cards */}
            <VStack gap={0} align="stretch" display={{ base: "block", md: "none" }}>
                {entries.map(([paramName, d]) => {
                    const hasError = !!d?.error;
                    const score = hasError ? null : typeof d?.score === "number" ? d.score : 0;
                    const sig = score == null ? null : scoreSignal(score);
                    return (
                        <Box
                            key={paramName}
                            px={4}
                            py={3}
                            borderBottom="1px solid var(--hairline)"
                            css={{
                                boxShadow: `inset 3px 0 0 ${sig ? signalColor(sig) : "var(--signal-negative)"}`,
                            }}
                        >
                            <Flex justify="space-between" align="baseline" gap={3}>
                                <Text fontSize="14px" fontWeight={500} color="var(--ink-primary)" noOfLines={1}>
                                    {paramName}
                                </Text>
                                {hasError ? (
                                    <Text fontSize="14px" color="var(--signal-negative)">failed</Text>
                                ) : (
                                    <ScoreCell score={score} />
                                )}
                            </Flex>
                            {usedSourcesPreview(toolCalls[paramName], exchangeSource)}
                        </Box>
                    );
                })}
            </VStack>
        </Box>
    );
}

function usedSourcesPreview(calls: any[] | undefined, exchangeSource: SourceKey) {
    const used = sourcesUsedForParam(calls).map((k) => (k === "exchange" ? exchangeSource : k));
    if (!used.length) return null;
    return (
        <Flex align="center" gap={1} mt={1} flexWrap="wrap">
            {used.map((k) => (
                <Flex key={k} align="center" gap={1} title={`${SOURCE_DEFS[k].label} — ${SOURCE_DEFS[k].full}`}>
                    <SourceMark source={k} size={12} muted={k === "voyager"} />
                    <Text fontSize="11.5px" color="var(--ink-tertiary)">
                        {SOURCE_DEFS[k].label}
                    </Text>
                </Flex>
            ))}
        </Flex>
    );
}

// ─── Expandable qualitative rows (Phase 4a: parameter appears once) ───────

const markdownStyles = {
    "& h1, & h2, & h3, & h4": {
        fontWeight: 600,
        mt: 3,
        mb: 1,
        color: "var(--ink-primary)",
    },
    "& h1": { fontSize: "15px" },
    "& h2": { fontSize: "14px" },
    "& h3": { fontSize: "13.5px" },
    "& p": { mb: 2, "&:last-child": { mb: 0 } },
    "& ul, & ol": { pl: 5, mb: 2 },
    "& li": { mb: 0.5 },
    "& strong": { fontWeight: 600, color: "var(--ink-primary)" },
    "& code": {
        bg: "var(--surface-recessed)",
        px: 1,
        py: 0.5,
        borderRadius: "2px",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
    },
    "& pre": {
        bg: "var(--surface-recessed)",
        p: 3,
        borderRadius: "2px",
        overflow: "auto",
        mb: 2,
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
    },
    "& blockquote": {
        borderLeft: "2px solid var(--hairline)",
        pl: 3,
        mb: 2,
        color: "var(--ink-tertiary)",
        fontStyle: "italic",
    },
    "& table": { borderCollapse: "collapse", mb: 2, width: "100%" },
    "& th, & td": {
        border: "1px solid var(--hairline)",
        px: 2,
        py: 1,
        textAlign: "left",
        fontSize: "12px",
    },
    "& th": { fontWeight: 600, bg: "var(--surface-recessed)" },
    "& hr": { my: 3, borderColor: "var(--hairline)" },
    "& a": { color: "var(--accent-primary)", textDecoration: "underline" },
} as const;

function QualExpandableTable({
    entries,
    toolCalls,
    exchangeSource,
    onSwitchToReasoning,
}: {
    entries: [string, any][];
    toolCalls: Record<string, any[]>;
    exchangeSource: SourceKey;
    onSwitchToReasoning: () => void;
}) {
    const [expandedAll, setExpandedAll] = useState(false);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const anyExpanded = Object.values(expanded).some(Boolean);

    const setAll = (open: boolean) => {
        setExpandedAll(open);
        const next: Record<string, boolean> = {};
        for (const [k] of entries) next[k] = open;
        setExpanded(next);
    };

    const toggle = (param: string) => {
        setExpanded((prev) => ({ ...prev, [param]: !prev[param] }));
    };

    return (
        <Box border="1px solid var(--hairline)" borderRadius="6px" overflow="hidden">
            <Flex justify="flex-end" px={4} py={2} borderBottom="1px solid var(--hairline)" bg="var(--surface-recessed)">
                <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setAll(!anyExpanded)}
                    color="var(--ink-secondary)"
                    fontSize="12px"
                    aria-expanded={anyExpanded}
                >
                    {anyExpanded ? "Collapse all" : "Expand all"}
                </Button>
            </Flex>
            {entries.map(([paramName, d]) => {
                const hasError = !!d?.error;
                const score = hasError ? null : typeof d?.score === "number" ? d.score : 0;
                const sig = score == null ? null : scoreSignal(score);
                const isOpen = !!expanded[paramName];
                const usedSources: SourceKey[] = sourcesUsedForParam(toolCalls[paramName])
                    .map((k) => (k === "exchange" ? exchangeSource : k));
                return (
                    <Box
                        key={paramName}
                        borderBottom="1px solid var(--hairline)"
                        _last={{ borderBottom: "none" }}
                        css={{
                            boxShadow: `inset 3px 0 0 ${sig ? signalColor(sig) : "var(--signal-negative)"}`,
                        }}
                    >
                        <Box
                            as="button"
                            w="100%"
                            textAlign="left"
                            onClick={() => toggle(paramName)}
                            aria-expanded={isOpen}
                            cursor="pointer"
                            bg="transparent"
                            border="none"
                            p={0}
                            _hover={{ bg: "var(--surface-recessed)" }}
                            transition="background 160ms"
                        >
                            <Flex justify="space-between" align="center" gap={4} px={4} py={3}>
                                <HStack gap={2} minW={0}>
                                    <Box as="span" aria-hidden="true" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 160ms", display: "inline-flex" }}>
                                        <MdExpandMore size={16} />
                                    </Box>
                                    <Text fontSize="14px" fontWeight={500} color="var(--ink-primary)" noOfLines={1}>
                                        {paramName}
                                    </Text>
                                    {hasError && (
                                        <Text
                                            as="span"
                                            fontSize="12px"
                                            px={1.5}
                                            borderRadius="full"
                                            bg="color-mix(in srgb, var(--signal-negative) 10%, transparent)"
                                            color="var(--signal-negative)"
                                        >
                                            scoring failed
                                        </Text>
                                    )}
                                    {usedSources.slice(0, 3).map((k) => (
                                        <Flex key={k} align="center" gap={1} title={`${SOURCE_DEFS[k].label} — ${SOURCE_DEFS[k].full}`}>
                                            <SourceMark source={k} size={12} muted={k === "voyager"} />
                                            <Text fontSize="11.5px" color="var(--ink-tertiary)" display={{ base: "none", md: "inline" }}>
                                                {SOURCE_DEFS[k].label}
                                            </Text>
                                        </Flex>
                                    ))}
                                </HStack>
                                <HStack gap={3} align="center" flexShrink={0}>
                                    <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" display={{ base: "none", sm: "inline" }}>
                                        weight {d?.weightage != null ? d.weightage : "—"}
                                    </Text>
                                    {hasError ? (
                                        <Text fontSize="14px" color="var(--signal-negative)">—</Text>
                                    ) : (
                                        <ScoreCell score={score} />
                                    )}
                                </HStack>
                            </Flex>
                        </Box>
                        <AnimatePresence initial={false}>
                            {isOpen && (
                                <Box
                                    as={motion.div}
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: dur.base, ease }}
                                    overflow="hidden"
                                >
                                    <Box px={4} pb={4} pl={7}>
                                        {hasError && (
                                            <Box
                                                borderLeft="2px solid var(--signal-negative)"
                                                bg="color-mix(in srgb, var(--signal-negative) 8%, transparent)"
                                                px={3}
                                                py={2}
                                                mb={3}
                                                borderRadius="2px"
                                                fontSize="13px"
                                                fontFamily="var(--font-mono)"
                                                color="var(--signal-negative)"
                                                wordBreak="break-word"
                                            >
                                                {String(d.error)}
                                            </Box>
                                        )}
                                        <Box
                                            fontSize="14px"
                                            color="var(--ink-secondary)"
                                            lineHeight="relaxed"
                                            css={markdownStyles}
                                        >
                                            <ReactMarkdown>{stripScoreScaffolding(d?.analysis) || "_No analysis available_"}</ReactMarkdown>
                                        </Box>
                                        {/* U10: tool calls live in the Reasoning tab — one
                                            click instead of an inline developer disclosure. */}
                                        {toolCalls[paramName]?.length > 0 && (
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={(e: any) => {
                                                    e.stopPropagation();
                                                    onSwitchToReasoning();
                                                }}
                                                color="var(--accent-primary)"
                                                fontSize="12px"
                                                mt={3}
                                                px={1}
                                            >
                                                View {toolCalls[paramName].length} tool call{toolCalls[paramName].length > 1 ? "s" : ""} in the reasoning trace →
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            )}
                        </AnimatePresence>
                    </Box>
                );
            })}
        </Box>
    );
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url.slice(0, 40);
    }
}

/** U7: expandable sources panel — documents + clickable web links + run details. */
function SourcesPanel({
    docs,
    webSrc,
    analysis,
    agentName,
}: {
    docs: any[];
    webSrc: string[];
    analysis: any;
    agentName: string | null;
}) {
    const [open, setOpen] = useState(false);
    const total = docs.length + webSrc.length;

    const webSearchNote =
        analysis.web_search_effective === "auto"
            ? "Web search was used because company filings alone were limited."
            : analysis.web_search_effective === "user" || analysis.web_search
              ? "Web search was enabled for this run."
              : null;

    return (
        <Box border="1px solid var(--hairline)" borderRadius="6px" overflow="hidden">
            <Box
                as="button"
                w="100%"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                cursor="pointer"
                bg="transparent"
                border="none"
                p={0}
                textAlign="left"
            >
                <Flex justify="space-between" align="center" px={4} py={3} bg="var(--surface-recessed)">
                    <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)">
                        {total} source{total > 1 ? "s" : ""} used
                        {docs.length > 0 ? ` · ${docs.length} document${docs.length > 1 ? "s" : ""}` : ""}
                        {webSrc.length > 0 ? ` · ${webSrc.length} web` : ""}
                    </Text>
                    <Box as="span" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms", display: "inline-flex" }}>
                        <MdExpandMore size={16} />
                    </Box>
                </Flex>
            </Box>
            <AnimatePresence initial={false}>
                {open && (
                    <Box
                        as={motion.div}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: dur.base, ease }}
                        overflow="hidden"
                    >
                        <Box px={4} py={3}>
                            {webSearchNote && (
                                <Text fontSize="13px" color="var(--ink-secondary)" mb={3}>
                                    {webSearchNote}
                                </Text>
                            )}
                            {docs.length > 0 && (
                                <Box mb={4}>
                                    <Text fontSize="12px" fontWeight={500} color="var(--ink-tertiary)" mb={2}>
                                        Documents
                                    </Text>
                                    <VStack gap={1} align="stretch">
                                        {docs.map((doc: any, i: number) => (
                                            <Text key={i} fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" wordBreak="break-word">
                                                {typeof doc === "string" ? doc : doc.name || doc.title || JSON.stringify(doc)}
                                            </Text>
                                        ))}
                                    </VStack>
                                </Box>
                            )}
                            {webSrc.length > 0 && (
                                <Box mb={4}>
                                    <Text fontSize="12px" fontWeight={500} color="var(--ink-tertiary)" mb={2}>
                                        Web sources
                                    </Text>
                                    <VStack gap={1.5} align="stretch">
                                        {webSrc.map((src: string) => (
                                            <Link
                                                key={src}
                                                href={src}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                fontSize="13px"
                                                color="var(--accent-primary)"
                                                _hover={{ textDecoration: "underline" }}
                                                wordBreak="break-all"
                                            >
                                                {hostnameOf(src)} — {src.length > 90 ? `${src.slice(0, 90)}…` : src}
                                            </Link>
                                        ))}
                                    </VStack>
                                </Box>
                            )}
                            <Box>
                                <Text fontSize="12px" fontWeight={500} color="var(--ink-tertiary)" mb={2}>
                                    Run details
                                </Text>
                                <VStack gap={1} align="stretch" fontSize="13px" color="var(--ink-secondary)">
                                    {analysis.model && (
                                        <HStack gap={2}>
                                            <ModelLogo model={analysis.model} size={12} />
                                            <Text fontSize="13px">Model: {analysis.model}</Text>
                                        </HStack>
                                    )}
                                    {analysis.source && <Text>Market: {String(analysis.source).toUpperCase()}</Text>}
                                    {agentName && <Text>Agent: {agentName}</Text>}
                                    {analysis.duration != null && <Text>Duration: {formatDuration(analysis.duration)}</Text>}
                                    {analysis.end_time && <Text>Ended: {new Date(analysis.end_time * 1000).toLocaleString()}</Text>}
                                    {analysis.created_at && <Text>Created: {new Date(analysis.created_at).toLocaleString()}</Text>}
                                </VStack>
                            </Box>
                        </Box>
                    </Box>
                )}
            </AnimatePresence>
        </Box>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <Flex
            py={16}
            justify="center"
            color="var(--ink-tertiary)"
            fontSize="13px"
        >
            {message}
        </Flex>
    );
}

