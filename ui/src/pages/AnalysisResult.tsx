import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
    Box,
    Flex,
    Text,
    Spinner,
    Container,
    Button,
    HStack,
    VStack,
    Tabs,
} from "@chakra-ui/react";
import { AnalysisService, API_BASE } from "@/db";
import axios from "axios";
import { formatSeconds } from "@/utils";
import SkillAvatar from "@/components/shared/SkillAvatar";
import AgentActivity from "../components/shared/AgentActivity";
import RunReasoningTimeline from "../components/report/RunReasoningTimeline";
import { MdArrowBack, MdDownload, MdInfo } from "react-icons/md";
import { motion, useReducedMotion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { ReportBlockRenderer } from "../components/builder/ReportBlockRenderer";
import { ReportDocumentRenderer } from "../components/report/ReportDocumentRenderer";
import { WorkspaceExplorer } from "../components/report/WorkspaceExplorer";
import type { ReportDocument } from "@/lib/reportContract";

import SkillResultCard from "./sections/SkillResultCard";
import { useSkillLibrary } from "@/components/skills/SkillBrowser";
import { SourceMark, TickerLogo } from "@/lib/sourceLogos";
import { ModelLogo } from "@/lib/modelLogos";
import {
    coverageLabel,
    insufficientCoverage,
    verdictForScore,
} from "@/lib/analysisFormat";

const TABS = ["report", "reasoning"] as const;
type Tab = (typeof TABS)[number];

const OP_SYMBOL: Record<string, string> = {
    gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between",
};

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

interface MetaRow {
    label: string;
    value: string;
}

const TERMINAL = ["complete", "completed", "success", "error", "failed", "budget_exhausted"];

/**
 * Everything the run row actually records, derived from what is stored:
 * tokens from the legacy per-criterion usage, tool data from `trace`, timing
 * from `duration`/`started_at`/`updated_at`. Fields no writer populates render
 * as "—" rather than a guessed number.
 */
export function runMetadata(run: any, skillTags: string[] = []): { rows: MetaRow[]; tools: { name: string; count: number }[] } {
    const trace: any[] = Array.isArray(run?.trace) ? run.trace : [];
    const toolCalls = trace.filter((e) => e?.type === "tool_call");
    const toolResults = trace.filter((e) => e?.type === "tool_result");
    const status = String(run?.status || "").toLowerCase();
    const terminal = TERMINAL.includes(status);

    // Skills declare the tools they need; the trace records the ones called.
    const byTool = new Map<string, number>();
    const skillOutputs: any[] = Array.isArray(run?.skill_outputs) ? run.skill_outputs : [];
    for (const o of skillOutputs) {
        for (const t of Array.isArray(o?.tools_used) ? o.tools_used : []) byTool.set(String(t), 0);
    }
    for (const t of toolCalls) {
        const name = t?.tool || "unknown";
        byTool.set(name, (byTool.get(name) || 0) + 1);
    }
    const tools = [...byTool.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const tokens = tokensUsed(run?.qualitative_analysis || {});
    const toolMs = toolResults.reduce((sum, e) => sum + (typeof e?.duration_ms === "number" ? e.duration_ms : 0), 0);
    const toolErrors = toolResults.filter((e) => e?.status === "error" || e?.status === "failed").length;
    const steps: any[] = Array.isArray(run?.steps) ? run.steps : [];
    const stepsDone = steps.filter((st) => ["complete", "completed", "success", "done", "ok"].includes(String(st?.status || "").toLowerCase())).length;
    const webSources = Array.isArray(run?.web_sources) ? run.web_sources.length : 0;

    const started = run?.started_at || run?.created_at || null;
    const wallMs = started ? (terminal ? +new Date(run?.updated_at || started) : Date.now()) - +new Date(started) : null;
    const duration =
        typeof run?.duration === "number" && run.duration > 0
            ? formatSeconds(Math.round(run.duration))
            : wallMs !== null && wallMs >= 0
                ? formatSeconds(Math.round(wallMs / 1000))
                : null;
    const ts = (v: any) =>
        typeof v === "string" && v
            ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : null;

    const rows: MetaRow[] = [];
    const push = (label: string, value: string | null | undefined) => {
        if (value !== null && value !== undefined && value !== "") rows.push({ label, value });
    };

    push("Duration", duration);
    push("Model", run?.model);
    push("Tokens", tokens ? `${formatTokens(tokens.total)} net · ${formatTokens(tokens.input)} in / ${formatTokens(tokens.output)} out` : "—");
    push("Tool calls", trace.length ? `${toolCalls.length}${toolErrors ? ` · ${toolErrors} failed` : ""}` : "—");
    push("Tool time", toolMs > 0 ? (toolMs < 1000 ? `${toolMs}ms` : formatSeconds(Math.round(toolMs / 1000))) : null);
    push("Reasoning turns", trace.length ? String(trace.filter((e) => e?.type === "thought").length) : "—");
    const decisions = trace.filter((e) => e?.type === "decision").length;
    push("Decisions", decisions > 0 ? String(decisions) : null);
    push("Trace events", trace.length > 0 ? String(trace.length) : null);
    push("Steps", steps.length ? `${stepsDone}/${steps.length}` : null);
    push("Run mode", run?.run_mode || (run?.report ? "harness" : run?.skill_id ? "skill" : null));
    push("Skill", run?.skill_id);
    push("Tags", skillTags.length ? skillTags.join(" · ") : null);
    push("Agent", run?.agent_name);
    push("Market", run?.source ? String(run.source).toUpperCase() : null);
    push("Web search", typeof run?.web_search === "boolean" ? (run.web_search ? `on${webSources ? ` · ${webSources} sources` : ""}` : "off") : null);
    push("Documents", Array.isArray(run?.documents) && run.documents.length ? String(run.documents.length) : null);
    push("Started", ts(started));
    push("Finished", terminal ? ts(run?.updated_at) : null);
    push("Run id", run?.id);

    return { rows, tools };
}

/** Compact record of what the run row holds — shown on every analysis result.
 *  Label and value share one line and the pairs wrap, so the whole block reads
 *  as a meta strip instead of a grid of stacked cells. */
export function RunMetadata({ run, tags }: { run: any; tags?: string[] }) {
    const { rows, tools } = useMemo(() => runMetadata(run, tags), [run, tags]);
    if (!rows.length && !tools.length) return null;
    return (
        <Box my={3} pt={2.5} borderTop="1px solid var(--hairline)">
            <Text fontSize="9.5px" fontWeight={300} color="var(--ink-tertiary)" mb={1.5}>
                Run metadata
            </Text>
            <Flex flexWrap="wrap" columnGap={4} rowGap={1.5}>
                {rows.map((r) => (
                    <Text key={r.label} minW={0} maxW="full" fontSize="10.5px" fontWeight={300}>
                        <Text as="span" fontFamily="var(--font-body)" fontSize="10.5px" fontWeight={300} color="var(--ink-tertiary)" mr={1.5}>
                            {r.label}
                        </Text>
                        <Text as="span" fontFamily="var(--font-body)" fontSize="11.5px" fontWeight={400} color="var(--ink-primary)" overflowWrap="anywhere">
                            {r.value}
                        </Text>
                    </Text>
                ))}
            </Flex>
            {tools.length > 0 && (
                <Flex gap={2} flexWrap="wrap" align="baseline" mt={1.5}>
                    <Text fontFamily="var(--font-body)" fontSize="10.5px" fontWeight={300} color="var(--ink-tertiary)" whiteSpace="nowrap">
                        Tools
                    </Text>
                    <Text fontFamily="var(--font-body)" fontSize="11.5px" fontWeight={400} color="var(--ink-secondary)" overflowWrap="anywhere">
                        {tools.map((t, i) => (
                            <Text as="span" key={t.name}>
                                {t.name}
                                {t.count > 1 ? ` ×${t.count}` : ""}
                                {i < tools.length - 1 ? "  ·  " : ""}
                            </Text>
                        ))}
                    </Text>
                </Flex>
            )}
        </Box>
    );
}

export default function AnalysisResult() {
    const { id } = useParams();
    const reducedMotion = useReducedMotion();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pdfState, setPdfState] = useState<"idle" | "busy" | "error">("idle");
    const [activeTab, setActiveTab] = useState<Tab>("report");

    const statusKey = (analysis?.status || "").toLowerCase();
    const terminalStatuses = ["complete", "completed", "success", "error", "failed", "budget_exhausted"];
    const isRunning = !!analysis && !terminalStatuses.includes(statusKey);
    const isComplete = !!analysis && terminalStatuses.includes(statusKey);

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

    // Skill tags come from the live library, keyed by skill id — shown on the
    // hero identity line (skill runs) and in run metadata (harness runs).
    const { library: skillLibrary } = useSkillLibrary();
    const skillTags = useMemo(() => {
        const m: Record<string, string[]> = {};
        for (const s of skillLibrary) if (s.tags?.length) m[s.id] = s.tags;
        return m;
    }, [skillLibrary]);
    const runSkillTags = useMemo(() => {
        const ids: string[] = Array.isArray(analysis?.skill_ids) && analysis.skill_ids.length
            ? analysis.skill_ids
            : analysis?.skill_id ? [analysis.skill_id] : [];
        return Array.from(new Set(ids.flatMap((i) => skillTags[i] || [])));
    }, [analysis, skillTags]);

    if (loading && !analysis) {
        // 5e: skeleton of the real layout instead of a bare spinner — no layout shift.
        return (
            <Box bg="var(--surface-canvas)" minH="100%">
                <Container maxW="full" px={0} py={6}>
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

    // Harness runs (and any live run, even before the first canvas snapshot)
    // render the workspace-first view: agent workspace only while running,
    // report only once the run is terminal. The legacy layout below is for
    // completed skill-era rows.
    if (isRunning || analysis.report_document) {
        return <HarnessRunView run={analysis} tags={runSkillTags} />;
    }

    const s = (analysis.status || "").toLowerCase();
    const isError = s === "error" || s === "failed";

    // Per-skill reports — what the skill pipeline actually produced for this run.
    const skillOutputs: any[] = Array.isArray(analysis.skill_outputs) ? analysis.skill_outputs : [];

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
    // message — the hero reports "Unscored" and the caution callout explains why.
    const lowCoverage = insufficientCoverage(coverage);
    const showScore = totalScore != null && !lowCoverage;

    const runSubject = skillOutputs[0]?.skill_name || "Skill";

    // Hero data: the verdict leads, the identity block and score sentence hang off it.
    const verdict = verdictForScore(showScore ? totalScore : null);
    const company = analysis.share_name || analysis.symbol || "this company";
    const verdictDate = analysis.created_at
        ? new Date(analysis.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "";
    const identityLine = [skillOutputs[0]?.category, ...(skillTags[skillOutputs[0]?.skill_id] || [])]
        .filter(Boolean)
        .join(" · ");
    const skillScores = skillOutputs.map((o) => ({
        name: o.skill_name as string | undefined,
        score: typeof o.score_0_100 === "number" ? Math.round(o.score_0_100) : null,
    }));

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Container maxW="full" px={0} py={6}>
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
                            {/* Router Link doesn't take Chakra props — this is
                                styled with utility classes so the icon, label
                                and hover/focus states actually apply. */}
                            <Link
                                to="/analysis-list"
                                aria-label="Back to runs"
                                className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[13px] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                            >
                                <MdArrowBack aria-hidden="true" />
                                <span className="hidden sm:inline">Analyses</span>
                            </Link>
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

                {/* Company identity: non-sticky sub-header, visible at all widths */}
                <Box mb={5}>
                    <Flex align="center" gap={2.5} minW={0}>
                        <TickerLogo symbol={analysis.symbol} size={22} />
                        <Text
                            fontSize="16px"
                            fontWeight={600}
                            color="var(--ink-primary)"
                            lineHeight="short"
                            truncate
                        >
                            {analysis.share_name || analysis.symbol}
                        </Text>
                        <Text
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            flexShrink={0}
                        >
                            {analysis.symbol}
                        </Text>
                        <Box w="1px" h="14px" bg="var(--hairline)" flexShrink={0} />
                        <SourceMark
                            source={(analysis.source || "").toUpperCase().includes("SEC") ? "sec" : "nse"}
                            size={16}
                        />
                    </Flex>
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

                {/* Hero: the verdict leads — its word is the headline, the
                    identity block (avatar → actor → skills → model) and the
                    score sentence are read from it. Skill runs get the same
                    block; only the wording of the sentence changes. */}
                {isComplete && (
                    <Box mb={6} as={motion.div} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                        <Text fontSize="12px" color="var(--ink-tertiary)" mb={3} letterSpacing="0.03em">
                            {verdictDate ? `Verdict as of ${verdictDate}` : "Verdict"}
                        </Text>
                        <Text
                            fontSize={{ base: "52px", md: "88px" }}
                            fontWeight={400}
                            lineHeight="0.95"
                            fontFamily="var(--font-display)"
                            color={verdict.color}
                            mb={4}
                        >
                            {verdict.label}
                        </Text>
                        <Flex align="flex-start" gap={3} mb={4}>
                            <SkillAvatar skill={{ id: analysis.skill_id, name: skillOutputs[0]?.skill_name }} size={56} />
                            <Box minW={0}>
                                <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" lineHeight="1.35">
                                    {runSubject || "Agent"}
                                </Text>
                                {identityLine && (
                                    <Text
                                        fontSize="12px"
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-tertiary)"
                                        mt={1}
                                        overflowWrap="anywhere"
                                    >
                                        {identityLine}
                                    </Text>
                                )}
                                <HStack gap={1.5} mt={1} align="center">
                                    <ModelLogo model={analysis.model} size={13} />
                                    <Text fontSize="12px" color="var(--ink-tertiary)" truncate>
                                        {analysis.model || "Unknown model"}
                                    </Text>
                                </HStack>
                            </Box>
                        </Flex>
                        <Text fontSize="15px" color="var(--ink-secondary)" lineHeight="1.6" maxW="74ch" mb={2}>
                            <ScoreSentence
                                mode="skill"
                                actor={runSubject}
                                company={company}
                                score={showScore ? totalScore : null}
                                color={verdict.color}
                                skills={skillScores}
                            />
                        </Text>
                        {/* Disclaimer: verdict provenance, kept quiet — grey, small, icon-led. */}
                        <Text
                            display="flex"
                            alignItems="flex-start"
                            gap={1.5}
                            fontSize="11.5px"
                            color="var(--ink-tertiary)"
                            lineHeight="1.5"
                            maxW="74ch"
                            mb={4}
                        >
                            <MdInfo size={13} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                            <span>
                                The verdict is not investment advice — it depends on the quality of the{" "}
                                <Link
                                    to="/my-workspace/skills"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[var(--ink-tertiary)] underline decoration-[var(--hairline)] underline-offset-2 transition-colors hover:text-[var(--ink-secondary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                                >
                                    skills
                                </Link>
                                ; make sure their instructions are verified before running them.
                            </span>
                        </Text>
                        <HStack gap={2} flexWrap="wrap">
                            {coverage != null && (
                                <Box px={3} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)">
                                    <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                        {coverageLabel(coverage)} of rubric scored
                                    </Text>
                                </Box>
                            )}
                        </HStack>
                        {lowCoverage && (
                            <Box maxW="70ch" mt={3}>
                                <Callout tone="caution" title="Not enough of the rubric could be scored to give a reliable headline score.">
                                    Only {coverageLabel(coverage)} of the criteria had usable data. Review the breakdowns below — unscored criteria are excluded, not failed.
                                </Callout>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Completed runs: report tabs (legacy skill pipeline). */}
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
                            <Box>
                                {isComplete ? (
                                    <Box>
                                        {/* Decision-first order (E1): synthesis and verdict
                                            first, evidence-dense breakdowns after. */}
                                        {/* Report Section (agent runs, or skill runs that got a synthesized report) */}
                                        {(!!analysis.report) && (
                                        <Box mb={6}>
                                            {analysis.report ? (
                                                <>
                                                    <ReportBlockRenderer blocks={analysis.report.blocks} lookup={evidenceLookup} />
                                                </>
                                            ) : (
                                                <Callout tone="caution">
                                                    No executive synthesis for this run — review the parameter breakdowns below.
                                                </Callout>
                                            )}
                                        </Box>
                                        )}

                                        <Box mb={4}>
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
                                <SectionHeader label="Agent Reasoning" count={traceCount} />
                                {isRunning ? (
                                    <AgentActivity
                                        title={`Analyzing ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="gathering data, searching, scoring"
                                        streamUrl={`/analysis/${id}/stream`}
                                        steps={[]}
                                        startedAt={analysis.created_at ? +new Date(analysis.created_at) : undefined}
                                        active
                                        maxHeight={480}
                                        separateToolResults
                                    />
                                ) : (
                                    <AgentActivity
                                        title={`Reasoning history — ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="full tool and thought trace"
                                        events={analysis.trace || []}
                                        steps={[]}
                                        active={false}
                                        maxHeight={480}
                                        separateToolResults
                                    />
                                )}
                            </Box>
                        </Tabs.Content>

                    </Tabs.Root>
                    </Box>

                {/* Everything this run recorded: tokens, tool calls, tools, timings. */}
                <RunMetadata run={analysis} />

            </Container>
        </Box>
    );
}

/* ─── Sub-components ─── */

/** 5d: one shared callout for caution/negative/info — replaces 5 copy-pasted blocks. */

/**
 * Surfaces `artifacts.verification` (api/src/types/layout.ts): silent only when
 * the layout came straight from the model and every reference grounded — the
 * fallback sources and unresolved refs otherwise say so, so a best-effort
 * render is never mistaken for a full one.
 */
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

// Hard-coded score sentence, per run mode. Scores are set in the display face
// at weight 500 and tinted with the verdict colour, so colour = band only.
function ScoreSentence({
    mode,
    actor,
    company,
    score,
    color,
    skills,
}: {
    mode: "agent" | "skill";
    actor: string;
    company: string;
    score: number | null;
    color: string;
    skills: { name?: string; score: number | null }[];
}) {
    const num = (v: number, key?: string) => (
        <Text
            as="span"
            key={key}
            fontFamily="var(--font-display)"
            fontWeight={500}
            color={color}
        >
            {v}/100
        </Text>
    );

    if (score == null) {
        return (
            <span>
                {mode === "agent" ? "The agent" : `The ${actor}`} evaluated {company} — no headline score for this run.
            </span>
        );
    }

    if (mode === "skill") {
        return (
            <span>
                The {actor} skill scored {company} {num(score)}.
            </span>
        );
    }

    const perSkill = skills
        .filter((s) => s.name && s.score != null)
        .slice(0, 3)
        .map((s) => `${s.name} ${s.score}`)
        .join(" and ");

    return (
        <span>
            The agent scored {company} {num(score)}
            {perSkill ? `, with individual skill scores of ${perSkill}.` : "."}
        </span>
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

const HARNESS_TABS = ["report", "agent workspace"] as const;
type HarnessTab = (typeof HARNESS_TABS)[number];

/** Harness run result: the typed ReportDocument + the Agent Workspace (reasoning + knowledge base). */
function HarnessRunView({ run, tags }: { run: any; tags?: string[] }) {
    const doc = run.report_document as ReportDocument;
    const status = String(run.status || "").toLowerCase();
    const failed = status === "failed" || status === "budget_exhausted" || status === "error";
    // Mid-run the canvas pipeline flushes a partial document — but the report
    // tab stays hidden until the run is terminal; live viewing happens in the
    // agent workspace (reasoning timeline + knowledge base) behind a spinner.
    const drafting = status === "running" || status === "pending" || status === "processing";
    // Derived tab — no effect: while drafting the workspace is the ONLY view;
    // the moment the run finishes the report is selected (unless the user
    // picks a tab afterwards, which is what the null default preserves).
    const [postRunTab, setPostRunTab] = useState<HarnessTab | null>(null);
    const harnessTab: HarnessTab = drafting ? "agent workspace" : postRunTab ?? "report";
    const workspace = (run.workspace ?? null) as Record<string, string> | null;
    const hasTrace = Array.isArray(run.trace) && run.trace.length > 0;
    return (
        <Box bg="var(--surface-canvas)">
            <Container maxW="full" px={0} pt={6} pb={2}>
                <Link
                    to="/analysis-list"
                    className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[13px] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
                >
                    <MdArrowBack aria-hidden="true" />
                    <span className="hidden sm:inline">Analyses</span>
                </Link>
                <Tabs.Root
                    value={harnessTab}
                    onValueChange={(details) => {
                        if (!drafting) setPostRunTab(details.value as HarnessTab);
                    }}
                    variant="line"
                    size="sm"
                    mt={2}
                >
                    <Tabs.List
                        gap={0}
                        borderBottom="1px solid var(--hairline)"
                        mb={6}
                        overflowX="auto"
                        data-print-hide
                    >
                        {HARNESS_TABS.map((tab) => {
                            // No report trigger until the run completes — the
                            // report must not be reachable mid-run at all.
                            if (drafting && tab !== "agent workspace") return null;
                            return (
                            <Tabs.Trigger
                                key={tab}
                                value={tab}
                                fontSize="13px"
                                fontWeight={harnessTab === tab ? 600 : 400}
                                color={harnessTab === tab ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                                textTransform="capitalize"
                                px={{ base: 3, md: 4 }}
                                py={2.5}
                                minH={{ base: "44px", md: "auto" }}
                                flexShrink={0}
                                whiteSpace="nowrap"
                                position="relative"
                                _hover={{ color: "var(--ink-primary)" }}
                                transition="none"
                            >
                                {tab}
                                {harnessTab === tab && (
                                    <Box as={motion.div} layoutId="harness-tab-underline" position="absolute" bottom={0} left={0} right={0} h="2px" bg="var(--accent-primary)" />
                                )}
                            </Tabs.Trigger>
                            );
                        })}
                    </Tabs.List>

                    {/* ── Report ── */}
                    <Tabs.Content value="report">
                        {drafting && (
                            <Box mt={4}>
                                <Callout tone="info" title="Report is being written">
                                    Sections land on the report as the agent composes them. The remaining sections appear
                                    when they are ready — nothing is lost if the run stops early.
                                </Callout>
                            </Box>
                        )}
                        {failed && (
                            <Text mt={4} fontSize="13px" color="var(--ink-secondary)">
                                The run did not complete — the report below is partial.
                            </Text>
                        )}
                        <Box mt={4}>
                            <ReportDocumentRenderer document={doc} />
                        </Box>
                        <RunMetadata run={run} tags={tags} />
                    </Tabs.Content>

                    {/* ── Agent Workspace ── */}
                    <Tabs.Content value="agent workspace">
                        {drafting && (
                            <Flex align="center" gap={2.5} mt={4} mb={2}>
                                <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                                <Text fontSize="13px" color="var(--ink-secondary)">
                                    Run in progress — reasoning and knowledge base stream in here live.
                                </Text>
                            </Flex>
                        )}
                        {hasTrace && (
                            <Box mt={4} mb={2}>
                                <Text fontSize="13px" fontWeight={600} mb={3}>Agent Reasoning</Text>
                                <RunReasoningTimeline events={run.trace} active={drafting} />
                            </Box>
                        )}
                        {workspace && (
                            <Box mt={8} mb={6}>
                                <Text fontSize="13px" fontWeight={600} mb={1}>Knowledge Base</Text>
                                <Text fontSize="12px" color="var(--ink-secondary)" mb={3}>
                                    Evidence the agent gathered and distilled during research — notes cite archived sources.
                                </Text>
                                <WorkspaceExplorer workspace={workspace} live={drafting} />
                            </Box>
                        )}
                        {!drafting && !hasTrace && !workspace && (
                            <Text mt={4} fontSize="13px" color="var(--ink-tertiary)">
                                No workspace data recorded for this run.
                            </Text>
                        )}
                    </Tabs.Content>
                </Tabs.Root>
            </Container>
        </Box>
    );
}
