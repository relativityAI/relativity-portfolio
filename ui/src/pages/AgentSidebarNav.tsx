import { Flex, Text, Box } from "@chakra-ui/react"
import { motion } from "motion/react"
import { dur, ease } from "@/lib/motion"

export interface StepDef {
    id: string;
    label: string;
}

interface NavProps {
    steps: StepDef[];
    active: string;
    onSelect: (id: string) => void;
    completion: Record<string, boolean>;
}

function CompletionDot({ filled }: { filled: boolean }) {
    return (
        <Box
            as={motion.div}
            animate={{
                scale: filled ? [1, 1.35, 1] : 1,
                backgroundColor: filled ? "var(--signal-positive)" : "transparent",
            }}
            transition={{ duration: dur.base, ease }}
            w="7px"
            h="7px"
            borderRadius="2px"
            bg={filled ? "var(--signal-positive)" : "transparent"}
            border={filled ? "none" : "1px solid var(--hairline)"}
            flexShrink={0}
            ml="auto"
        />
    )
}

export function StepRail({ steps, active, onSelect, completion }: NavProps) {
    return (
        <Flex
            direction="column"
            gap={1}
            w="216px"
            flexShrink={0}
            position="sticky"
            top="120px"
            alignSelf="flex-start"
            role="tablist"
            aria-label="Agent setup steps"
        >
            {steps.map((s, i) => {
                const isActive = active === s.id
                const numbered = i > 0
                return (
                    <Box
                        key={s.id}
                        position="relative"
                        cursor="pointer"
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={0}
                        onClick={() => onSelect(s.id)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                onSelect(s.id)
                            }
                        }}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="rail-active"
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    background: "var(--surface-recessed)",
                                    borderRadius: "4px",
                                }}
                            />
                        )}
                        <Flex
                            position="relative"
                            align="center"
                            gap={2.5}
                            px={3}
                            py={2.5}
                            rounded="sm"
                        >
                            {numbered && (
                                <Text
                                    as="span"
                                    fontFamily="var(--font-mono)"
                                    fontSize="11px"
                                    color={isActive ? "var(--accent-primary)" : "var(--ink-tertiary)"}
                                    fontWeight={500}
                                    letterSpacing="0.04em"
                                >
                                    {String(i).padStart(2, "0")}
                                </Text>
                            )}
                            <Text
                                fontSize="13.5px"
                                fontWeight={isActive ? 600 : 400}
                                color={isActive ? "var(--ink-primary)" : "var(--ink-secondary)"}
                                truncate
                            >
                                {s.label}
                            </Text>
                            {numbered && <CompletionDot filled={completion[s.id] || false} />}
                        </Flex>
                    </Box>
                )
            })}
        </Flex>
    )
}

export function MobilePills({ steps, active, onSelect }: NavProps) {
    return (
        <Flex gap={1} overflowX="auto" flexWrap="nowrap" pb={1} css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
            {steps.map((s, i) => {
                const isActive = active === s.id
                return (
                    <Box
                        key={s.id}
                        as={motion.div}
                        whileTap={{ scale: 0.96 }}
                        position="relative"
                        px={3}
                        py={2}
                        rounded="2px"
                        whiteSpace="nowrap"
                        cursor="pointer"
                        minH="44px"
                        display="flex"
                        alignItems="center"
                        onClick={() => onSelect(s.id)}
                    >
                        {isActive && (
                            <motion.span
                                layoutId="pill-active"
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    background: "var(--surface-recessed)",
                                    borderRadius: "2px",
                                    border: "1px solid var(--accent-primary)",
                                }}
                            />
                        )}
                        <Text
                            as="span"
                            position="relative"
                            fontSize="13px"
                            fontWeight={isActive ? 600 : 400}
                            color={isActive ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                        >
                            {i > 0 && (
                                <Text as="span" fontFamily="var(--font-mono)" mr={1} fontSize="11px">
                                    {String(i).padStart(2, "0")}
                                </Text>
                            )}
                            {s.label}
                        </Text>
                    </Box>
                )
            })}
        </Flex>
    )
}
