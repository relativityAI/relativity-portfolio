import { useEffect, useMemo, useState } from "react";
import {
    Box, Button, Flex, Input, Spinner, Text,
} from "@/compat/ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { MdSearch, MdEdit, MdAutoAwesome } from "react-icons/md";
import { LuX } from "react-icons/lu";
import { SkillService, type SkillSummary } from "@/db";
import { useSkillLibrary, SkillEditor } from "@/components/skills/SkillBrowser";
import SkillDraftPane from "@/components/skills/SkillDraftPane";
import SkillCreatePane from "@/components/skills/SkillCreatePane";
import { SourceMark, type SourceKey } from "@/lib/sourceLogos";
import { stagger, staggerItem } from "@/lib/motion";
import { toaster } from "@/compat/ui";

/**
 * Model Library — where skills are created, inspected, and attached. Two
 * panes: left, the catalog (skills grouped by category); right, the detail
 * pane (the full document rendered beautifully, or the create/draft
 * editors). The Attach action adds a skill to an agent.
 */

const CATEGORY_LABELS: Record<string, string> = {
    valuation: "Valuation",
    fundamentals: "Fundamentals",
    qualitative: "Qualitative",
    market: "Market",
    macro: "Macro",
    custom: "Custom",
};

/** Source marks implied by a skill's category + anchors — the data it draws on. */
function sourcesForSkill(skill: SkillSummary): SourceKey[] {
    const out: SourceKey[] = ["voyager"];
    const cat = skill.category;
    if (cat === "valuation" || cat === "fundamentals") out.push("sec", "nse");
    if (cat === "market") out.push("news");
    if (cat === "qualitative") out.push("reddit", "youtube");
    if (cat === "macro") out.push("news", "web");
    return out;
}

type Mode = "inspect" | "edit" | "draft" | "create";

interface ArmoryProps {
    /** When opened from the agent editor with an agent context, onEquip updates this agent's skills. */
    onEquip?: (skillId: string) => void;
    equippedIds?: Set<string>;
    /** Called when a capability is created/edited so parents refresh their library. */
    onSkillSaved?: (skill: SkillSummary) => void;
    onSkillDeleted?: (id: string) => void;
    /** Slide-over variant inside the agent editor. */
    variant?: "page" | "dock";
    open?: boolean;
    onClose?: () => void;
}

export default function Armory({
    onEquip, equippedIds, onSkillSaved, onSkillDeleted,
    variant = "page", open = true, onClose,
}: ArmoryProps) {
    const navigate = useNavigate();
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [docError, setDocError] = useState(false);
    const [mode, setMode] = useState<Mode>("inspect");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [agentPickerId, setAgentPickerId] = useState("");
    const [agents, setAgents] = useState<{ _id?: string; id?: string; name: string; skills?: { skill_id: string; weight: number }[] }[]>([]);
    const [equipping, setEquipping] = useState(false);
    const [searchParams] = useSearchParams();

    // Deep link: /armory?skill=<id> opens the detail pane on that skill.
    const requestedSkill = searchParams.get("skill");

    useEffect(() => {
        if (requestedSkill && library.length) {
            const s = library.find((x) => x.id === requestedSkill);
            if (s) { setSelected(s); setMode("inspect"); }
        }
    }, [requestedSkill, library]);

    // Agents for the attach picker.
    useEffect(() => {
        SkillService.listSkills; // no-op reference to keep tree-shake honest
        import("@/db").then(({ AgentService }) => AgentService.listAgents())
            .then((data) => { if (Array.isArray(data)) setAgents(data); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!selected || mode !== "inspect") { setMarkdown(null); return; }
        let cancelled = false;
        setDocError(false);
        SkillService.readSkill(selected.id)
            .then((s) => { if (!cancelled) setMarkdown(s.markdown || ""); })
            .catch(() => { if (!cancelled) setDocError(true); });
        return () => { cancelled = true; };
    }, [selected, mode]);

    const categories = useMemo(
        () => Array.from(new Set(library.map((s) => s.category))),
        [library],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return library.filter((s) => {
            if (category !== "all" && s.category !== category) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [library, query, category]);

    const byCategory = useMemo(() => {
        const groups: Record<string, SkillSummary[]> = {};
        for (const s of filtered) (groups[s.category] ||= []).push(s);
        return groups;
    }, [filtered]);

    const isEquipped = (id: string) => !!equippedIds?.has(id);

    const attach = async (skill: SkillSummary) => {
        if (onEquip) { onEquip(skill.id); return; }
        const agentId = agentPickerId || agents[0]?.id || agents[0]?._id;
        if (!agentId) {
            toaster.create({ title: "No agent selected", description: "Create an agent first, then attach skills to it.", type: "warning" });
            return;
        }
        setEquipping(true);
        try {
            const { AgentService } = await import("@/db");
            const agent = agents.find((a) => (a.id || a._id) === agentId);
            const skills = [...(agent?.skills || []).map((s) => ({ skill_id: s.skill_id, weight: s.weight ?? 5 }))];
            if (!skills.some((s) => s.skill_id === skill.id)) skills.push({ skill_id: skill.id, weight: 5 });
            await AgentService.updateAgent({
                name: agent?.name, persona: (agent as any)?.persona, configuration: (agent as any)?.configuration,
                skills, id: agentId, _id: agentId,
            });
            toaster.create({ title: `${skill.name} attached`, description: `Added to ${agent?.name || "the agent"} at weight 5.`, type: "success" });
            setAgents((prev) => prev.map((a) => ((a.id || a._id) === agentId ? { ...a, skills } : a)));
        } catch (e: any) {
            toaster.create({ title: "Couldn't attach", description: e?.response?.data?.error || e?.message, type: "error" });
        } finally {
            setEquipping(false);
        }
    };

    const bench = (
        <Box flex={1} minH={0} overflowY="auto" px={{ base: 4, md: 6 }} py={4}>
            {mode === "draft" ? (
                <SkillDraftPane
                    skill={null}
                    hasWebSearch
                    onCancel={() => setMode(selected ? "inspect" : "draft")}
                    onSaved={(skill) => {
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                        setSelected(skill); setMode("inspect");
                        onSkillSaved?.(skill);
                    }}
                />
            ) : mode === "create" ? (
                <SkillCreatePane
                    library={library}
                    onCancel={() => setMode("draft")}
                    onSaved={(skill) => {
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                        setSelected(skill); setMode("inspect");
                        onSkillSaved?.(skill);
                    }}
                />
            ) : mode === "edit" && selected ? (
                <SkillEditor
                    skill={selected}
                    onCancel={() => setMode("inspect")}
                    onSaved={(saved) => {
                        setLibrary((lib) => [...lib.filter((s) => s.id !== saved.id), saved]);
                        setSelected(saved); setMode("inspect");
                        onSkillSaved?.(saved);
                    }}
                />
            ) : selected ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
                    {/* Bench header */}
                    <Flex align="flex-start" justify="space-between" gap={3} wrap="wrap" mb={3}>
                        <Box minW={0}>
                            <Text fontSize={{ base: "19px", md: "22px" }} fontWeight={700} letterSpacing="-0.02em" color="var(--ink-primary)">
                                {selected.name}
                            </Text>
                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mt={0.5}>
                                {CATEGORY_LABELS[selected.category] || selected.category} · v{selected.version} · {selected.id}
                            </Text>
                        </Box>
                        <Flex gap={1.5} flexShrink={0} wrap="wrap">
                            <Button size="xs" variant="ghost" onClick={() => setMode("draft")} aria-label="Draft an edit with AI">
                                <MdAutoAwesome size={13} /> Draft with AI
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setMode("edit")} aria-label={`Edit ${selected.name}`}>
                                <MdEdit size={13} /> Edit
                            </Button>
                        </Flex>
                    </Flex>

                    <Text fontSize="14px" color="var(--ink-secondary)" lineHeight="1.65" mb={5} maxW="70ch">
                        {selected.description}
                    </Text>

                    {/* Specs */}
                    {selected.purpose && (
                        <Box mb={5}>
                            <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={1.5}>
                                What it measures
                            </Text>
                            <Text fontSize="13.5px" color="var(--ink-secondary)" lineHeight="1.7" whiteSpace="pre-wrap" maxW="70ch">
                                {selected.purpose}
                            </Text>
                        </Box>
                    )}

                    {/* Verdict anchors — checklist */}
                    {!!selected.anchors?.length && (
                        <Box mb={5}>
                            <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={2}>
                                Verdicts it returns
                            </Text>
                            <Flex direction="column" gap={1.5}>
                                {selected.anchors.map((a) => (
                                    <Flex key={a.label} align="center" gap={2}>
                                        <Box w="13px" h="13px" borderRadius="2px" border="1px solid var(--skill-accent)" flexShrink={0} aria-hidden />
                                        <Text fontSize="13px" color="var(--ink-secondary)">{a.label}</Text>
                                    </Flex>
                                ))}
                            </Flex>
                        </Box>
                    )}

                    {/* Source sigils */}
                    <Box mb={5}>
                        <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={2}>
                            Draws on
                        </Text>
                        <Flex gap={3} wrap="wrap">
                            {sourcesForSkill(selected).map((src) => (
                                <Flex key={src} align="center" gap={1.5} px={2} py={1} border="var(--hairline-w) solid var(--hairline)" borderRadius="var(--radius-box)" bg="var(--console-panel)">
                                    <SourceMark source={src} size={12} />
                                    <Text fontSize="11px" color="var(--ink-secondary)">{src}</Text>
                                </Flex>
                            ))}
                        </Flex>
                    </Box>

                    {/* Full document */}
                    <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--ink-tertiary)" mb={2}>
                        Full document
                    </Text>
                    {docError ? (
                        <Text fontSize="13px" color="var(--signal-negative)">Couldn't load this skill's document.</Text>
                    ) : markdown === null ? (
                        <Flex py={4}><Spinner size="sm" color="var(--skill-accent)" /></Flex>
                    ) : (
                        <Box
                            as="pre" m={0} p={4}
                            borderRadius="var(--radius-surface)"
                            border="var(--hairline-w) solid var(--hairline)"
                            bg="var(--surface-recessed)"
                            fontSize="12px" lineHeight="1.75"
                            color="var(--ink-secondary)"
                            fontFamily="var(--font-mono)"
                            whiteSpace="pre-wrap" wordBreak="break-word"
                        >
                            {markdown}
                        </Box>
                    )}

                    {/* Attach */}
                    {onSkillDeleted && selected.source === "custom" && (
                        <Button
                            size="xs" variant="ghost" colorPalette="red" mt={4}
                            onClick={async () => {
                                if (!confirm(`Delete "${selected.name}" permanently? Agents using it lose this skill.`)) return;
                                try {
                                    await SkillService.deleteSkill(selected.id);
                                    setLibrary((lib) => lib.filter((s) => s.id !== selected.id));
                                    onSkillDeleted(selected.id);
                                    setSelected(null);
                                } catch (e: any) {
                                    toaster.create({ title: "Couldn't delete", description: e?.message, type: "error" });
                                }
                            }}
                        >
                            Delete skill
                        </Button>
                    )}
                </motion.div>
            ) : (
                <Flex align="center" justify="center" h="full">
                    <Flex direction="column" align="center" gap={2} textAlign="center" px={6}>
                        <Text fontSize="13px" color="var(--ink-secondary)">Select a skill from the catalog.</Text>
                        <Text fontSize="12px" color="var(--ink-tertiary)">Its method, data sources, and verdict anchors render here.</Text>
                    </Flex>
                </Flex>
            )}
        </Box>
    );

    const body = (
        <Flex flex={1} minH={0} overflow="hidden">
            {/* Left: the catalog */}
            <Flex
                direction="column"
                w={{ base: "100%", md: "340px" }}
                flexShrink={0}
                borderRight={{ md: "var(--hairline-w) solid var(--hairline)" }}
                minH={0}
                display={selected || mode !== "inspect" ? { base: "none", md: "flex" } : "flex"}
            >
                <Box px={4} pt={3} pb={2} flexShrink={0}>
                    <Box position="relative">
                        <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="var(--ink-tertiary)" pointerEvents="none">
                            <MdSearch size={15} />
                        </Box>
                        <Input
                            placeholder="Search the library…"
                            aria-label="Search skills"
                            size="sm"
                            pl={9}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            bg="var(--console-panel)"
                        />
                    </Box>
                    <Flex gap={1.5} mt={2.5} wrap="wrap">
                        {["all", ...categories].map((c) => (
                            <Box
                                key={c}
                                as="button"
                                px={2.5} py={1}
                                borderRadius="full"
                                fontSize="11px"
                                fontWeight={category === c ? 600 : 400}
                                color={category === c ? "#fff" : "var(--ink-tertiary)"}
                                bg={category === c ? "var(--skill-accent)" : "transparent"}
                                border="1px solid"
                                borderColor={category === c ? "transparent" : "var(--hairline)"}
                                cursor="pointer"
                                _hover={{ color: category === c ? "#fff" : "var(--ink-primary)" }}
                                onClick={() => setCategory(c)}
                            >
                                {c === "all" ? "All" : CATEGORY_LABELS[c] || c}
                            </Box>
                        ))}
                    </Flex>
                </Box>

                <Box flex={1} minH={0} overflowY="auto" px={3} pb={3}>
                    {loading ? (
                        <Flex role="status" aria-label="Loading skills" justify="center" py={10}>
                            <Spinner color="var(--skill-accent)" />
                        </Flex>
                    ) : libraryError ? (
                        <Text fontSize="12.5px" color="var(--signal-negative)" py={4} px={1}>
                            The Model Library could not be loaded. Reload to retry.
                        </Text>
                    ) : (
                        <motion.div variants={stagger} initial="initial" animate="animate">
                            {Object.entries(byCategory).map(([cat, items]) => (
                                <Box key={cat} mb={4}>
                                    <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--ink-tertiary)" px={1} mb={1.5}>
                                        {CATEGORY_LABELS[cat] || cat}
                                    </Text>
                                    <Flex direction="column" gap={1}>
                                        {items.map((s) => {
                                            const isSelected = selected?.id === s.id;
                                            const equipped = isEquipped(s.id);
                                            return (
                                                <Box
                                                    key={s.id}
                                                    as="button"
                                                    textAlign="left"
                                                    p={2.5}
                                                    borderRadius="var(--radius-surface)"
                                                    border="1px solid"
                                                    borderColor={isSelected ? "var(--skill-accent)" : "transparent"}
                                                    bg={isSelected ? "color-mix(in srgb, var(--skill-accent) 7%, var(--console-panel))" : "transparent"}
                                                    cursor="pointer"
                                                    _hover={{ bg: "var(--surface-recessed)" }}
                                                    onClick={() => { setSelected(s); setMode("inspect"); }}
                                                >
                                                    <Flex align="center" gap={2} mb={0.5} wrap="wrap">
                                                        <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">{s.name}</Text>
                                                        {equipped && (
                                                            <Text fontSize="9px" fontFamily="var(--font-mono)" letterSpacing="0.08em" color="var(--skill-accent)">
                                                                ATTACHED
                                                            </Text>
                                                        )}
                                                        {s.source === "custom" && (
                                                            <Text fontSize="9px" fontFamily="var(--font-mono)" letterSpacing="0.08em" color="var(--ink-tertiary)">
                                                                YOURS
                                                            </Text>
                                                        )}
                                                    </Flex>
                                                    <Text fontSize="11.5px" color="var(--ink-tertiary)" lineClamp={2}>
                                                        {s.description}
                                                    </Text>
                                                </Box>
                                            );
                                        })}
                                    </Flex>
                                </Box>
                            ))}
                            {filtered.length === 0 && (
                                <Text fontSize="12.5px" color="var(--ink-tertiary)" py={4} px={1}>
                                    Nothing in the library matches that search.
                                </Text>
                            )}
                        </motion.div>
                    )}
                </Box>

                {/* Draft with AI / Create manually */}
                <Box px={3} py={3} borderTop="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                    <Flex direction="column" gap={2}>
                        <Button
                            size="sm"
                            variant={mode === "draft" ? "solid" : "outline"}
                            colorPalette={mode === "draft" ? "teal" : undefined}
                            borderColor="var(--skill-accent)"
                            color={mode === "draft" ? undefined : "var(--skill-accent)"}
                            w="full"
                            onClick={() => { setMode("draft"); setSelected(null); }}
                        >
                            <MdAutoAwesome aria-hidden /> Draft with AI
                        </Button>
                        <Button
                            size="sm"
                            variant={mode === "create" ? "solid" : "outline"}
                            colorPalette={mode === "create" ? "teal" : undefined}
                            w="full"
                            onClick={() => { setMode("create"); setSelected(null); }}
                        >
                            <MdEdit aria-hidden /> Create manually
                        </Button>
                    </Flex>
                </Box>
            </Flex>

            {/* Right: the inspection bench */}
            <Flex flex={1} minH={0} direction="column" display={selected || mode !== "inspect" ? "flex" : { base: "none", md: "flex" }}>
                {(selected || mode !== "inspect") && (
                    <Flex px={4} pt={3} flexShrink={0} display={{ base: "flex", md: "none" }}>
                        <Button size="xs" variant="ghost" onClick={() => { setSelected(null); setMode("inspect"); }}>← Library</Button>
                    </Flex>
                )}
                {bench}
                {/* Attach bar */}
                {selected && mode === "inspect" && (onEquip || agents.length > 0) && (
                    <Box px={{ base: 4, md: 6 }} py={3} borderTop="var(--hairline-w) solid var(--hairline)" flexShrink={0} bg="var(--console-panel)">
                        <Flex gap={2} align="center" wrap="wrap">
                            {isEquipped(selected.id) ? (
                                <Text fontSize="12.5px" color="var(--skill-accent)" fontWeight={600}>
                                    Attached to this agent.
                                </Text>
                            ) : onEquip ? (
                                <Button
                                    size="sm"
                                    bg="var(--skill-accent)" color="#fff"
                                    _hover={{ bg: "color-mix(in srgb, var(--skill-accent) 85%, #000)" }}
                                    onClick={() => attach(selected)}
                                >
                                    Attach
                                </Button>
                            ) : (
                                <>
                                    <select
                                        value={agentPickerId}
                                        onChange={(e) => setAgentPickerId(e.target.value)}
                                        aria-label="Choose agent to attach"
                                        style={{
                                            fontSize: "12px", padding: "6px 24px 6px 8px", borderRadius: "4px",
                                            border: "var(--hairline-w) solid var(--hairline)", background: "var(--surface-panel)",
                                            color: "var(--ink-primary)", cursor: "pointer",
                                        }}
                                    >
                                        {agents.map((a) => (
                                            <option key={a.id || a._id} value={a.id || a._id}>{a.name || "Untitled agent"}</option>
                                        ))}
                                    </select>
                                    <Button
                                        size="sm"
                                        bg="var(--skill-accent)" color="#fff"
                                        _hover={{ bg: "color-mix(in srgb, var(--skill-accent) 85%, #000)" }}
                                        loading={equipping}
                                        onClick={() => attach(selected)}
                                    >
                                        Attach
                                    </Button>
                                </>
                            )}
                            {variant === "dock" && onClose && (
                                <Button size="sm" variant="ghost" ml="auto" onClick={onClose}>
                                    <LuX size={14} /> Close
                                </Button>
                            )}
                        </Flex>
                    </Box>
                )}
            </Flex>
        </Flex>
    );

    if (variant === "dock") {
        if (!open) return null;
        return (
            <motion.div
                style={{ position: "fixed", inset: 0, zIndex: 1200, background: "color-mix(in srgb, #000 45%, transparent)", display: "flex" }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onClose}
                data-testid="armory-dock"
            >
                <motion.div
                    style={{
                        marginLeft: "auto", height: "100%", width: "min(920px, 100%)",
                        background: "var(--console-canvas)", display: "flex", flexDirection: "column",
                        borderLeft: "var(--hairline-w) solid var(--hairline)",
                    }}
                    initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 32 }}
                    onClick={(e: any) => e.stopPropagation()}
                >
                    <Flex align="center" justify="space-between" px={5} py={3} borderBottom="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                        <Box>
                            <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)">Model Library</Text>
                            <Text fontSize="15px" fontWeight={700} color="var(--ink-primary)">Skills</Text>
                        </Box>
                        <Button size="sm" variant="subtle" onClick={onClose} aria-label="Close Model Library">
                            <LuX size={16} />
                        </Button>
                    </Flex>
                    {body}
                </motion.div>
            </motion.div>
        );
    }

    return (
        <Box className="console-world" minH="100%" h="100%" display="flex" flexDirection="column" position="relative">
            <Flex direction="column" flex={1} minH={0} maxW="1240px" w="full" mx="auto" px={{ base: 4, md: 6 }} py={{ base: 4, md: 6 }}>
                <Flex align="flex-end" justify="space-between" gap={3} wrap="wrap" mb={4} flexShrink={0}>
                    <Box>
                        <Text fontSize="10.5px" fontWeight={500} letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={1.5}>
                            Model Library
                        </Text>
                        <Text fontSize={{ base: "24px", md: "28px" }} fontWeight={700} letterSpacing="-0.02em" color="var(--ink-primary)" lineHeight="1.15">
                            Skills
                        </Text>
                        <Text fontSize="13px" color="var(--ink-secondary)" mt={1}>
                            Every skill an agent can use — read it, draft one with AI, or write your own.
                        </Text>
                    </Box>
                    <Button size="sm" variant="outline" minH="36px" borderColor="var(--hairline)" color="var(--ink-secondary)" onClick={() => navigate("/console")}>
                        ← Agent Console
                    </Button>
                </Flex>
                {body}
            </Flex>
        </Box>
    );
}
