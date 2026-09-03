import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import {
    Box,
    Flex,
    Text,
    Spinner,
    Container,
    Button,
    Table,
    HStack,
    VStack,
    Tabs,
    Menu,
} from "@chakra-ui/react";
import { AnalysisService, AgentService } from "@/db";
import { formatSeconds, agentDisplayName } from "@/utils";
import { RunSteps } from "./shared/RunStatus";
import ReactMarkdown from "react-markdown";
import { MdArrowBack, MdDownload, MdExpandMore, MdExpandLess, MdOutlineNotes, MdOutlineFileDownload } from "react-icons/md";
import { motion, AnimatePresence } from "motion/react";
import { CountUp, dur, ease, swap } from "@/lib/motion";

const TABS = ["overview", "quantitative", "qualitative"] as const;
type Tab = (typeof TABS)[number];

function scoreSignal(score: number): "positive" | "caution" | "negative" {
    if (score >= 70) return "positive";
    if (score >= 40) return "caution";
    return "negative";
}

function signalColor(signal: "positive" | "caution" | "negative"): string {
    if (signal === "positive") return "var(--signal-positive)";
    if (signal === "caution") return "var(--signal-caution)";
    return "var(--signal-negative)";
}

function formatCurrency(val: number): string {
    if (val >= 1e9) return `₹${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e7) return `₹${(val / 1e7).toFixed(2)}Cr`;
    if (val >= 1e5) return `₹${(val / 1e5).toFixed(2)}L`;
    return `₹${val.toLocaleString()}`;
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

function formatValue(val: any, type?: string): string {
    if (val == null) return "—";
    if (type === "currency" && typeof val === "number") return formatCurrency(val);
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
    const quantEntries = Object.values(quant);
    const live = quantEntries.filter((m: any) => !m.price_unavailable);
    const passed = live.filter((m: any) => (m.score ?? 0) >= 0.7).length;
    const failed = live.filter((m: any) => (m.score ?? 0) < 0.4).length;
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
            .filter((m: any) => (m.score ?? 0) < 0.4)
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
        const qualLabel = qualAvg >= 0.7 ? "supportive" : qualAvg >= 0.4 ? "moderately supportive" : "mixed";
        sentence += ` Qualitative narrative is ${qualLabel}.`;
    }
    if (macroAvg != null) {
        const macroLabel = macroAvg >= 0.7 ? "supportive" : macroAvg >= 0.4 ? "moderately supportive" : "mixed";
        sentence += ` Macro (market) narrative is ${macroLabel}.`;
    }
    if (qualEntries.some((p) => p.error)) {
        sentence += " Some qualitative parameters failed to score.";
    }
    return sentence;
}

export default function AnalysisResult() {
    const { id } = useParams();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
    const [activeTab, setActiveTab] = useState<Tab>("overview");
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
    const isRunning = !!analysis && !["complete", "completed", "success", "error", "failed"].includes(statusKey);

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

    const fetchResult = async () => {
        if (!id) return;
        try {
            setLoading(true);
            const data = await AnalysisService.readAnalysis(id);
            if (data) {
                setAnalysis(data);
                const s = (data.status || "").toLowerCase();
                if (s === "pending" || s === "running" || s === "processing") {
                    setTimeout(fetchResult, 3000);
                }
            } else {
                setError("Analysis not found");
            }
        } catch {
            setError("Failed to load analysis result");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchResult();
    }, [id]);

    const handleTabChange = useCallback((details: { value: string }) => {
        const tab = details.value as Tab;
        setActiveTab(tab);
        const el = sectionRefs.current[tab];
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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

    if (loading && !analysis) {
        return (
            <Container maxW="960px" py={12}>
                <Flex justify="center" align="center" minH="50vh" direction="column" gap={3}>
                    <Spinner size="lg" borderWidth="2px" color="var(--ink-secondary)" />
                    <Text fontSize="sm" color="var(--ink-secondary)">Fetching analysis results…</Text>
                </Flex>
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxW="960px" py={12}>
                <Flex direction="column" align="center" minH="50vh" gap={4}>
                    <Box
                        borderLeft="3px solid var(--signal-negative)"
                        pl={4}
                        py={2}
                    >
                        <Text fontSize="sm" color="var(--ink-primary)">{error}</Text>
                    </Box>
                    <Link to="/analysis-list">
                        <Button variant="subtle" size="sm" color="var(--ink-secondary)">
                            <MdArrowBack style={{ marginRight: 6 }} /> Back to List
                        </Button>
                    </Link>
                </Flex>
            </Container>
        );
    }

    if (!analysis) return null;

    const terminalStatuses = ["complete", "completed", "success", "error", "failed"];
    const s = (analysis.status || "").toLowerCase();
    const isComplete = terminalStatuses.includes(s);
    const isError = s === "error" || s === "failed";

    const quantAnalysis: Record<string, any> = analysis.quantitative_analysis || {};
    const qualAnalysis: Record<string, any> = analysis.qualitative_analysis || {};
    const toolCalls = analysis.qualitative_tool_calls || {};
    const docs: any[] = analysis.documents || [];
    const webSrc: string[] = analysis.web_sources || [];

    const assetQuant = Object.entries(quantAnalysis)
        .filter(([, d]) => !isMacroSection(d?.section))
        .map(([key, d]) => ({ key, ...d, _score: d.score ?? 0 }));
    const macroQuant = Object.entries(quantAnalysis)
        .filter(([, d]) => isMacroSection(d?.section))
        .map(([key, d]) => ({ key, ...d, _score: d.score ?? 0 }));
    const assetQual = Object.entries(qualAnalysis).filter(([, d]) => !isMacroSection(d?.section));
    const macroQual = Object.entries(qualAnalysis).filter(([, d]) => isMacroSection(d?.section));

    const toggleToolCalls = (param: string) => {
        setExpandedTools((prev) => ({ ...prev, [param]: !prev[param] }));
    };

    const downloadResult = () => {
        if (!analysis) return;
        const json = JSON.stringify(analysis, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${analysis.symbol || analysis.share_name || "analysis"}-${id?.slice(0, 8) || "result"}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadMarkdown = () => {
        if (!analysis) return;
        const assetQuant = Object.entries(quantAnalysis)
            .filter(([, d]) => !isMacroSection(d?.section));
        const macroQuant = Object.entries(quantAnalysis)
            .filter(([, d]) => isMacroSection(d?.section));
        const assetQual = Object.entries(qualAnalysis).filter(([, d]) => !isMacroSection(d?.section));
        const macroQual = Object.entries(qualAnalysis).filter(([, d]) => isMacroSection(d?.section));
        const shareName = analysis.share_name || analysis.symbol || "Analysis";
        const md: string[] = [];

        // Header + summary
        md.push(`# ${shareName} — FIT Score`, ``);
        md.push(`**${totalScore != null ? totalScore.toFixed(1) : "—"} / 100**`, ``);
        const summary = [
            `> ${verdictSentence}`,
            ``,
            `## Scores`,
            ``,
            `| Component | Score |`,
            `| --- | --- |`,
            `| **Fit Score** | ${totalScore != null ? `${totalScore.toFixed(1)} / 100` : "—"} |`,
            `| Quantitative | ${quantScore != null ? `${quantScore.toFixed(1)} / 100` : "—"} |`,
            `| Qualitative | ${qualScore != null ? `${qualScore.toFixed(1)} / 100` : "—"} |`,
            ``,
            `## Run Details`,
            ``,
            `| Field | Value |`,
            `| --- | --- |`,
            `| Symbol | ${analysis.symbol || "—"} |`,
            `| Company | ${analysis.share_name || "—"} |`,
            `| Agent | ${analysis.agent_name ? agentName(analysis.agent_name) : "—"} |`,
            `| Model | ${analysis.model || "—"} |`,
            `| Source | ${analysis.source || "—"} |`,
            `| Duration | ${analysis.duration != null ? formatDuration(analysis.duration) : "—"} |`,
            `| Created | ${analysis.created_at ? new Date(analysis.created_at).toLocaleString() : "—"} |`,
            `| Ended | ${analysis.end_time ? new Date(analysis.end_time * 1000).toLocaleString() : "—"} |`,
            ``,
        ];
        md.push(...summary);

        // Run steps trace
        const steps = analysis.steps || [];
        if (steps.length) {
            md.push(`## Run Steps`, ``);
            steps.forEach((st: any) => {
                const status = st?.status || "pending";
                const icon = status === "completed" ? "✓" : status === "failed" ? "✗" : status === "running" ? "•" : status === "skipped" ? "–" : "•";
                const dur = typeof st?.duration_ms === "number" ? ` (${formatSeconds(Math.round(st.duration_ms / 1000))})` : "";
                md.push(`- ${icon} **${st?.label || st?.key || "step"}** — ${status}${dur}`);
                if (st?.detail) md.push(`  ${st.detail}`);
            });
            md.push(``);
        }

        // Quantitative
        const opSymbol: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between" };
        if (quantAnalysis && Object.keys(quantAnalysis).length) {
            md.push(`## Quantitative`, ``);
            const rowsFor = (rows: [string, any][]) => rows.map(([key, d]) => {
                const score = typeof d?.score === "number" ? d.score * 100 : 0;
                const sig = scoreSignal(score);
                const criterion = d ? `${opSymbol[d.operator] || d.operator} ${d.threshold ?? ""}`.trim() : "—";
                const actual = d?.value != null ? formatValue(d.value, d?.metric_type) : "—";
                const name = d?.metric_name || key;
                return `| ${name} | ${criterion} | ${actual} | ${d?.weightage ?? "—"} | ${score.toFixed(1)} (${sig}) |`;
            });
            if (assetQuant.length) {
                md.push(`### Asset`, "", `| Metric | Criterion | Actual | Wgt | Score |`, `| --- | --- | --- | --- | --- |`, ...rowsFor(assetQuant), ``);
            }
            if (macroQuant.length) {
                md.push(`### Macro`, "", `| Metric | Criterion | Actual | Wgt | Score |`, `| --- | --- | --- | --- | --- |`, ...rowsFor(macroQuant), ``);
            }
        }

        // Qualitative
        if (qualAnalysis && Object.keys(qualAnalysis).length) {
            md.push(`## Qualitative`, ``);
            const qualRows = (rows: [string, any][]) => rows.map(([key, d]: [string, any]) => {
                const score = typeof d?.score === "number" ? d.score : 0;
                const sig = scoreSignal(score);
                const blocks: string[] = [];
                const header = `### ${d?.parameter || key}${d?.weightage != null ? ` — wgt ${d.weightage}` : ""}`;
                blocks.push(header);
                blocks.push(`**Score: ${score.toFixed(1)} / 100** (_${sig}_)`);
                if (d?.error) {
                    blocks.push(`**Error:** ${String(d.error)}`);
                }
                const body = d?.analysis || d?.content || "_No analysis available_";
                blocks.push(``, body);
                const calls = toolCalls?.[key] || [];
                if (calls.length) {
                    const names = calls.map((c: any) => c?.tool_name || "tool").filter(Boolean);
                    blocks.push(``, `**Tool calls:** ${names.join(", ")}`);
                }
                return blocks.join("\n");
            });
            if (assetQual.length) {
                md.push(`### Asset`, ``);
                qualRows(assetQual).forEach((r) => md.push(r, ``, `---`, ``));
            }
            if (macroQual.length) {
                md.push(`### Macro`, ``);
                qualRows(macroQual).forEach((r) => md.push(r, ``, `---`, ``));
            }
        }

        // Sources
        const hasSources = docs.length > 0 || webSrc.length > 0;
        const webNote =
            analysis.web_search_effective === "user" || analysis.web_search
                ? "Web search enabled"
                : analysis.web_search_effective === "auto"
                ? `Web search auto-enabled (internal data ${analysis.data_adequacy || "sparse"})`
                : "";
        if (hasSources || webNote) {
            md.push(`## Sources`, ``);
            if (docs.length) {
                md.push(`**Documents (${docs.length})**`, ``);
                docs.forEach((doc: any) => {
                    const name = typeof doc === "string" ? doc : doc.name || doc.title || JSON.stringify(doc);
                    md.push(`- ${name}`);
                });
                md.push(``);
            }
            if (webSrc.length) {
                md.push(`**Web Sources (${webSrc.length})**`, ``);
                webSrc.forEach((src: string) => md.push(`- ${src}`));
                md.push(``);
            }
            if (webNote) {
                md.push(`_${webNote}_`, ``);
            }
        }

        const filename = `${analysis.symbol || analysis.share_name || "analysis"}-${id?.slice(0, 8) || "result"}.md`;
        const blob = new Blob([md.join("\n")], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const totalScore: number | null = analysis.total_score;
    const quantScore: number | null = analysis.quantitative_score;
    const qualScore: number | null = analysis.qualitative_score;

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
        id ? `ID ${id.slice(0, 8)}` : null,
    ]
        .filter(Boolean)
        .join("  ·  ");

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Container maxW="1400px" mx="auto" py={6}>
                {/* Sticky identity + utility bar */}
                <Box
                    as={motion.div}
                    initial={{ opacity: 0, y: -8 }}
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
                >
                    <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                        <HStack gap={3} align="center" minW={0}>
                            <Link to="/analysis-list">
                                <Button variant="subtle" size="sm" color="var(--ink-secondary)" px={1} _hover={{ color: "var(--ink-primary)" }} flexShrink={0}>
                                    <MdArrowBack />
                                </Button>
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
                            <HStack gap={1.5} align="center">
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
                                <Menu.Root>
                                    <Menu.Trigger asChild>
                                        <Button
                                            as={motion.button}
                                            whileTap={{ scale: 0.96 }}
                                            variant="subtle"
                                            size="sm"
                                            color="var(--ink-secondary)"
                                            _hover={{ color: "var(--ink-primary)" }}
                                        >
                                            <MdDownload style={{ marginRight: 4 }} /> Export
                                        </Button>
                                    </Menu.Trigger>
                                    <Menu.Positioner>
                                        <Menu.Content minWidth="220px">
                                            <Menu.Item value="json" onClick={downloadResult}>
                                                <MdOutlineFileDownload />
                                                Download as JSON
                                            </Menu.Item>
                                            <Menu.Item value="md" onClick={downloadMarkdown}>
                                                <MdOutlineNotes />
                                                Download as Markdown
                                            </Menu.Item>
                                        </Menu.Content>
                                    </Menu.Positioner>
                                </Menu.Root>
                            )}
                        </HStack>
                    </Flex>
                    {metaLine && (
                        <Text
                            fontSize="11px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            mt={2}
                            overflowWrap={{ base: "anywhere", md: "normal" }}
                            display={{ base: "none", md: "block" }}
                        >
                            {metaLine}
                        </Text>
                    )}
                </Box>

                {analysis.price_data === "unavailable" && (
                    <Box
                        borderLeft="3px solid var(--signal-caution)"
                        pl={4}
                        py={3}
                        mb={6}
                        bg="var(--surface-panel)"
                    >
                        <Text fontSize="12px" fontWeight={500} color="var(--ink-primary)" mb={1}>
                            Live price data unavailable
                        </Text>
                        <Text fontSize="12px" color="var(--ink-secondary)">
                            No live price feed for this instrument — valuation and technical criteria are shown as N/A.
                        </Text>
                    </Box>
                )}

                {analysis.error && (
                    <Box
                        borderLeft="3px solid var(--signal-negative)"
                        pl={4}
                        py={3}
                        mb={6}
                        bg="var(--surface-panel)"
                    >
                        <Text fontSize="12px" fontWeight={500} color="var(--ink-primary)" mb={1}>
                            Analysis Error
                        </Text>
                        <Text
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-secondary)"
                            whiteSpace="pre-wrap"
                            wordBreak="break-word"
                        >
                            {analysis.error}
                        </Text>
                    </Box>
                )}

                {/* Verdict band — the 3-second read */}
                {isComplete && (
                    <Box mb={6} as={motion.div} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                        <Flex
                            direction={{ base: "column", md: "row" }}
                            align={{ base: "flex-start", md: "center" }}
                            gap={{ base: 4, md: 6 }}
                        >
                            {/* Hero score */}
                            <Box>
                                <Text
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    letterSpacing="0.06em"
                                    textTransform="uppercase"
                                    mb={1}
                                >
                                    Fit Score
                                </Text>
                                {totalScore != null ? (
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
                                            <CountUp value={totalScore} decimals={1} />
                                        </Text>
                                        <Box
                                            as={motion.div}
                                            initial={{ scaleY: 0 }}
                                            animate={{ scaleY: 1 }}
                                            transition={{ duration: 0.5, ease, delay: 0.2 }}
                                            style={{ transformOrigin: "bottom" }}
                                            w="3px"
                                            h="28px"
                                            bg={signalColor(scoreSignal(totalScore))}
                                            borderRadius="1px"
                                        />
                                    </HStack>
                                ) : (
                                    <Text fontSize="32px" fontWeight={600} color="var(--ink-tertiary)">
                                        —
                                    </Text>
                                )}
                            </Box>

                            {/* Quant bar */}
                            <Box flex={1} minW="120px">
                                <Text
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    letterSpacing="0.06em"
                                    textTransform="uppercase"
                                    mb={1}
                                >
                                    Quant
                                </Text>
                                {quantScore != null ? (
                                    <HStack gap={2}>
                                        <Box flex={1} h="4px" bg="var(--surface-recessed)" borderRadius="1px" overflow="hidden">
                                            <Box
                                                as={motion.div}
                                                h="100%"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${quantScore}%` }}
                                                transition={{ duration: 0.7, ease, delay: 0.15 }}
                                                bg={signalColor(scoreSignal(quantScore))}
                                                borderRadius="1px"
                                            />
                                        </Box>
                                        <Text
                                            fontSize="13.5px"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-primary)"
                                            minW="44px"
                                            textAlign="right"
                                        >
                                            <CountUp value={quantScore} decimals={1} />
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="13px" color="var(--ink-tertiary)">N/A</Text>
                                )}
                            </Box>

                            {/* Qual bar */}
                            <Box flex={1} minW="120px">
                                <Text
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    color="var(--ink-tertiary)"
                                    letterSpacing="0.06em"
                                    textTransform="uppercase"
                                    mb={1}
                                >
                                    Qual
                                </Text>
                                {qualScore != null ? (
                                    <HStack gap={2}>
                                        <Box flex={1} h="4px" bg="var(--surface-recessed)" borderRadius="1px" overflow="hidden">
                                            <Box
                                                as={motion.div}
                                                h="100%"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${qualScore}%` }}
                                                transition={{ duration: 0.7, ease, delay: 0.25 }}
                                                bg={signalColor(scoreSignal(qualScore))}
                                                borderRadius="1px"
                                            />
                                        </Box>
                                        <Text
                                            fontSize="13.5px"
                                            fontFamily="var(--font-tabular)"
                                            fontVariantNumeric="tabular-nums"
                                            color="var(--ink-primary)"
                                            minW="44px"
                                            textAlign="right"
                                        >
                                            <CountUp value={qualScore} decimals={1} />
                                        </Text>
                                    </HStack>
                                ) : (
                                    <Text fontSize="13px" color="var(--ink-tertiary)">N/A</Text>
                                )}
                            </Box>
                        </Flex>

                        {/* Verdict sentence */}
                        <Text
                            fontSize="13.5px"
                            color="var(--ink-secondary)"
                            mt={3}
                            lineHeight="relaxed"
                        >
                            {verdictSentence}
                        </Text>
                    </Box>
                )}

                {/* Running state ↔ completed report crossfade */}
                <AnimatePresence mode="wait">
                {isRunning && (
                    <Box key="running" as={motion.div} variants={swap} initial="initial" animate="animate" exit="exit" mb={6}>
                        <Flex justify="space-between" align="center" mb={3}>
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

                        <Box
                            border="1px solid var(--hairline)"
                            borderRadius="2px"
                            bg="var(--surface-panel)"
                            p={5}
                        >
                            <Text
                                fontSize="10.5px"
                                fontWeight={500}
                                color="var(--ink-tertiary)"
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                mb={4}
                            >
                                Steps
                            </Text>
                            <RunSteps steps={analysis.steps || []} now={Date.now()} />
                        </Box>
                    </Box>
                )}

                {/* Section nav */}
                {isComplete && (
                    <Box key="report" as={motion.div} variants={swap} initial="initial" animate="animate" exit="exit">
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
                        >
                            {TABS.map((tab) => (
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
                                    _hover={{ color: "var(--ink-primary)" }}
                                    _selected={{
                                        color: "var(--ink-primary)",
                                        fontWeight: 600,
                                    }}
                                    transition="none"
                                >
                                    {tab}
                                    {activeTab === tab && (
                                        <Box as={motion.div} layoutId="tab-underline" position="absolute" bottom={0} left={0} right={0} h="2px" bg="var(--accent-primary)" />
                                    )}
                                </Tabs.Trigger>
                            ))}
                        </Tabs.List>

                        {/* ── Overview ── */}
                        <Tabs.Content value="overview">
                            <Box ref={(el) => registerSection("overview", el)} data-section="overview">
                                {/* Quantitative preview */}
                                {quantEntries.length > 0 && (
                                    <Box mb={8}>
                                        <SectionHeader label="Quantitative" count={quantEntries.length} />
                                        <Box mb={3}>
                                            <Button
                                                size="xs"
                                                variant="subtle"
                                                color="var(--ink-tertiary)"
                                                onClick={() => {
                                                    setActiveTab("quantitative");
                                                    requestAnimationFrame(() => sectionRefs.current["quantitative"]?.scrollIntoView({ behavior: "smooth", block: "start" }));
                                                }}
                                                px={1}
                                                _hover={{ color: "var(--ink-primary)" }}
                                            >
                                                View full table →
                                            </Button>
                                        </Box>
                                        <SubHeader label="Asset" count={assetQuant.length} />
                                        <QuantTable
                                            entries={assetQuant}
                                            sortByScore={sortByScore}
                                            setSortByScore={setSortByScore}
                                            formatValue={formatValue}
                                        />
                                        {macroQuant.length > 0 && (
                                            <Box mt={6}>
                                                <SubHeader label="Macro" count={macroQuant.length} />
                                                <QuantTable
                                                    entries={macroQuant}
                                                    sortByScore={sortByScore}
                                                    setSortByScore={setSortByScore}
                                                    formatValue={formatValue}
                                                />
                                            </Box>
                                        )}
                                    </Box>
                                )}

                                {/* Qualitative preview */}
                                {Object.keys(qualAnalysis).length > 0 && (
                                    <Box mb={8}>
                                        <SectionHeader label="Qualitative" count={Object.keys(qualAnalysis).length} />
                                        <Box mb={3}>
                                            <Button
                                                size="xs"
                                                variant="subtle"
                                                color="var(--ink-tertiary)"
                                                onClick={() => {
                                                    setActiveTab("qualitative");
                                                    requestAnimationFrame(() => sectionRefs.current["qualitative"]?.scrollIntoView({ behavior: "smooth", block: "start" }));
                                                }}
                                                px={1}
                                                _hover={{ color: "var(--ink-primary)" }}
                                            >
                                                View all parameters →
                                            </Button>
                                        </Box>
                                        <SubHeader label="Asset" count={assetQual.length} />
                                        <QualTable entries={assetQual} />
                                        {macroQual.length > 0 && (
                                            <Box mt={6}>
                                                <SubHeader label="Macro" count={macroQual.length} />
                                                <QualTable entries={macroQual} />
                                            </Box>
                                        )}
                                    </Box>
                                )}

                                {/* Sources preview */}
                                {(docs.length > 0 || webSrc.length > 0) && (
                                    <Box>
                                        <SectionHeader label="Sources" count={docs.length + webSrc.length} />
                                        <SourcesStrip docs={docs} webSrc={webSrc} analysis={analysis} />
                                    </Box>
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Quantitative ── */}
                        <Tabs.Content value="quantitative">
                            <Box
                                ref={(el) => registerSection("quantitative", el)}
                                data-section="quantitative"
                            >
                                <SectionHeader label="Quantitative" count={quantEntries.length} />
                                {quantEntries.length > 0 ? (
                                    <>
                                        <SubHeader label="Asset" count={assetQuant.length} />
                                        <QuantTable
                                            entries={assetQuant}
                                            sortByScore={sortByScore}
                                            setSortByScore={setSortByScore}
                                            formatValue={formatValue}
                                        />
                                        <Box mt={6}>
                                            <SubHeader label="Macro" count={macroQuant.length} />
                                            {macroQuant.length > 0 ? (
                                                <QuantTable
                                                    entries={macroQuant}
                                                    sortByScore={sortByScore}
                                                    setSortByScore={setSortByScore}
                                                    formatValue={formatValue}
                                                />
                                            ) : (
                                                <Text fontSize="12px" color="var(--ink-tertiary)" py={3}>
                                                    No macro quantitative criteria were configured for this agent.
                                                </Text>
                                            )}
                                        </Box>
                                    </>
                                ) : (
                                    <EmptyState message="No quantitative data available." />
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Qualitative ── */}
                        <Tabs.Content value="qualitative">
                            <Box
                                ref={(el) => registerSection("qualitative", el)}
                                data-section="qualitative"
                            >
                                <SectionHeader label="Qualitative" count={Object.keys(qualAnalysis).length} />
                                {Object.keys(qualAnalysis).length > 0 ? (
                                    <>
                                        <SubHeader label="Asset" count={assetQual.length} />
                                        {assetQual.length > 0 ? (
                                            <QualFullCards
                                                qualAnalysis={Object.fromEntries(assetQual)}
                                                toolCalls={toolCalls}
                                                expandedTools={expandedTools}
                                                toggleToolCalls={toggleToolCalls}
                                            />
                                        ) : (
                                            <Text fontSize="12px" color="var(--ink-tertiary)" py={3}>
                                                No asset-level qualitative findings for this run.
                                            </Text>
                                        )}
                                        <Box mt={6}>
                                            <SubHeader label="Macro" count={macroQual.length} />
                                            {macroQual.length > 0 ? (
                                                <QualFullCards
                                                    qualAnalysis={Object.fromEntries(macroQual)}
                                                    toolCalls={toolCalls}
                                                    expandedTools={expandedTools}
                                                    toggleToolCalls={toggleToolCalls}
                                                />
                                            ) : (
                                                <Text fontSize="12px" color="var(--ink-tertiary)" py={3}>
                                                    No macro qualitative findings for this run.
                                                </Text>
                                            )}
                                        </Box>
                                    </>
                                ) : (
                                    <EmptyState message="No qualitative findings available." />
                                )}
                            </Box>
                        </Tabs.Content>


                    </Tabs.Root>
                    </Box>
                )}
                </AnimatePresence>
            </Container>
        </Box>
    );
}

/* ─── Sub-components ─── */

function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
        <Flex
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: dur.base, ease }}
            align="center"
            gap={2}
            mb={4}
        >
            <Text
                fontSize="13px"
                fontWeight={600}
                color="var(--ink-primary)"
                letterSpacing="0.08em"
                textTransform="uppercase"
            >
                {label}
            </Text>
            <Text
                fontSize="11.5px"
                fontFamily="var(--font-mono)"
                color="var(--ink-tertiary)"
            >
                {count}
            </Text>
            <Box flex={1} h="1px" bg="var(--hairline)" ml={2} />
        </Flex>
    );
}

function SubHeader({ label, count }: { label: string; count: number }) {
    return (
        <Flex align="center" gap={2} mb={2}>
            <Text
                fontSize="11.5px"
                fontWeight={600}
                color="var(--ink-secondary)"
                letterSpacing="0.06em"
                textTransform="uppercase"
            >
                {label}
            </Text>
            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                {count}
            </Text>
        </Flex>
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

    return (
        <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden">
            <Box overflowX="auto">
                <Table.Root size="sm" variant="line" minWidth="700px">
                    <Table.Header>
                        <Table.Row bg="var(--surface-recessed)">
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                            >
                                Metric
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                            >
                                Criterion
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                                textAlign="right"
                            >
                                Actual
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                                textAlign="right"
                            >
                                Wgt
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                py={3}
                                px={4}
                                textAlign="right"
                            >
                                <Button
                                    size="xs"
                                    variant="subtle"
                                    color="var(--ink-tertiary)"
                                    onClick={toggleSort}
                                    px={1}
                                    h="auto"
                                    fontSize="11px"
                                    fontWeight={500}
                                    letterSpacing="0.06em"
                                    textTransform="uppercase"
                                    _hover={{ color: "var(--ink-primary)" }}
                                >
                                    Score {sortByScore === "asc" ? "↑" : sortByScore === "desc" ? "↓" : ""}
                                </Button>
                            </Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {entries.map((m) => {
                            const isNA = !!m.price_unavailable;
                            const metricScore = (m._score ?? 0) * 100;
                            const sig = isNA ? null : scoreSignal(metricScore);
                            const borderColor = sig ? signalColor(sig) : "var(--hairline)";
                            return (
                                <Table.Row
                                    key={m.key}
                                    borderLeft={`3px solid ${borderColor}`}
                                    _hover={{ bg: "var(--surface-recessed)" }}
                                    transition="background 160ms"
                                >
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontWeight={500}
                                        color="var(--ink-primary)"
                                        px={4}
                                        py={3}
                                    >
                                        {m.metric_name || m.key}
                                        <Text
                                            as="span"
                                            fontSize="11px"
                                            fontFamily="var(--font-mono)"
                                            color="var(--ink-tertiary)"
                                            ml={2}
                                        >
                                            {m.key}
                                        </Text>
                                    </Table.Cell>
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-secondary)"
                                        px={4}
                                        py={3}
                                    >
                                        {OP_SYMBOL[m.operator] || m.operator} {fmt(m.threshold, m.metric_type)}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontFamily="var(--font-mono)"
                                        fontVariantNumeric="tabular-nums"
                                        fontWeight={500}
                                        color={isNA ? "var(--ink-tertiary)" : "var(--ink-primary)"}
                                        textAlign="right"
                                        px={4}
                                        py={3}
                                    >
                                        {isNA ? "N/A" : fmt(m.value, m.metric_type)}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontFamily="var(--font-mono)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-secondary)"
                                        textAlign="right"
                                        px={4}
                                        py={3}
                                    >
                                        {m.weightage ?? "—"}
                                    </Table.Cell>
                                    <Table.Cell
                                        textAlign="right"
                                        px={4}
                                        py={3}
                                    >
                                        {isNA ? (
                                            <Text
                                                fontSize="13.5px"
                                                color="var(--ink-tertiary)"
                                            >
                                                N/A
                                            </Text>
                                        ) : (
                                            <Text
                                                fontSize="13.5px"
                                                fontFamily="var(--font-tabular)"
                                                fontVariantNumeric="tabular-nums"
                                                fontWeight={500}
                                                color={signalColor(sig)}
                                            >
                                                {metricScore.toFixed(1)}
                                            </Text>
                                        )}
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })}
                    </Table.Body>
                </Table.Root>
            </Box>
        </Box>
    );
}

function QualTable({ entries }: { entries: [string, any][] }) {
    return (
        <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden">
            <Box overflowX="auto">
                <Table.Root size="sm" variant="line" minWidth="600px">
                    <Table.Header>
                        <Table.Row bg="var(--surface-recessed)">
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                            >
                                Parameter
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                                textAlign="right"
                            >
                                Wgt
                            </Table.ColumnHeader>
                            <Table.ColumnHeader
                                fontSize="11px"
                                fontWeight={500}
                                letterSpacing="0.06em"
                                textTransform="uppercase"
                                color="var(--ink-tertiary)"
                                py={3}
                                px={4}
                                textAlign="right"
                            >
                                Score
                            </Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {entries.map(([paramName, d]) => {
                            const score = typeof d?.score === "number" ? d.score : 0;
                            const sig = scoreSignal(score);
                            return (
                                <Table.Row
                                    key={paramName}
                                    borderLeft={`3px solid ${signalColor(sig)}`}
                                    _hover={{ bg: "var(--surface-recessed)" }}
                                    transition="background 160ms"
                                >
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontWeight={500}
                                        color="var(--ink-primary)"
                                        px={4}
                                        py={3}
                                    >
                                        {paramName}
                                        {d?.error && (
                                            <Text
                                                as="span"
                                                fontSize="11px"
                                                fontFamily="var(--font-mono)"
                                                color="var(--signal-negative)"
                                                ml={2}
                                                maxW="220px"
                                                overflow="hidden"
                                                textOverflow="ellipsis"
                                                whiteSpace="nowrap"
                                                display="inline-block"
                                                verticalAlign="middle"
                                                title={String(d.error)}
                                            >
                                                error: {String(d.error)}
                                            </Text>
                                        )}
                                    </Table.Cell>
                                    <Table.Cell
                                        fontSize="13.5px"
                                        fontFamily="var(--font-mono)"
                                        fontVariantNumeric="tabular-nums"
                                        color="var(--ink-secondary)"
                                        textAlign="right"
                                        px={4}
                                        py={3}
                                    >
                                        {d?.weightage ?? "—"}
                                    </Table.Cell>
                                    <Table.Cell textAlign="right" px={4} py={3}>
                                        {d?.error ? (
                                            <Text
                                                fontSize="13.5px"
                                                color="var(--signal-negative)"
                                            >
                                                —
                                            </Text>
                                        ) : (
                                            <Text
                                                fontSize="13.5px"
                                                fontFamily="var(--font-tabular)"
                                                fontVariantNumeric="tabular-nums"
                                                fontWeight={500}
                                                color={signalColor(sig)}
                                            >
                                                {score.toFixed(1)}
                                            </Text>
                                        )}
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })}
                    </Table.Body>
                </Table.Root>
            </Box>
        </Box>
    );
}

function QualFullCards({
    qualAnalysis,
    toolCalls,
    expandedTools,
    toggleToolCalls,
}: {
    qualAnalysis: Record<string, any>;
    toolCalls: Record<string, any[]>;
    expandedTools: Record<string, boolean>;
    toggleToolCalls: (param: string) => void;
}) {
    return (
        <VStack gap={0} align="stretch">
            {Object.entries(qualAnalysis).map(([paramName, paramData]: [string, any]) => (
                <QualCard
                    key={paramName}
                    paramName={paramName}
                    paramData={paramData}
                    toolCalls={toolCalls}
                    expandedTools={expandedTools}
                    toggleToolCalls={toggleToolCalls}
                    compact={false}
                />
            ))}
        </VStack>
    );
}

function QualCard({
    paramName,
    paramData,
    toolCalls,
    expandedTools,
    toggleToolCalls,
    compact,
}: {
    paramName: string;
    paramData: any;
    toolCalls: Record<string, any[]>;
    expandedTools: Record<string, boolean>;
    toggleToolCalls: (param: string) => void;
    compact: boolean;
}) {
    const paramScore = paramData.score ?? 0;
    const sig = scoreSignal(paramScore);
    const borderColor = signalColor(sig);

    return (
        <Box
            borderLeft={`3px solid ${borderColor}`}
            borderBottom="1px solid var(--hairline)"
            py={4}
            px={4}
        >
            <Flex justify="space-between" align="flex-start" gap={4}>
                <Box flex={1} minW={0}>
                    <Flex align="center" gap={2} mb={compact ? 1 : 2}>
                        <Text
                            fontSize="13.5px"
                            fontWeight={500}
                            color="var(--ink-primary)"
                        >
                            {paramName}
                        </Text>
                        <Text
                            fontSize="11px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                        >
                            wgt {paramData.weightage ?? "—"}
                        </Text>
                    </Flex>

                    {paramData.error && (
                        <Box
                            borderLeft="2px solid var(--signal-negative)"
                            bg="color-mix(in srgb, var(--signal-negative) 8%, transparent)"
                            px={3}
                            py={2}
                            mb={2}
                            borderRadius="2px"
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--signal-negative)"
                            wordBreak="break-word"
                        >
                            {String(paramData.error)}
                        </Box>
                    )}

                    {!compact && (
                        <Box
                            fontSize="13.5px"
                            color="var(--ink-secondary)"
                            lineHeight="relaxed"
                            css={{
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
                            }}
                        >
                            <ReactMarkdown>{paramData.analysis || "_No analysis available_"}</ReactMarkdown>
                        </Box>
                    )}
                </Box>

                <Text
                    fontSize="13.5px"
                    fontFamily="var(--font-tabular)"
                    fontVariantNumeric="tabular-nums"
                    fontWeight={500}
                    color={paramData.error ? "var(--signal-negative)" : signalColor(sig)}
                    whiteSpace="nowrap"
                    pt={compact ? 0 : 2}
                >
                    {paramData.error ? "—" : paramScore.toFixed(1)}
                </Text>
            </Flex>

            {/* Tool calls disclosure */}
            {toolCalls[paramName]?.length > 0 && (
                <Box mt={2}>
                    <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => toggleToolCalls(paramName)}
                        color="var(--ink-tertiary)"
                        _hover={{ color: "var(--ink-primary)" }}
                        gap={1}
                        px={1}
                        fontSize="12px"
                    >
                        {expandedTools[paramName] ? <MdExpandLess size={14} /> : <MdExpandMore size={14} />}
                        {expandedTools[paramName] ? "Hide" : "Show"} tool calls ({toolCalls[paramName].length})
                    </Button>
                    <AnimatePresence initial={false}>
                        {expandedTools[paramName] && (
                            <Box as={motion.div} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: dur.base, ease }} overflow="hidden">
                                <VStack gap={0} mt={2} align="stretch">
                                    {toolCalls[paramName].map((call: any, i: number) => (
                                        <Box
                                            key={i}
                                            py={2}
                                            px={3}
                                            borderBottom="1px solid var(--hairline)"
                                            fontSize="12px"
                                        >
                                    <HStack gap={3} mb={call.args || call.result ? 1 : 0}>
                                        <Text
                                            fontFamily="var(--font-mono)"
                                            color="var(--accent-primary)"
                                            fontSize="12px"
                                        >
                                            {call.tool_name || "tool"}
                                        </Text>
                                        {call.status && (
                                            <Text
                                                fontFamily="var(--font-mono)"
                                                color={call.status === "OK" ? "var(--signal-positive)" : "var(--signal-negative)"}
                                                fontSize="12px"
                                            >
                                                {call.status === "OK" ? "✓" : "✗"} {call.status}
                                            </Text>
                                        )}
                                        {typeof call.duration === "number" && (
                                            <Text fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                                {call.duration.toFixed(2)}s
                                            </Text>
                                        )}
                                        {call.error && (
                                            <Text fontFamily="var(--font-mono)" color="var(--signal-negative)">
                                                {call.error}
                                            </Text>
                                        )}
                                    </HStack>
                                    {call.args != null && Object.keys(call.args).length > 0 && (
                                        <Text
                                            fontFamily="var(--font-mono)"
                                            color="var(--ink-tertiary)"
                                            fontSize="11px"
                                            mb={1}
                                            wordBreak="break-all"
                                        >
                                            {formatToolOutput(call.args)}
                                        </Text>
                                    )}
                                    {call.result != null && (
                                        <Box
                                            as="pre"
                                            maxH="100px"
                                            overflow="auto"
                                            bg="var(--surface-recessed)"
                                            p={2}
                                            borderRadius="2px"
                                            fontSize="11px"
                                            lineHeight="short"
                                            fontFamily="var(--font-mono)"
                                            color="var(--ink-tertiary)"
                                            mt={1}
                                            css={{
                                                "&::-webkit-scrollbar": { height: "3px", width: "3px" },
                                            }}
                                        >
                                            {formatToolOutput(call.result)}
                                        </Box>
                                    )}
                                </Box>
                                    ))}
                                </VStack>
                            </Box>
                        )}
                    </AnimatePresence>
                </Box>
            )}
        </Box>
    );
}

function SourcesStrip({
    docs,
    webSrc,
    analysis,
}: {
    docs: any[];
    webSrc: string[];
    analysis: any;
}) {
    return (
        <Flex gap={4} align="center" wrap="wrap" fontSize="12px" color="var(--ink-secondary)">
            {docs.length > 0 && (
                <Text>
                    <span style={{ fontWeight: 500 }}>{docs.length}</span> document{docs.length > 1 ? "s" : ""}
                </Text>
            )}
            {webSrc.length > 0 && (
                <Text>
                    <span style={{ fontWeight: 500 }}>{webSrc.length}</span> web source{webSrc.length > 1 ? "s" : ""}
                </Text>
            )}
            {(analysis.web_search_effective === "user" || analysis.web_search) && (
                <Text color="var(--ink-tertiary)">Web search enabled</Text>
            )}
            {analysis.web_search_effective === "auto" && (
                <Text color="var(--ink-tertiary)">
                    Web search auto-enabled (internal data {analysis.data_adequacy || "sparse"})
                </Text>
            )}
        </Flex>
    );
}

function SourcesDetail({
    docs,
    webSrc,
    analysis,
}: {
    docs: any[];
    webSrc: string[];
    analysis: any;
}) {
    return (
        <VStack gap={0} align="stretch">
            {docs.length > 0 && (
                <Box borderBottom="1px solid var(--hairline)" py={3}>
                    <Text
                        fontSize="10.5px"
                        fontWeight={500}
                        color="var(--ink-tertiary)"
                        letterSpacing="0.06em"
                        textTransform="uppercase"
                        mb={2}
                    >
                        Documents
                    </Text>
                    <VStack gap={1} align="stretch">
                        {docs.map((doc: any, i: number) => (
                            <Text key={i} fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                {typeof doc === "string" ? doc : doc.name || doc.title || JSON.stringify(doc)}
                            </Text>
                        ))}
                    </VStack>
                </Box>
            )}
            {webSrc.length > 0 && (
                <Box borderBottom="1px solid var(--hairline)" py={3}>
                    <Text
                        fontSize="10.5px"
                        fontWeight={500}
                        color="var(--ink-tertiary)"
                        letterSpacing="0.06em"
                        textTransform="uppercase"
                        mb={2}
                    >
                        Web Sources
                    </Text>
                    <VStack gap={1} align="stretch">
                        {webSrc.map((src: string) => (
                            <Text key={src} fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                {src}
                            </Text>
                        ))}
                    </VStack>
                </Box>
            )}
            <Box py={3}>
                <Text
                    fontSize="10.5px"
                    fontWeight={500}
                    color="var(--ink-tertiary)"
                    letterSpacing="0.06em"
                    textTransform="uppercase"
                    mb={2}
                >
                    Run Details
                </Text>
                <VStack gap={1} align="stretch" fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                    {analysis.model && <Text>Model: {analysis.model}</Text>}
                    {analysis.source && <Text>Source: {analysis.source}</Text>}
                    {analysis.agent_name && <Text>Agent: {agentName(analysis.agent_name)}</Text>}
                    {analysis.duration != null && <Text>Duration: {formatDuration(analysis.duration)}</Text>}
                    {analysis.end_time && <Text>Ended: {new Date(analysis.end_time * 1000).toLocaleString()}</Text>}
                    {analysis.created_at && <Text>Created: {new Date(analysis.created_at).toLocaleString()}</Text>}
                </VStack>
            </Box>
        </VStack>
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

function DataStatus({
    dataAvailability,
    priceData,
}: {
    dataAvailability: any;
    priceData: string | null;
}) {
    if (!dataAvailability || Object.keys(dataAvailability).length === 0) {
        return <EmptyState message="No data availability recorded for this run." />;
    }

    if (dataAvailability.error) {
        return (
            <Box
                borderLeft="3px solid var(--signal-caution)"
                pl={4}
                py={2}
                fontSize="12.5px"
                color="var(--ink-secondary)"
            >
                {dataAvailability.error}
            </Box>
        );
    }

    const collections = dataAvailability.collections || {};
    const collEntries = Object.entries(collections);
    const totalRecords = collEntries.reduce(
        (n: number, [, c]: [string, any]) => n + (c?.records ?? 0),
        0,
    );
    const pulled = dataAvailability.available === true;
    const partial =
        !pulled && totalRecords > 0;
    const never = totalRecords === 0;

    const priceLabel =
        priceData === "live"
            ? "Live"
            : priceData === "unavailable"
              ? "Unavailable"
              : priceData === "unknown"
                ? "Unknown"
                : "Not recorded";

    return (
        <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden">
            <Flex
                justify="space-between"
                align="center"
                gap={4}
                wrap="wrap"
                p={4}
                borderBottom="1px solid var(--hairline)"
                bg="var(--surface-recessed)"
            >
                <HStack gap={3}>
                    <Text
                        fontSize="13px"
                        fontWeight={600}
                        color="var(--ink-primary)"
                        fontFamily="var(--font-mono)"
                    >
                        {dataAvailability.symbol || "symbol"}
                    </Text>
                    <Text
                        fontSize="11px"
                        fontWeight={500}
                        letterSpacing="0.06em"
                        textTransform="uppercase"
                        color={
                            pulled
                                ? "var(--signal-positive)"
                                : partial
                                  ? "var(--signal-caution)"
                                  : "var(--ink-tertiary)"
                        }
                    >
                        {pulled ? "Available" : partial ? "Partial" : never ? "Never pulled" : "Unknown"}
                    </Text>
                </HStack>
                <Text
                    fontSize="12px"
                    color="var(--ink-tertiary)"
                    fontFamily="var(--font-mono)"
                >
                    Price data: {priceLabel}
                </Text>
            </Flex>

            <VStack gap={0} align="stretch">
                {collEntries.length > 0 && (
                    <Flex gap={2} wrap="wrap" p={4} borderBottom="1px solid var(--hairline)">
                        {collEntries.map(([name, c]: [string, any]) => (
                            <Box
                                key={name}
                                fontSize="11px"
                                fontFamily="var(--font-mono)"
                                color={
                                    (c?.records ?? 0) > 0
                                        ? "var(--ink-secondary)"
                                        : "var(--ink-tertiary)"
                                }
                                px={2}
                                py={0.5}
                                bg="var(--surface-recessed)"
                                borderRadius="2px"
                            >
                                {name}: {c?.records ?? 0}
                                {c?.last_pulled ? (
                                    <Text
                                        as="span"
                                        ml={1.5}
                                        color="var(--ink-tertiary)"
                                    >
                                        · {new Date(c.last_pulled).toLocaleDateString()}
                                    </Text>
                                ) : null}
                            </Box>
                        ))}
                    </Flex>
                )}
                <Flex
                    justify="space-between"
                    align="center"
                    gap={4}
                    wrap="wrap"
                    p={4}
                    fontSize="12px"
                >
                    <Text color="var(--ink-secondary)">
                        {totalRecords > 0
                            ? `${totalRecords} record${totalRecords > 1 ? "s" : ""} across ${collEntries.length} collection${collEntries.length > 1 ? "s" : ""}`
                            : "No data has been pulled for this instrument yet."}
                    </Text>
                    <Text color="var(--ink-tertiary)" fontFamily="var(--font-mono)">
                        {dataAvailability.last_pulled
                            ? `Last pulled ${new Date(dataAvailability.last_pulled).toLocaleString()}`
                            : "Never pulled"}
                    </Text>
                </Flex>
            </VStack>
        </Box>
    );
}
