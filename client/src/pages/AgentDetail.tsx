import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Box, Container, Flex, HStack, Text, Tabs } from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { MdArrowBack, MdInfo } from "react-icons/md";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { DEFAULT_AGENTS, type DefaultAgent } from "@/lib/defaultAgents";
import { dur, ease } from "@/lib/motion";

/** Relativity default agent — same shell as the analysis result page
 *  (sticky bar → identity → hero verdict → report/reasoning tabs), but the
 *  content is this agent's static profile instead of a fetched run. */

const TABS = ["report", "reasoning"] as const;
type Tab = (typeof TABS)[number];

const TONE: Record<DefaultAgent["tone"], string> = {
    positive: "var(--signal-positive)",
    caution: "var(--signal-caution)",
    negative: "var(--signal-negative)",
};

function traceOf(agent: DefaultAgent): string[] {
    return [
        `Loaded market context — ${agent.name}`,
        "Pulled constituents, price and volume history",
        "Scored signals against the configured thesis",
        `Drafted verdict — ${agent.headline}`,
    ];
}

export default function AgentDetail() {
    const { id } = useParams();
    const reducedMotion = useReducedMotion();
    const [activeTab, setActiveTab] = useState<Tab>("report");

    const agent = DEFAULT_AGENTS.find((a) => a.id === id);
    if (!agent) return <Navigate to="/" replace />;

    const color = TONE[agent.tone];
    const trace = traceOf(agent);
    const scope = agent.group === "sector" ? "the sector index and its constituents" : "index breadth, valuation and investor positioning";

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Container maxW="full" px={0} py={6}>
                {/* Sticky identity + utility bar */}
                <Box
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
                        <Link
                            to="/"
                            aria-label="Back to home"
                            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[13px] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                        >
                            <MdArrowBack aria-hidden="true" />
                            <span className="hidden sm:inline">Home</span>
                        </Link>
                        <HStack gap={3} align="center">
                            <HStack gap={1.5} align="center" px={2.5} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)" aria-live="polite">
                                <motion.span
                                    animate={reducedMotion ? {} : { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
                                    transition={{ repeat: Infinity, duration: 1.4 }}
                                    style={{
                                        width: 7,
                                        height: 7,
                                        borderRadius: "50%",
                                        background: "var(--signal-positive)",
                                        display: "inline-block",
                                    }}
                                />
                                <Text fontSize="12px" color="var(--ink-secondary)">Active</Text>
                            </HStack>
                        </HStack>
                    </Flex>
                </Box>

                {/* Identity sub-header */}
                <Box mb={5}>
                    <Flex align="center" gap={2.5} minW={0}>
                        <AgentAvatar agent={agent.seed} size={22} />
                        <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)" lineHeight="short" truncate>
                            {agent.name}
                        </Text>
                        <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" flexShrink={0}>
                            {agent.id}
                        </Text>
                        <Box w="1px" h="14px" bg="var(--hairline)" flexShrink={0} />
                        <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" letterSpacing="0.06em">
                            DEFAULT
                        </Text>
                    </Flex>
                </Box>

                {/* Hero verdict */}
                <Box mb={6} as={motion.div} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                    <Text fontSize="12px" color="var(--ink-tertiary)" mb={3} letterSpacing="0.03em">
                        Verdict as of {agent.when}
                    </Text>
                    <Text fontSize={{ base: "52px", md: "88px" }} fontWeight={400} lineHeight="0.95" fontFamily="var(--font-display)" color={color} mb={4}>
                        {agent.headline}
                    </Text>
                    <Flex align="flex-start" gap={3} mb={4}>
                        <AgentAvatar agent={agent.seed} size={56} />
                        <Box minW={0}>
                            <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" lineHeight="1.35">
                                {agent.name}
                            </Text>
                            <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mt={1} overflowWrap="anywhere">
                                relativity · default · {agent.group === "sector" ? "sectoral" : "market"}
                            </Text>
                        </Box>
                    </Flex>
                    <Text fontSize="15px" color="var(--ink-secondary)" lineHeight="1.6" maxW="74ch" mb={2}>
                        {agent.summary}
                    </Text>
                    <Text display="flex" alignItems="flex-start" gap={1.5} fontSize="11.5px" color="var(--ink-tertiary)" lineHeight="1.5" maxW="74ch" mb={4}>
                        <MdInfo size={13} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                        <span>
                            The verdict is not investment advice — it reflects this agent's configured thesis and the data available at {agent.when}.
                        </span>
                    </Text>
                    <HStack gap={2} flexWrap="wrap">
                        <Box px={3} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)">
                            <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                rubric coverage · full
                            </Text>
                        </Box>
                    </HStack>
                </Box>

                {/* Report / reasoning tabs */}
                <Box id="tab-panels" css={{ scrollMarginTop: "64px" }}>
                    <Tabs.Root
                        value={activeTab}
                        onValueChange={(details: { value: string }) => setActiveTab(details.value as Tab)}
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
                                    _selected={{ color: "var(--ink-primary)", fontWeight: 600 }}
                                    transition="none"
                                >
                                    {tab}
                                    {activeTab === tab && (
                                        <Box as={motion.div} layoutId="agent-tab-underline" position="absolute" bottom={0} left={0} right={0} h="2px" bg="var(--accent-primary)" />
                                    )}
                                </Tabs.Trigger>
                            ))}
                        </Tabs.List>

                        <Tabs.Content value="report">
                            <Box>
                                <Flex align="center" gap={2} mb={4}>
                                    <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" letterSpacing="0.04em">
                                        Report
                                    </Text>
                                    <Box flex={1} h="1px" bg="var(--hairline)" ml={2} />
                                </Flex>
                                <Box maxW="74ch">
                                    <Text fontSize="15px" color="var(--ink-secondary)" lineHeight="1.6" mb={4}>
                                        {agent.summary} The agent reviews {scope} against its thesis and publishes a single headline verdict.
                                    </Text>
                                    <Text fontSize="13px" color="var(--ink-secondary)" lineHeight="1.7">
                                        Method: deterministic scoring over official market data — every criterion maps to a rubric entry, and unscored criteria are excluded rather than failed. This default profile runs on the published schedule shown on its card.
                                    </Text>
                                </Box>
                            </Box>
                        </Tabs.Content>

                        <Tabs.Content value="reasoning">
                            <Box>
                                <Flex align="center" gap={2} mb={4}>
                                    <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" letterSpacing="0.04em">
                                        Agent Reasoning
                                    </Text>
                                    <Box as="span" fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" px={2} py={0.5} borderRadius="full" bg="var(--surface-recessed)">
                                        {trace.length}
                                    </Box>
                                    <Box flex={1} h="1px" bg="var(--hairline)" ml={2} />
                                </Flex>
                                <Box border="1px solid var(--hairline)" borderRadius="6px" bg="var(--surface-panel)" p={4}>
                                    {trace.map((line, i) => (
                                        <Flex key={i} gap={3} py={1.5} align="baseline">
                                            <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" flexShrink={0}>
                                                {String(i + 1).padStart(2, "0")}
                                            </Text>
                                            <Text fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" overflowWrap="anywhere">
                                                {line}
                                            </Text>
                                        </Flex>
                                    ))}
                                </Box>
                            </Box>
                        </Tabs.Content>
                    </Tabs.Root>
                </Box>
            </Container>
        </Box>
    );
}
