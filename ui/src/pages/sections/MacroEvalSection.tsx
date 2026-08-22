import { useState } from "react"
import { Flex, Text, Box } from "@chakra-ui/react"
import { motion, AnimatePresence } from "motion/react"
import { dur, ease } from "@/lib/motion"
import AgentDataQualitative from "../AgentQualitative"
import AgentQuantitative from "../AgentQuantitative"
import SectionHeader from "../shared/SectionHeader"

interface MacroEvalSectionProps {
    qualitative: any[];
    onQualitativeUpdate: (data: any[]) => void;
    quantitative: any[];
    onQuantitativeUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
}

const SUB_TABS = [
    {
        id: "qualitative" as const,
        label: "Qualitative",
        description: "Text-based judgment calls on macro conditions and their implications.",
    },
    {
        id: "quantitative" as const,
        label: "Quantitative",
        description: "Metric-driven quantitative criteria at the macro level.",
    },
]

export default function MacroEvalSection({
    qualitative,
    onQualitativeUpdate,
    quantitative,
    onQuantitativeUpdate,
    id,
    name,
    metrics,
    source,
}: MacroEvalSectionProps) {
    const [sub, setSub] = useState<"qualitative" | "quantitative">("qualitative")
    const activeTab = SUB_TABS.find((t) => t.id === sub)!
    const counts = { qualitative: qualitative.length, quantitative: quantitative.length }

    return (
        <>
            <SectionHeader
                first
                title="Macro Evaluation"
                description="Reads the wider environment a stock operates in, at the market or sector level."
                sequenceNumber={4}
            />

            <Flex gap={1} borderBottom="1px solid var(--hairline)" mb={5}>
                {SUB_TABS.map((t) => (
                    <Box key={t.id} position="relative" px={3} py={2} cursor="pointer" role="tab" aria-selected={sub === t.id} onClick={() => setSub(t.id)}>
                        {sub === t.id && (
                            <motion.span
                                layoutId="eval-subtab-macro"
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                                style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: "2px", background: "var(--accent-primary)" }}
                            />
                        )}
                        <Text fontSize="13px" fontWeight={sub === t.id ? 600 : 400} color={sub === t.id ? "var(--ink-primary)" : "var(--ink-secondary)"}>
                            {t.label}
                            <Text as="span" fontFamily="var(--font-mono)" fontSize="11px" color="var(--ink-tertiary)" ml={1.5}>
                                {counts[t.id]}
                            </Text>
                        </Text>
                    </Box>
                ))}
            </Flex>

            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={sub}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: dur.fast, ease }}
                >
                    <Text fontSize="12.5px" color="var(--ink-secondary)" lineHeight="relaxed" mb={4}>
                        {activeTab.description}
                    </Text>
                    {sub === "qualitative" ? (
                        <AgentDataQualitative name={name} data={qualitative} id={id} metrics={metrics} onUpdate={onQualitativeUpdate} />
                    ) : (
                        <AgentQuantitative name={name} data={quantitative} id={id} metrics={metrics} source={source} onUpdate={onQuantitativeUpdate} />
                    )}
                </motion.div>
            </AnimatePresence>
        </>
    )
}
