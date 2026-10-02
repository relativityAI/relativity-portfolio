import { Flex, Text, Box, Slider } from "@/compat/ui"

/**
 * Strategy section. Horizon as a segmented control; risk as a horizontal
 * gauge with finance-plausible zone labels. One row, no section chrome.
 */

const HORIZONS = [
    { value: "Intraday", label: "Intraday" },
    { value: "Swing", label: "Swing" },
    { value: "Positional", label: "Positional" },
    { value: "Long-term (years)", label: "Long-term" },
]

const RISK_ZONES = [
    { to: 3, label: "Capital preservation" },
    { to: 6, label: "Measured" },
    { to: 10, label: "Aggressive" },
]

interface DoctrineActProps {
    horizon: string;
    risk: number;
    onChange: (v: { investment_horizon?: string; risk_appetite?: number }) => void;
}

function zoneOf(risk: number): string {
    const z = RISK_ZONES.find((z) => risk <= z.to)
    return z ? z.label : "Measured"
}

export default function DoctrineAct({ horizon, risk, onChange }: DoctrineActProps) {
    return (
        <Flex direction="column" gap={8}>
            {/* Horizon — segmented control */}
            <Box>
                <Text fontSize="10.5px" letterSpacing="0.14em" textTransform="uppercase" color="var(--ink-tertiary)" mb={3}>
                    Horizon — how long this agent holds
                </Text>
                <Flex gap={0} borderWidth="var(--hairline-w)" borderColor="var(--hairline)" borderRadius="var(--radius-surface)" overflow="hidden" w="fit-content" maxW="100%">
                    {HORIZONS.map((h, i) => {
                        const active = horizon === h.value
                        return (
                            <Box
                                key={h.value}
                                as="button"
                                px={{ base: 3, md: 5 }}
                                py={2.5}
                                minH="44px"
                                fontSize="13px"
                                fontWeight={active ? 600 : 400}
                                color={active ? "#fff" : "var(--ink-secondary)"}
                                bg={active ? "var(--skill-accent)" : "var(--console-panel)"}
                                borderRight={i < HORIZONS.length - 1 ? "var(--hairline-w) solid var(--hairline)" : undefined}
                                cursor="pointer"
                                transition="background 140ms"
                                _hover={{ bg: active ? "var(--skill-accent)" : "var(--surface-recessed)" }}
                                aria-pressed={active}
                                onClick={() => onChange({ investment_horizon: h.value })}
                                flexShrink={0}
                            >
                                {h.label}
                            </Box>
                        )
                    })}
                </Flex>
            </Box>

            {/* Risk — gauge with zones */}
            <Box>
                <Flex justify="space-between" align="baseline" mb={3} wrap="wrap" gap={2}>
                    <Text fontSize="10.5px" letterSpacing="0.14em" textTransform="uppercase" color="var(--ink-tertiary)">
                        Risk appetite
                    </Text>
                    <Flex align="baseline" gap={2}>
                        <Text fontSize="20px" fontWeight={700} fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-primary)">
                            {risk}
                        </Text>
                        <Text fontSize="11px" color="var(--ink-tertiary)" fontFamily="var(--font-tabular)">/10</Text>
                        <Text fontSize="12.5px" color="var(--skill-accent)" fontWeight={500} ml={2}>
                            {zoneOf(risk)}
                        </Text>
                    </Flex>
                </Flex>

                <Slider.Root
                    min={1} max={10} step={1}
                    value={[risk]}
                    onValueChange={(e) => onChange({ risk_appetite: e.value[0] })}
                    size="sm"
                    aria-label="Risk appetite"
                    colorPalette="orange"
                >
                    <Slider.Control>
                        <Slider.Track bg="var(--surface-recessed)">
                            {/* Zone segments — visual scale beneath the fill */}
                            <Box position="absolute" inset="0" display="flex">
                                {RISK_ZONES.map((z, i) => (
                                    <Box
                                        key={z.label}
                                        flex={i === 0 ? 3 : i === 1 ? 3 : 4}
                                        borderRight={i < 2 ? "var(--hairline-w) solid var(--hairline)" : undefined}
                                    />
                                ))}
                            </Box>
                            <Slider.Range bg="var(--skill-accent)" />
                        </Slider.Track>
                        <Slider.Thumb
                            index={0}
                            bg="var(--console-panel)"
                            borderColor="var(--skill-accent)"
                            borderWidth="2px"
                            boxShadow="0 1px 6px color-mix(in srgb, var(--skill-accent) 30%, transparent)"
                        >
                            <Slider.HiddenInput />
                        </Slider.Thumb>
                    </Slider.Control>
                </Slider.Root>

                <Flex justify="space-between" mt={2}>
                    {RISK_ZONES.map((z) => (
                        <Text
                            key={z.label}
                            fontSize="11px"
                            color={zoneOf(risk) === z.label ? "var(--skill-accent)" : "var(--ink-tertiary)"}
                            fontWeight={zoneOf(risk) === z.label ? 600 : 400}
                        >
                            {z.label}
                        </Text>
                    ))}
                </Flex>
            </Box>
        </Flex>
    )
}
