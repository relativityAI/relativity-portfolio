import { useEffect, useMemo, useState } from "react";
import {
    Box, Button, Flex, Spinner, Text, Input, HStack, SimpleGrid,
} from "@/compat/ui";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { AgentService } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { dur, ease, stagger, staggerItem } from "@/lib/motion";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toaster } from "@/compat/ui";
import { SiAgentskills } from "react-icons/si";
import { LuLayers, LuSearch, LuPlus, LuScrollText } from "react-icons/lu";

/**
 * Agent Console — the portfolio. Each agent renders as a card in a grid:
 * avatar, philosophy (first sentence), strategy chips, skill tags with
 * weights, and last-run health when the analyses API has something honest
 * to report.
 */

interface Agent {
    _id: string;
    id?: string;
    name: string;
    created_at: string;
    source?: string;
    persona?: { philosophy?: string; philosophy_and_mindset?: string };
    configuration?: { investment_horizon?: string; risk_appetite?: number };
    skills?: { skill_id: string; weight: number }[];
}

interface AnalysisLite {
    agent?: string;
    agent_name?: string;
    status?: string;
    total_score?: number;
    created_at?: string;
    updated_at?: string;
}

const HORIZON_SHORT: Record<string, string> = {
    "Long-term (years)": "Long-term",
    "Positional (weeks to months)": "Positional",
    "Long-term (3-5 years)": "Long-term",
};

/** First sentence of the philosophy — the agent's thesis. */
function creedOf(agent: Agent): string {
    const phil =
        agent.persona?.philosophy ||
        agent.persona?.philosophy_and_mindset ||
        "";
    const first = phil.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
    return first ? (first.length > 140 ? first.slice(0, 137) + "…" : first) : "";
}

function timeAgo(dateStr?: string): string {
    if (!dateStr) return "";
    const s = Math.max(0, (Date.now() - +new Date(dateStr)) / 1000);
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

/** Last finished run for an agent, by name match on the analyses list. */
function lastRunOf(agent: Agent, analyses: AnalysisLite[]) {
    const name = agent.name;
    if (!name) return null;
    const mine = analyses.filter(
        (a) => (a.agent_name || a.agent) === name &&
        !["running", "pending", "queued"].includes((a.status || "").toLowerCase()),
    );
    if (!mine.length) return null;
    const latest = mine.reduce((a, b) =>
        +new Date(b.updated_at || b.created_at || 0) > +new Date(a.updated_at || a.created_at || 0) ? b : a,
    );
    const failed = ["failed", "error", "canceled"].includes((latest.status || "").toLowerCase());
    return {
        score: failed ? null : latest.total_score != null ? Number(latest.total_score).toFixed(1) : null,
        failed,
        at: latest.updated_at || latest.created_at,
    };
}

/* ── Strategy chip — small-caps label + tabular value ─────────────────── */
function StrategyChip({ label, value }: { label: string; value: string }) {
    return (
        <Flex
            align="baseline"
            gap={1.5}
            px={2.5}
            py={1}
            border="var(--hairline-w) solid var(--hairline)"
            borderRadius="var(--radius-surface)"
            bg="var(--console-panel)"
            minW={0}
            maxW="100%"
        >
            <Text fontSize="9.5px" letterSpacing="0.09em" textTransform="uppercase" color="var(--ink-tertiary)" whiteSpace="nowrap">
                {label}
            </Text>
            <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-primary)" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                {value}
            </Text>
        </Flex>
    );
}

/** Weight dots — filled proportional to weight (1–10). */
function WeightDots({ weight }: { weight: number }) {
    return (
        <Flex gap="2px" flexShrink={0}>
            {Array.from({ length: 10 }).map((_, i) => (
                <Box
                    key={i}
                    w="3px" h="8px"
                    borderRadius="1px"
                    bg={i < weight ? "var(--skill-accent)" : "var(--hairline)"}
                />
            ))}
        </Flex>
    );
}

/** Skill tag — accent-tinted name + weight dots. */
function SkillTag({ name, weight }: { name: string; weight: number }) {
    return (
        <Flex
            align="center"
            gap={1.5}
            px={2}
            py={1}
            borderRadius="var(--radius-box)"
            bg="color-mix(in srgb, var(--skill-accent) 8%, var(--console-panel))"
            border="var(--hairline-w) solid color-mix(in srgb, var(--skill-accent) 22%, transparent)"
            title={`${name} — weight ${weight}/10`}
        >
            <Text fontSize="11.5px" color="var(--ink-secondary)" whiteSpace="nowrap" maxW="160px" overflow="hidden" textOverflow="ellipsis">
                {name}
            </Text>
            <WeightDots weight={weight} />
        </Flex>
    );
}

const ARCHETYPES = [
    {
        key: "value",
        name: "Value hunter",
        line: "Margin of safety above story. Buys what the market misprices and waits.",
        config: { investment_horizon: "Long-term (years)", risk_appetite: 4 },
        philosophy: "I believe the market frequently misprices patience. I hunt for businesses trading below their intrinsic worth, demand a margin of safety before committing capital, and let compounding do the work. I would rather be approximately right about the long term than precisely right about the quarter.",
    },
    {
        key: "momentum",
        name: "Momentum rider",
        line: "The trend is a fact. Rides strength, cuts weakness fast.",
        config: { investment_horizon: "Swing", risk_appetite: 7 },
        philosophy: "I believe price action encodes information the crowd hasn't articulated yet. I ride strength, respect stops without sentiment, and exit weakness fast. My edge is discipline: the trend is my thesis until it breaks.",
    },
    {
        key: "quality",
        name: "Quality compounder",
        line: "Great businesses, held long. Price matters, quality matters more.",
        config: { investment_horizon: "Positional", risk_appetite: 3 },
        philosophy: "I believe a few exceptional businesses, held with conviction, outperform constant tinkering. I look for durable moats, honest management, and reinvestment opportunities, and I pay a fair price for quality rather than a cheap price for compromise.",
    },
];

export default function Console() {
    const navigate = useNavigate();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [analyses, setAnalyses] = useState<AnalysisLite[]>([]);
    const [skillNames, setSkillNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            AgentService.listAgents(),
            // Last-run health is display-only; a failure here must never break the roster.
            import("@/db").then(({ AnalysisService }) => AnalysisService.listAnalyses()).catch(() => []),
        ])
            .then(([agentsData, analysesData]) => {
                if (cancelled) return;
                setAgents(Array.isArray(agentsData) ? agentsData : []);
                setAnalyses(Array.isArray(analysesData) ? analysesData : []);
                setFetchError(!Array.isArray(agentsData));
            })
            .catch(() => { if (!cancelled) { setAgents([]); setFetchError(true); } })
            .finally(() => { if (!cancelled) setLoading(false); });
    }, []);

    // Skill names for the tags (skill_id → display name).
    useEffect(() => {
        const ids = Array.from(new Set((agents || []).flatMap((a) => (a.skills || []).map((s) => s.skill_id))));
        if (!ids.length) { setSkillNames({}); return; }
        let cancelled = false;
        Promise.all(
            ids.map(async (id) => {
                try {
                    const full = await (await import("@/db")).SkillService.readSkill(id);
                    return [id, full?.name || id] as const;
                } catch { return [id, id] as const; }
            }),
        ).then((pairs) => { if (!cancelled) setSkillNames(Object.fromEntries(pairs)); });
        return () => { cancelled = true; };
    }, [agents]);

    const handleDelete = async (id: string | undefined) => {
        if (!id) return;
        setDeleting(true);
        try {
            await AgentService.deleteAgent(id);
            setDeleteTarget(null);
            setAgents((prev) => prev.filter((a) => (a._id || a.id) !== id));
        } catch (e: any) {
            toaster.create({
                title: "Delete failed",
                description: e?.response?.data?.error || e?.message || "The agent could not be deleted. Please try again.",
                type: "error",
            });
        } finally {
            setDeleting(false);
        }
    };

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) =>
                a.name?.toLowerCase().includes(q) ||
                creedOf(a).toLowerCase().includes(q) ||
                (a.skills || []).some((s) => (skillNames[s.skill_id] || s.skill_id).toLowerCase().includes(q)),
        );
    }, [agents, query, skillNames]);

    const libraryEntry = (
        <Button
            size="sm"
            variant="outline"
            minH="36px"
            borderColor="var(--hairline)"
            color="var(--ink-secondary)"
            _hover={{ color: "var(--skill-accent)", borderColor: "var(--skill-accent)" }}
            onClick={() => navigate("/armory")}
        >
            <LuLayers size={14} />
            <Box as="span" display={{ base: "none", sm: "inline" }}>Model Library</Box>
        </Button>
    );

    return (
        <Box className="console-world" minH="100%" position="relative">
            {/* Ambient radial light — one, slow, behind the hero */}
            <Box
                aria-hidden
                position="absolute"
                top="-120px" left="50%" transform="translateX(-50%)"
                w="640px" h="420px"
                pointerEvents="none"
                bg="radial-gradient(ellipse, color-mix(in srgb, var(--skill-accent) 9%, transparent) 0%, transparent 65%)"
            />

            <Flex direction="column" gap={7} maxW="1100px" mx="auto" px={{ base: 4, md: 6 }} py={{ base: 6, md: 9 }} position="relative">
                {/* Header — editorial, left-aligned */}
                <Flex align="flex-end" justify="space-between" gap={4} wrap="wrap">
                    <Box>
                        <Text
                            fontSize="10.5px" fontWeight={500} letterSpacing="0.14em" textTransform="uppercase"
                            color="var(--skill-accent)" mb={1.5}
                        >
                            Agent Console
                        </Text>
                        <Text fontSize={{ base: "26px", md: "30px" }} fontWeight={700} letterSpacing="-0.02em" color="var(--ink-primary)" lineHeight="1.15">
                            Agents
                        </Text>
                        <Text fontSize="13px" color="var(--ink-secondary)" mt={1.5}>
                            Every analyst you've built — their strategy, philosophy, and skills.
                        </Text>
                    </Box>
                    <HStack gap={2}>
                        {libraryEntry}
                        <Button
                            size="sm"
                            minH="36px"
                            bg="var(--skill-accent)"
                            color="#fff"
                            _hover={{ bg: "color-mix(in srgb, var(--skill-accent) 85%, #000)" }}
                            onClick={() => navigate("/agent/new")}
                        >
                            <LuPlus size={14} />
                            New agent
                        </Button>
                    </HStack>
                </Flex>

                {/* Search — only when there is something to search */}
                {!loading && agents.length > 5 && (
                    <Box position="relative" maxW="360px">
                        <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="var(--ink-tertiary)" pointerEvents="none">
                            <LuSearch size={14} />
                        </Box>
                        <Input
                            size="sm"
                            pl={9}
                            placeholder="Search agents, philosophies, skills…"
                            aria-label="Search agents"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            bg="var(--console-panel)"
                            borderColor="var(--hairline)"
                        />
                    </Box>
                )}

                {loading ? (
                    <Flex justify="center" py={16}>
                        <Spinner size="lg" color="var(--skill-accent)" />
                    </Flex>
                ) : fetchError ? (
                    <Box border="var(--hairline-w) solid var(--hairline)" borderRadius="var(--radius-surface)" bg="var(--console-panel)" px={5} py={8} textAlign="center">
                        <Text fontSize="14px" color="var(--ink-primary)" fontWeight={600}>The Agent Console could not reach the server.</Text>
                        <Text fontSize="12.5px" color="var(--ink-secondary)" mt={1}>
                            The agent API may be unavailable. Reload to try again.
                        </Text>
                    </Box>
                ) : agents.length === 0 ? (
                    /* ── Empty state: the invitation + archetype seeds ── */
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.slow, ease }}>
                        <Box
                            border="var(--hairline-w) solid var(--hairline)"
                            borderRadius="var(--radius-surface)"
                            bg="var(--console-panel)"
                            px={{ base: 5, md: 10 }}
                            py={{ base: 8, md: 12 }}
                            textAlign="center"
                            position="relative"
                            overflow="hidden"
                        >
                            <Box
                                aria-hidden position="absolute" top="-160px" left="50%" transform="translateX(-50%)"
                                w="480px" h="320px" pointerEvents="none"
                                bg="radial-gradient(ellipse, color-mix(in srgb, var(--skill-accent) 14%, transparent) 0%, transparent 65%)"
                            />
                            <Text fontSize="10.5px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={3} position="relative">
                                No agents yet
                            </Text>
                            <Text fontSize={{ base: "22px", md: "26px" }} fontWeight={700} letterSpacing="-0.02em" color="var(--ink-primary)" position="relative">
                                Every great analyst starts as a blank slate.
                            </Text>
                            <Text fontSize="13.5px" color="var(--ink-secondary)" mt={2} maxW="52ch" mx="auto" position="relative">
                                Build an agent from nothing, or start from a template — each one is fully editable the moment it exists.
                            </Text>
                            <Flex gap={3} justify="center" mt={6} position="relative" wrap="wrap">
                                <Button
                                    size="sm"
                                    bg="var(--skill-accent)"
                                    color="#fff"
                                    _hover={{ bg: "color-mix(in srgb, var(--skill-accent) 85%, #000)" }}
                                    onClick={() => navigate("/agent/new")}
                                >
                                    Create an agent
                                </Button>
                            </Flex>

                            {/* Archetype templates */}
                            <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mt={8} position="relative">
                                {ARCHETYPES.map((a, i) => (
                                    <Box
                                        key={a.key}
                                        as="button"
                                        textAlign="left"
                                        px={4}
                                        py={4}
                                        border="var(--hairline-w) solid var(--hairline)"
                                        borderRadius="var(--radius-surface)"
                                        bg="var(--surface-canvas)"
                                        cursor="pointer"
                                        transition="border-color 160ms, transform 160ms"
                                        _hover={{ borderColor: "var(--skill-accent)", transform: "translateY(-2px)" }}
                                        onClick={async () => {
                                            try {
                                                const created = await AgentService.createAgent({
                                                    name: a.name,
                                                    persona: { philosophy: a.philosophy },
                                                    configuration: a.config,
                                                    skills: [],
                                                });
                                                const newId = created.id || created._id;
                                                toaster.create({
                                                    title: `${a.name} created`,
                                                    description: "Attach skills in the Model Library to make it run.",
                                                    type: "success",
                                                });
                                                navigate("/agent/" + newId);
                                            } catch (e: any) {
                                                toaster.create({
                                                    title: "Couldn't create the agent",
                                                    description: e?.response?.data?.error || e?.message || "Please try again.",
                                                    type: "error",
                                                });
                                            }
                                        }}
                                        aria-label={`Create a ${a.name} agent`}
                                    >
                                        <Text fontSize="10px" fontFamily="var(--font-mono)" letterSpacing="0.1em" color="var(--skill-accent)">
                                            {String(i + 1).padStart(2, "0")}
                                        </Text>
                                        <Text fontSize="14.5px" fontWeight={600} color="var(--ink-primary)" mt={1.5}>
                                            {a.name}
                                        </Text>
                                        <Text fontSize="12px" color="var(--ink-secondary)" mt={1} lineHeight="1.55">
                                            {a.line}
                                        </Text>
                                    </Box>
                                ))}
                            </SimpleGrid>
                        </Box>
                    </motion.div>
                ) : (
                    /* ── The portfolio — agents as cards in a grid ── */
                    <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap={4}>
                        {filtered.length === 0 && (
                            <Text fontSize="13px" color="var(--ink-tertiary)" py={6} textAlign="center" gridColumn="1 / -1">
                                No agents match that search.
                            </Text>
                        )}
                        {filtered.map((agent) => {
                            const key = agent._id || agent.id || "";
                            const creed = creedOf(agent);
                            const run = lastRunOf(agent, analyses);
                            const skills = agent.skills || [];
                            return (
                                <motion.div key={key} variants={staggerItem}>
                                    <Flex
                                        as="a"
                                        href={`/agent/${key}`}
                                        direction="column"
                                        h="100%"
                                        gap={3}
                                        px={4}
                                        py={4}
                                        border="var(--hairline-w) solid var(--hairline)"
                                        borderRadius="var(--radius-surface)"
                                        bg="var(--console-panel)"
                                        cursor="pointer"
                                        textDecoration="none"
                                        transition="border-color 160ms, box-shadow 200ms, transform 200ms"
                                        _hover={{
                                            borderColor: "color-mix(in srgb, var(--skill-accent) 45%, var(--hairline))",
                                            boxShadow: "0 6px 24px color-mix(in srgb, var(--skill-accent) 10%, transparent)",
                                            transform: "translateY(-2px)",
                                        }}
                                        onClick={(e: any) => {
                                            e.preventDefault();
                                            navigate("/agent/" + key);
                                        }}
                                    >
                                        {/* Identity row */}
                                        <Flex align="center" gap={3} minW={0}>
                                            <AgentAvatar agent={agent} size={44} label={agent.name || "Agent"} />
                                            <Box minW={0} flex={1}>
                                                <Text
                                                    fontSize="15.5px" fontWeight={700} letterSpacing="-0.015em"
                                                    color="var(--ink-primary)" lineHeight="1.2" truncate
                                                >
                                                    {agent.name || "Untitled agent"}
                                                </Text>
                                                {creed ? (
                                                    <Text fontSize="12px" color="var(--ink-secondary)" mt={0.5} lineClamp={1} fontStyle="italic">
                                                        “{creed}”
                                                    </Text>
                                                ) : (
                                                    <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5} fontStyle="italic">
                                                        No philosophy written yet.
                                                    </Text>
                                                )}
                                            </Box>
                                            {/* Delete */}
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                color="var(--ink-tertiary)"
                                                _hover={{ color: "var(--signal-negative)", bg: "transparent" }}
                                                px={1.5}
                                                minW="28px"
                                                minH="28px"
                                                aria-label={`Delete ${agent.name || "agent"}`}
                                                flexShrink={0}
                                                onClick={(e: any) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setDeleteTarget(agent);
                                                }}
                                            >
                                                <svg
                                                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                                >
                                                    <path d="M3 6h18" />
                                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                                </svg>
                                            </Button>
                                        </Flex>

                                        {/* Strategy chips */}
                                        <Flex gap={1.5} wrap="wrap">
                                            {agent.configuration?.investment_horizon && (
                                                <StrategyChip
                                                    label="Horizon"
                                                    value={HORIZON_SHORT[agent.configuration.investment_horizon] || agent.configuration.investment_horizon}
                                                />
                                            )}
                                            {agent.configuration?.risk_appetite != null && (
                                                <StrategyChip label="Risk" value={`${agent.configuration.risk_appetite}/10`} />
                                            )}
                                        </Flex>

                                        {/* Skill tags */}
                                        {skills.length ? (
                                            <Flex gap={1.5} wrap="wrap">
                                                {skills.slice(0, 3).map((s) => (
                                                    <SkillTag
                                                        key={s.skill_id}
                                                        name={skillNames[s.skill_id] || s.skill_id}
                                                        weight={s.weight ?? 5}
                                                    />
                                                ))}
                                                {skills.length > 3 && (
                                                    <Flex
                                                        align="center" px={2} py={1}
                                                        fontSize="11.5px" fontFamily="var(--font-tabular)"
                                                        color="var(--ink-tertiary)"
                                                    >
                                                        +{skills.length - 3}
                                                    </Flex>
                                                )}
                                            </Flex>
                                        ) : (
                                            <Text fontSize="12px" color="var(--ink-tertiary)" fontStyle="italic">
                                                No skills attached yet.
                                            </Text>
                                        )}

                                        {/* Last-run health */}
                                        <Flex
                                            direction="column"
                                            align="flex-end"
                                            mt="auto"
                                            alignSelf="flex-end"
                                            pt={1}
                                        >
                                            {run ? (
                                                run.failed ? (
                                                    <>
                                                        <Text fontSize="12px" color="var(--signal-negative)" fontWeight={600}>Failed</Text>
                                                        <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mt={0.5}>
                                                            {timeAgo(run.at)}
                                                        </Text>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Text
                                                            fontSize="17px" fontWeight={700}
                                                            fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums"
                                                            color="var(--ink-primary)" lineHeight="1.1"
                                                        >
                                                            {run.score ?? "—"}
                                                        </Text>
                                                        <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mt={0.5}>
                                                            {timeAgo(run.at)}
                                                        </Text>
                                                    </>
                                                )
                                            ) : (
                                                <Text fontSize="11.5px" color="var(--ink-tertiary)" fontStyle="italic">
                                                    Never run
                                                </Text>
                                            )}
                                        </Flex>
                                    </Flex>
                                </motion.div>
                            );
                        })}
                    </SimpleGrid>
                )}

                {/* Footer note — the Model Library stays reachable */}
                {agents.length > 0 && (
                    <Flex
                        align="center"
                        justify="space-between"
                        gap={3}
                        wrap="wrap"
                        border="var(--hairline-w) solid var(--hairline)"
                        borderRadius="var(--radius-surface)"
                        bg="var(--console-panel)"
                        px={4}
                        py={3}
                    >
                        <Flex align="center" gap={2}>
                            <LuScrollText size={14} color="var(--skill-accent)" />
                            <Text fontSize="12.5px" color="var(--ink-secondary)">
                                Skills are created and attached in the <strong style={{ color: "var(--ink-primary)" }}>Model Library</strong> — the agent's toolkit.
                            </Text>
                        </Flex>
                        {libraryEntry}
                    </Flex>
                )}
            </Flex>

            <ConfirmDialog
                open={deleteTarget !== null}
                title="Delete agent?"
                confirmLabel="Delete agent"
                busy={deleting}
                message={
                    deleteTarget
                        ? `“${deleteTarget.name || "this agent"}” will be permanently removed and cannot be undone.`
                        : ""
                }
                onCancel={() => { if (!deleting) setDeleteTarget(null); }}
                onConfirm={() => handleDelete(deleteTarget?._id || deleteTarget?.id)}
            />
        </Box>
    );
}
