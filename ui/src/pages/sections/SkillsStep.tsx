import { useEffect, useMemo, useState } from "react";
import { Box, Button, Flex, Input, Text } from "@/compat/ui";
import { MdAutoAwesome } from "react-icons/md";
import { SiAgentskills } from "react-icons/si";
import SkillBrowser, { useSkillLibrary } from "@/components/skills/SkillBrowser";
import SkillAvatar from "@/components/shared/SkillAvatar";
import { SettingsService, type SkillSummary } from "@/db";

/**
 * SkillsStep — the v3 agent builder's core step.
 *
 * The default library is deliberately NOT rendered inline: only what the user
 * attached to this agent is on the page, and the full library is one click away
 * in the browser modal where each skill can be opened and read. Attached rows
 * each carry a "View" affordance so a skill's contents are always one click
 * from the list.
 */

export interface AgentSkillRef {
    skill_id: string;
    weight: number;
}

interface Props {
    skills: AgentSkillRef[];
    onChange: (skills: AgentSkillRef[]) => void;
}

export default function SkillsStep({ skills, onChange }: Props) {
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [browserOpen, setBrowserOpen] = useState(false);
    const [viewing, setViewing] = useState<SkillSummary | null>(null);
    const [hasTavily, setHasTavily] = useState(false);

    useEffect(() => {
        SettingsService.getSettings()
            .then((s) => setHasTavily(!!s?.llm_keys?.tavily))
            .catch(() => {});
    }, []);

    const attached = useMemo(() => new Set(skills.map((s) => s.skill_id)), [skills]);
    const nameOf = (id: string) => library.find((s) => s.id === id)?.name || id;

    const toggle = (id: string) => {
        if (attached.has(id)) {
            onChange(skills.filter((s) => s.skill_id !== id));
        } else {
            onChange([...skills, { skill_id: id, weight: 5 }]);
        }
    };

    const setWeight = (id: string, weight: number) => {
        onChange(skills.map((s) => (s.skill_id === id ? { ...s, weight } : s)));
    };

    const move = (index: number, dir: -1 | 1) => {
        const next = [...skills];
        const target = index + dir;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const totalWeight = skills.reduce((sum, s) => sum + s.weight, 0);

    return (
        <Flex direction="column" gap={5} w="100%">
            <Flex align="center" justify="space-between" gap={3} wrap="wrap">
                <Box>
                    <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)" display="flex" alignItems="center" gap={1.5}>
                        <SiAgentskills aria-hidden /> Skills ({skills.length})
                    </Text>
                    <Text fontSize="12px" color="var(--ink-tertiary)">
                        {skills.length === 0
                            ? "An agent needs at least one skill to run an analysis."
                            : `Total weight ${totalWeight} · order does not matter.`}
                    </Text>
                    {skills.length > 0 && (
                        <Text fontSize="12px" color="var(--ink-secondary)" mt={1} maxW="70ch">
                            Weight (1–10) scales each skill&apos;s contribution to the fit score — the score is the
                            weighted average across the skills that produced one. A skill that returns no usable
                            data contributes nothing regardless of its weight.
                        </Text>
                    )}
                </Box>
                <Flex gap={2} align="center">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            // Drafting happens INSIDE the browser's right pane now —
                            // open the library with draft mode armed.
                            setBrowserOpen(true);
                        }}
                    >
                        <MdAutoAwesome /> Draft with AI
                    </Button>
                    <SkillBrowser
                        library={library}
                        loading={loading}
                        error={libraryError}
                        attachedIds={attached}
                        onToggle={toggle}
                        onAdd={toggle}
                        hasWebSearch={hasTavily}
                        allowManualCreate
                        open={browserOpen}
                        onOpenChange={setBrowserOpen}
                        openWithId={viewing?.id || null}
                        // Wire the draft pane: without this prop the "Draft with AI"
                        // button opened a library with no draft affordance at all.
                        onDraftClick={() => setBrowserOpen(true)}
                        onSkillSaved={(saved) => {
                            // Edits, forks, and newly drafted skills refresh the
                            // library so names/descriptions stay current.
                            setLibrary((lib) => [...lib.filter((s) => s.id !== saved.id), saved]);
                            // A freshly drafted skill is usually wanted on this
                            // agent — attach it immediately (idempotent).
                            if (!attached.has(saved.id)) onChange([...skills, { skill_id: saved.id, weight: 5 }]);
                        }}
                        onSkillDeleted={(id) => {
                            // Deleted skills can't stay attached to this agent.
                            setLibrary((lib) => lib.filter((s) => s.id !== id));
                            onChange(skills.filter((s) => s.skill_id !== id));
                        }}
                    />
                </Flex>
            </Flex>

            {skills.length === 0 ? (
                <Box
                    border="1px dashed var(--hairline)"
                    borderRadius="8px"
                    px={5}
                    py={8}
                    textAlign="center"
                >
                    <Text fontSize="13px" color="var(--ink-secondary)" mb={1}>
                        No skills attached yet
                    </Text>
                    <Text fontSize="12.5px" color="var(--ink-tertiary)" mb={3}>
                        Browse the library and add the skills this investor actually uses.
                    </Text>
                    <Button size="sm" variant="surface" onClick={() => setBrowserOpen(true)}>
                        <SiAgentskills aria-hidden /> Browse skills
                    </Button>
                </Box>
            ) : (
                <Flex direction="column" gap={1}>
                    {skills.map((ref, i) => (
                        <Flex
                            key={ref.skill_id}
                            align="center"
                            gap={2.5}
                            px={2.5}
                            py={1.5}
                            borderBottom="var(--hairline-w) solid var(--hairline)"
                            bg="transparent"
                            _hover={{ bg: "var(--surface-recessed)" }}
                        >
                            <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" w="16px" flexShrink={0} textAlign="right">
                                {i + 1}
                            </Text>
                            <SkillAvatar skill={{ id: ref.skill_id, name: nameOf(ref.skill_id) }} size={18} />
                            <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)" truncate flex={1} minW={0}>
                                {nameOf(ref.skill_id)}
                            </Text>
                            <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                    // Opens INSIDE the skill library browser — no
                                    // second popup fighting this list for space.
                                    setViewing(library.find((s) => s.id === ref.skill_id) || { id: ref.skill_id, name: nameOf(ref.skill_id), description: "", category: "custom" as const, version: 1, source: "custom" as const });
                                    setBrowserOpen(true);
                                }}
                            >
                                View
                            </Button>
                            <Text as="label" htmlFor={`skill-weight-${ref.skill_id}`} fontSize="11px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                                weight
                            </Text>
                            <Input
                                id={`skill-weight-${ref.skill_id}`}
                                type="number"
                                min={1}
                                max={10}
                                w={16}
                                size="sm"
                                textAlign="center"
                                aria-label={`Weight for ${nameOf(ref.skill_id)}`}
                                value={ref.weight}
                                onChange={(e) =>
                                    setWeight(ref.skill_id, Math.min(10, Math.max(1, Number(e.target.value) || 5)))
                                }
                            />
                            <Button size="xs" variant="ghost" onClick={() => move(i, -1)} aria-label={`Move ${nameOf(ref.skill_id)} up`}>
                                ↑
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => move(i, 1)} aria-label={`Move ${nameOf(ref.skill_id)} down`}>
                                ↓
                            </Button>
                            <Button size="xs" variant="ghost" colorPalette="red" onClick={() => toggle(ref.skill_id)}>
                                Remove
                            </Button>
                        </Flex>
                    ))}
                </Flex>
            )}

            {/* Reading/editing happens inside the SkillBrowser dialog (openWithId
                focuses the row) — a separate View popup collided with its own
                Close button and duplicated the library UI. */}
        </Flex>
    );
}
