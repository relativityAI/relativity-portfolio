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
    HStack,
    VStack,
    Tabs,
} from "@chakra-ui/react";
import { AnalysisService, AgentService, API_BASE } from "@/db";
import axios from "axios";
import { formatSeconds, agentDisplayName } from "@/utils";
import AgentAvatar from "@/components/shared/AgentAvatar";
import SkillAvatar from "@/components/shared/SkillAvatar";
import { resolveAgent } from "@/lib/agentIdentity";
import AgentActivity from "../components/shared/AgentActivity";
import { MdArrowBack, MdDownload } from "react-icons/md";
import { motion, useReducedMotion } from "motion/react";
import { CountUp, dur, ease } from "@/lib/motion";
import { ReportBlockRenderer } from "../components/builder/ReportBlockRenderer";
import SkillResultCard from "./sections/SkillResultCard";
import { SourceMark, TickerLogo } from "@/lib/sourceLogos";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { runProgressPct } from "./shared/RunStatus";
import {
    bandForScore,
    coverageLabel,
    insufficientCoverage,
} from "@/lib/analysisFormat";

const TABS = ["report", "reasoning"] as const;
type Tab = (typeof TABS)[number];

const OP_SYMBOL: Record<string, string> = {
    gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between",
};

function isMacroSection(section: string): boolean {
    return String(section || "").toLowerCase().includes("macro");
}

function generateVerdict(totalScore: number | null, quant: Record<string, any>, qual: Record<string, any>): string {
    if (totalScore == null) return "Run completed. Review quantitative and qualitative sections for details.";
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
        // Anchor to the run's persisted start, not page-load time, so a
        // refresh mid-run resumes the clock instead of restarting at 0.
        const anchor = analysis?.started_at || analysis?.created_at;
        const parsed = anchor ? +new Date(anchor) : NaN;
        const start = Number.isFinite(parsed) ? parsed : Date.now();
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [isRunning, analysis?.started_at, analysis?.created_at]);

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
                        setError("Run not found");
                    }
                } catch {
                    if (!fetchCancelled.current) setError("Failed to load run result");
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
                                        else setError("Run not found");
                                    } catch {
                                        setError("Failed to load run result");
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

    const quantAnalysis: Record<string, any> = analysis.quantitative_analysis || {};
    const qualAnalysis: Record<string, any> = analysis.qualitative_analysis || {};
    // Per-skill reports — what the skill pipeline actually produced for this run.
    const skillOutputs: any[] = Array.isArray(analysis.skill_outputs) ? analysis.skill_outputs : [];

    const tokenUse = tokensUsed(qualAnalysis);
    const traceCount = Array.isArray(analysis.trace) ? analysis.trace.length : 0;

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
    const coverage: number | null = analysis.coverage ?? null;
    // U2: low coverage must never show a big headline number AND a suppression
    // message — the hero renders "—" and the caution callout explains why.
    const lowCoverage = insufficientCoverage(coverage);

    const verdictSentence = generateVerdict(totalScore, quantAnalysis, qualAnalysis);

    const isSkillRun = analysis.run_mode === "skill";
    const runSubject = isSkillRun
        ? (skillOutputs[0]?.skill_name || "Skill")
        : agentName(analysis.agent_name);

    const metaLine = [
        analysis.model,
        analysis.source,
        isSkillRun
            ? (skillOutputs[0]?.skill_name ? `${skillOutputs[0].skill_name} (skill run)` : "Skill run")
            : analysis.agent_name ? agentName(analysis.agent_name) : null,
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
                                aria-label="Back to runs"
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
                            <TickerLogo symbol={analysis.symbol} size={24} />
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
                            {/* Exchange mark for the market this stock was selected on */}
                            <SourceMark
                                source={(analysis.source || "").toUpperCase().includes("SEC") ? "sec" : "nse"}
                                size={22}
                            />
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

                {analysis.error && isComplete && (
                    <Box mb={6}>
                        <Callout tone="negative" title="Run Error">
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
                        runMode={analysis.run_mode || "agent"}
                        onJump={(key) => {
                            const el = sectionRefs.current[key];
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                    />
                )}

                {/* Hero: Total score (biggest) + Agent avatar (big, clearly visible).
                    Skill runs have no executive summary, so no hero — just the skill report. */}
                {isComplete && analysis.run_mode !== "skill" && (
                    <Box mb={6} as={motion.div} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                        <Flex direction="column" align="flex-start" gap={4}>
                            <Box>
                                {analysis.run_mode === "skill" ? (
                                    <SkillAvatar skill={{ id: analysis.skill_id, name: skillOutputs[0]?.skill_name }} size={72} />
                                ) : (
                                    <AgentAvatar agent={resolveAgent(analysis.agent_name, agents)} size={72} />
                                )}
                            </Box>
                            <Box>
                                <Text fontSize="14px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>
                                    {analysis.report?.heroLabel ? "Stance" : "Total Score"}
                                </Text>
                                {analysis.report?.heroLabel ? (
                                    <HStack gap={2} align="baseline">
                                        <Text
                                            fontSize={analysis.report.heroLabel.length > 14 ? "52px" : "88px"}
                                            fontWeight={800}
                                            lineHeight="0.85"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            letterSpacing="-0.05em"
                                            color="var(--ink-primary)"
                                        >
                                            {analysis.report.heroLabel}
                                        </Text>
                                    </HStack>
                                ) : totalScore != null && !lowCoverage ? (
                                    <HStack gap={2} align="baseline">
                                        <Text
                                            fontSize="88px"
                                            fontWeight={800}
                                            lineHeight="0.85"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            letterSpacing="-0.05em"
                                            color="var(--ink-primary)"
                                        >
                                            <CountUp value={analysis.report ? analysis.report.heroPct : totalScore} decimals={1} />
                                        </Text>
                                        <Text fontSize="24px" color="var(--ink-tertiary)" fontWeight={700}>
                                            / 100
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="88px" fontWeight={800} lineHeight="0.85" fontFamily="var(--font-tabular)" color="var(--ink-tertiary)">
                                        —
                                    </Text>
                                )}
                            </Box>
                            <HStack gap={2} flexWrap="wrap">
                                {totalScore != null && !lowCoverage && (
                                    <Box px={3} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)">
                                        <Text fontSize="12px" fontWeight={600} color={bandForScore(totalScore).color}>
                                            {bandForScore(totalScore).label}
                                        </Text>
                                    </Box>
                                )}
                                {coverage != null && (
                                    <Box px={3} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)">
                                        <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                            {coverageLabel(coverage)} of rubric scored
                                        </Text>
                                    </Box>
                                )}
                            </HStack>
                            {!analysis.report && (
                                <Text fontSize="14px" color="var(--ink-secondary)" lineHeight="relaxed" maxW="70ch">
                                    {verdictSentence}
                                </Text>
                            )}
                            {lowCoverage && (
                                <Box maxW="70ch">
                                    <Callout tone="caution" title="Not enough of the rubric could be scored to give a reliable headline score.">
                                        Only {coverageLabel(coverage)} of the criteria had usable data. Review the breakdowns below — unscored criteria are excluded, not failed.
                                    </Callout>
                                </Box>
                            )}
                        </Flex>
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
                        <Box maxW="460px" mt={3}>
                            <Progress value={runProgressPct(analysis.steps)}>
                                <ProgressLabel>Analysis progress</ProgressLabel>
                                <ProgressValue />
                            </Progress>
                        </Box>
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
                                        {/* Executive Summary Section (agent runs only) */}
                                        {analysis.run_mode !== "skill" && (
                                        <Box mb={8} data-section="summary" ref={(el: HTMLElement | null) => registerSection("summary", el)} css={{ scrollMarginTop: "72px" }}>
                                            <SectionHeader label="Executive Summary" count={analysis.report ? analysis.report.blocks.length : 0} />
                                            {analysis.report ? (
                                                <>
                                                    {analysis.report.partial && (coverage == null || coverage < 100) && (
                                                        <Box mb={4}>
                                                            <Callout tone="caution" title="Partial Result">
                                                                Some skills could not assess every anchor — this report leans on partial evidence{coverage != null ? ` (${coverageLabel(coverage)} of rubric scored)` : ""}.
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
                                                </>
                                            ) : (
                                                <Callout tone="caution">
                                                    No executive synthesis for this run — review the parameter breakdowns below.
                                                </Callout>
                                            )}
                                        </Box>
                                        )}

                                        {/* Skill Reports Section */}
                                        <Box mb={10} data-section="skills" ref={(el: any) => registerSection("skills", el)} css={{ scrollMarginTop: "72px" }}>
                                            <SectionHeader label="Skill Reports" count={skillOutputs.length} />
                                            {skillOutputs.length > 0 ? (
                                                <Flex direction="column" gap={6}>
                                                    {skillOutputs.map((out: any, i: number) => (
                                                        <SkillResultCard key={out.skill_id || out.skill_name || i} output={out} analysisId={id} />
                                                    ))}
                                                </Flex>
                                            ) : (
                                                <Callout tone="caution">
                                                    No skill reports were stored for this run.
                                                </Callout>
                                            )}
                                        </Box>
                                        </Box>
                                ) : (
                                    <EmptyState message="Waiting for the run to complete — the report appears here when it's done." />
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Reasoning (full agent trace, live while running) ── */}
                        <Tabs.Content value="reasoning">
                            <Box>
                                <SectionHeader label={isSkillRun ? "Skill Reasoning" : "Agent Reasoning"} count={traceCount} />
                                {isRunning ? (
                                    <AgentActivity
                                        title={`Analyzing ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="gathering data, searching, scoring"
                                        agent={resolveAgent(analysis.agent_name, agents)}
                                        streamUrl={`/analysis/${id}/stream`}
                                        steps={isSkillRun ? [] : analysis.steps || []}
                                        startedAt={analysis.created_at ? +new Date(analysis.created_at) : undefined}
                                        active
                                        maxHeight={480}
                                        separateToolResults={isSkillRun}
                                    />
                                ) : (
                                    <AgentActivity
                                        title={`Reasoning history — ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="full tool and thought trace"
                                        agent={resolveAgent(analysis.agent_name, agents)}
                                        events={analysis.trace || []}
                                        steps={isSkillRun ? [] : analysis.steps || []}
                                        active={false}
                                        maxHeight={480}
                                        separateToolResults={isSkillRun}
                                    />
                                )}
                            </Box>
                        </Tabs.Content>

                    </Tabs.Root>
                    </Box>

                    {/* Attribution the ticker-logo CDN licence requires; this
                        page hides the app footer, so it lives here instead. */}
                    <p className="mt-8 text-center text-[10px] text-[var(--ink-tertiary)]">
                        <a
                            href="https://www.allinvestview.com/tools/ticker-logos/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[var(--ink-secondary)]"
                        >
                            Logos by AllInvestView
                        </a>
                    </p>
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
    { key: "summary", label: "Executive Summary" },
    { key: "skills", label: "Skill Reports" },
];

function SectionNav({ active, runMode, onJump }: { active: string; runMode: string; onJump: (key: string) => void }) {
    return (
        <Flex
            gap={1}
            mb={4}
            wrap="wrap"
            role="navigation"
            aria-label="Report sections"
            data-print-hide
        >
            {SECTION_NAV_ITEMS.filter((item) => runMode !== "skill" || item.key !== "summary").map((item) => {
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
