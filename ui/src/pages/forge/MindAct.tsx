import { Flex, Text, Box, Textarea } from "@/compat/ui"

/**
 * Philosophy section. The philosophy text as a manuscript: generous
 * line-height, serif-feel sizing, and a live character count framed honestly.
 */

const TARGET_MIN = 120

interface MindActProps {
    philosophy: string;
    onChange: (v: string) => void;
}

export default function MindAct({ philosophy, onChange }: MindActProps) {
    const chars = philosophy.length

    return (
        <Flex direction="column" gap={3}>
            <Textarea
                value={philosophy}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Write the agent's investing beliefs in your own words — what it buys, what it refuses, how it thinks about risk and time. The more detailed, the more it behaves like you."
                minH="220px"
                bg="transparent"
                border="none"
                outline="none"
                px={0}
                py={0}
                resize="vertical"
                fontSize={{ base: "15px", md: "17px" }}
                lineHeight="1.85"
                letterSpacing="-0.005em"
                color="var(--ink-primary)"
                _focusVisible={{ outline: "none" }}
                _placeholder={{ color: "var(--ink-tertiary)", fontStyle: "italic" }}
                aria-label="Agent philosophy"
                data-testid="forge-philosophy"
            />
            <Flex justify="space-between" align="center" borderTop="var(--hairline-w) solid var(--hairline)" pt={2}>
                <Text fontSize="11px" color={chars >= TARGET_MIN ? "var(--ink-tertiary)" : "var(--signal-caution)"}>
                    {chars === 0
                        ? "Blank — the agent reads every word you write."
                        : chars < TARGET_MIN
                            ? `${chars} characters — a philosophy this short leaves the agent guessing.`
                            : `${chars} characters — the agent reads every word.`}
                </Text>
                <Text fontSize="10px" letterSpacing="0.1em" textTransform="uppercase" color="var(--ink-tertiary)">
                    Philosophy
                </Text>
            </Flex>
        </Flex>
    )
}
