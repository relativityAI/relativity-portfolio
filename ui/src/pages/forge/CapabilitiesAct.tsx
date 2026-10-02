import { useMemo } from "react";
import { Box, Button, Flex, Input, Text } from "@/compat/ui";
import { motion } from "motion/react";
import { SiAgentskills } from "react-icons/si";
import { LuArrowUp, LuArrowDown, LuX } from "react-icons/lu";
import { stagger, staggerItem } from "@/lib/motion";

/**
 * Skills section. Attached skills as cards: weight as a notched slider with
 * a live share-of-score readout, reorder arrows (display order only —
 * backend contract unchanged), and empty slots pointing to the library.
 */

export interface AgentSkillRef {
    skill_id: string;
    weight: number;
}

interface CapabilitiesActProps {
    skills: AgentSkillRef[];
    skillNames: Record<string, string>;
    onChange: (skills: AgentSkillRef[]) => void;
    onOpenLibrary: () => void;
    onInspect: (skillId: string) => void;
}

function WeightSlider({ id, name, weight, onChange }: { id: string; name: string; weight: number; onChange: (w: number) => void }) {
    return (
        <Box as="div" role="group" px={2} py={1.5} borderRadius="var(--radius-surface)" bg="var(--surface-recessed)" border="var(--hairline-w) solid var(--hairline)" w="100%">
            <Flex justify="space-between" align="center" mb={1.5}>
                <Text as="label" htmlFor={`weight-${id}`} fontSize="10px" letterSpacing="0.12em" textTransform="uppercase" color="var(--ink-tertiary)">
                    Weight
                </Text>
                <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" fontWeight={700} color="var(--skill-accent)">
                    {weight}/10
                </Text>
            </Flex>
            {/* Notched 1–10 picker: ten discrete segments, keyboard-operable input */}
            <Flex gap="3px" role="slider" aria-label={`Weight for ${name}`} aria-valuemin={1} aria-valuemax={10} aria-valuenow={weight} tabIndex={0}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(10, weight + 1)); }
                    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(Math.max(1, weight - 1)); }
                }}>
                {Array.from({ length: 10 }).map((_, i) => {
                    const v = i + 1;
                    const filled = v <= weight;
                    return (
                        <Box
                            key={v}
                            as="button"
                            flex={1}
                            h="16px"
                            minW="12px"
                            minH="24px"
                            borderRadius="2px"
                            bg={filled ? "var(--skill-accent)" : "var(--console-panel)"}
                            border="1px solid"
                            borderColor={filled ? "transparent" : "var(--hairline)"}
                            cursor="pointer"
                            aria-hidden
                            tabIndex={-1}
                            onClick={() => onChange(v)}
                            transition="background 120ms"
                        />
                    );
                })}
            </Flex>
            <Input id={`weight-${id}`} type="range" min={1} max={10} step={1} value={weight}
                onChange={(e) => onChange(Number(e.target.value))}
                position="absolute" opacity={0} w="1px" h="1px" overflow="hidden" aria-hidden tabIndex={-1} />
        </Box>
    );
}

export default function CapabilitiesAct({ skills, skillNames, onChange, onOpenLibrary, onInspect }: CapabilitiesActProps) {
    const totalWeight = useMemo(() => skills.reduce((s, x) => s + (x.weight || 5), 0), [skills]);

    const setWeight = (id: string, weight: number) =>
        onChange(skills.map((s) => (s.skill_id === id ? { ...s, weight } : s)));

    const remove = (id: string) => onChange(skills.filter((s) => s.skill_id !== id));

    const move = (index: number, dir: -1 | 1) => {
        const next = [...skills];
        const target = index + dir;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const ghostSlots = skills.length === 0 ? 3 : skills.length < 4 ? 1 : 0;

    return (
        <motion.div variants={stagger} initial="initial" animate="animate" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {skills.map((ref, i) => {
                const name = skillNames[ref.skill_id] || ref.skill_id;
                const share = totalWeight > 0 ? Math.round(((ref.weight || 5) / totalWeight) * 100) : 0;
                return (
                    <motion.div
                        key={ref.skill_id}
                        variants={staggerItem}
                        layout
                        transition={{ type: "spring", stiffness: 320, damping: 30 }}
                    >
                        <Flex
                            align="center"
                            gap={{ base: 3, md: 4 }}
                            px={{ base: 3.5, md: 4.5 }}
                            py={3.5}
                            border="var(--hairline-w) solid color-mix(in srgb, var(--skill-accent) 24%, var(--hairline))"
                            borderRadius="var(--radius-surface)"
                            bg="var(--console-panel)"
                            wrap={{ base: "wrap", lg: "nowrap" }}
                        >
                            {/* Sigil + identity */}
                            <Flex align="center" gap={3} minW={0} flex={{ base: "1 1 100%", lg: "1 1 260px" }}>
                                <Flex
                                    align="center" justify="center"
                                    w="34px" h="34px" flexShrink={0}
                                    borderRadius="var(--radius-box)"
                                    bg="color-mix(in srgb, var(--skill-accent) 12%, var(--console-panel))"
                                    border="var(--hairline-w) solid color-mix(in srgb, var(--skill-accent) 30%, transparent)"
                                    color="var(--skill-accent)"
                                >
                                    <SiAgentskills size={15} aria-hidden />
                                </Flex>
                                <Flex direction="column" minW={0}>
                                    <Box
                                        as="button"
                                        textAlign="left"
                                        fontSize="14px" fontWeight={600} color="var(--ink-primary)"
                                        truncate
                                        onClick={() => onInspect(ref.skill_id)}
                                        _hover={{ color: "var(--skill-accent)" }}
                                        cursor="pointer"
                                    >
                                        {name}
                                    </Box>
                                    <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                        {String(i + 1).padStart(2, "0")} · share of score {share}%
                                    </Text>
                                </Flex>
                            </Flex>

                            {/* Weight */}
                            <Box flex={{ base: "1 1 100%", lg: "0 0 300px" }}>
                                <WeightSlider id={ref.skill_id} name={name} weight={ref.weight || 5} onChange={(w) => setWeight(ref.skill_id, w)} />
                            </Box>

                            {/* Order + remove */}
                            <Flex gap={1} flexShrink={0} ml={{ lg: "auto" }}>
                                <Button size="xs" variant="ghost" aria-label={`Move ${name} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                                    <LuArrowUp size={13} />
                                </Button>
                                <Button size="xs" variant="ghost" aria-label={`Move ${name} down`} onClick={() => move(i, 1)} disabled={i === skills.length - 1}>
                                    <LuArrowDown size={13} />
                                </Button>
                                <Button size="xs" variant="ghost" colorPalette="red" aria-label={`Remove ${name}`} onClick={() => remove(ref.skill_id)}>
                                    <LuX size={13} />
                                </Button>
                            </Flex>
                        </Flex>
                    </motion.div>
                );
            })}

            {/* Ghost slots */}
            {Array.from({ length: ghostSlots }).map((_, i) => (
                <motion.div key={`ghost-${i}`} variants={staggerItem}>
                    <Box
                        px={4}
                        py={5}
                        border="1px dashed var(--hairline)"
                        borderRadius="var(--radius-surface)"
                        textAlign="center"
                    >
                        <Text fontSize="12.5px" color="var(--ink-tertiary)">
                            Slot {skills.length + i + 1} — empty.{" "}
                            <Box as="button" color="var(--skill-accent)" fontWeight={600} onClick={onOpenLibrary} cursor="pointer">
                                Open the Model Library.
                            </Box>
                        </Text>
                    </Box>
                </motion.div>
            ))}

            <Flex justify="space-between" align="center" wrap="wrap" gap={2}>
                <Text fontSize="11.5px" color="var(--ink-tertiary)">
                    Weight scales each skill's contribution to the fit score{skills.length > 1 ? ` — shares shown per card (total weight ${totalWeight})` : ""}.
                </Text>
                <Button size="sm" variant="outline" borderColor="var(--skill-accent)" color="var(--skill-accent)" onClick={onOpenLibrary}>
                    <SiAgentskills aria-hidden /> Model Library
                </Button>
            </Flex>
        </motion.div>
    );
}
