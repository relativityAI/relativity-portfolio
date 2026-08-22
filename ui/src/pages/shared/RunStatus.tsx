import { Box, Flex, Text, Spinner, HStack, VStack } from "@chakra-ui/react";
import { MdCheck, MdClose } from "react-icons/md";
import { formatSeconds } from "@/utils";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface RunStep {
    key: string;
    label: string;
    status: StepStatus;
    started_at: string | null;
    finished_at: string | null;
    duration_ms: number | null;
    detail?: string;
}

function formatMs(ms: number | null | undefined): string {
    if (ms == null) return "";
    return formatSeconds(Math.round(ms / 1000));
}

function StepIcon({ status }: { status: StepStatus }) {
    if (status === "running") {
        return <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />;
    }
    if (status === "completed") {
        return (
            <Flex
                as={motion.div}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
                w="16px"
                h="16px"
                borderRadius="50%"
                align="center"
                justify="center"
                bg="var(--signal-positive)"
                flexShrink={0}
            >
                <MdCheck size={11} color="#fff" />
            </Flex>
        );
    }
    if (status === "failed") {
        return (
            <Flex
                as={motion.div}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
                w="16px"
                h="16px"
                borderRadius="50%"
                align="center"
                justify="center"
                bg="var(--signal-negative)"
                flexShrink={0}
            >
                <MdClose size={11} color="#fff" />
            </Flex>
        );
    }
    return (
        <Flex
            w="16px"
            h="16px"
            borderRadius="50%"
            align="center"
            justify="center"
            border={status === "skipped" ? "1px solid var(--hairline)" : "2px solid var(--hairline)"}
            flexShrink={0}
            opacity={status === "pending" ? 1 : 0.6}
        >
            {status === "skipped" && <Box w="6px" h="1.5px" bg="var(--ink-tertiary)" />}
        </Flex>
    );
}

function StepRow({ step, now }: { step: RunStep; now: number }) {
    const elapsedMs =
        step.status === "running" && step.started_at
            ? now - +new Date(step.started_at)
            : step.duration_ms;
    const timeLabel =
        step.status === "running" || step.status === "completed" || step.status === "failed"
            ? formatMs(elapsedMs)
            : "";

    const labelColor =
        step.status === "running"
            ? "var(--ink-primary)"
            : step.status === "completed" || step.status === "skipped"
                ? "var(--ink-secondary)"
                : step.status === "failed"
                    ? "var(--signal-negative)"
                    : "var(--ink-tertiary)";

    return (
        <Flex as={motion.div} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }} gap={2.5} align="flex-start">
            <Box mt="1px">
                <StepIcon status={step.status} />
            </Box>
            <Flex direction="column" gap={0.5} flex={1} minW={0}>
                <HStack gap={2} justify="space-between" align="baseline">
                    <Text fontSize="12.5px" fontWeight={500} color={labelColor} lineHeight="short">
                        {step.label}
                    </Text>
                    {timeLabel && (
                        <Text
                            fontSize="11px"
                            fontFamily="var(--font-tabular)"
                            fontVariantNumeric="tabular-nums"
                            color={step.status === "running" ? "var(--ink-secondary)" : "var(--ink-tertiary)"}
                            whiteSpace="nowrap"
                        >
                            {step.status === "running" ? `${timeLabel} …` : timeLabel}
                        </Text>
                    )}
                </HStack>
                {step.detail && (
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" lineHeight="short">
                        {step.detail}
                    </Text>
                )}
                {step.status === "pending" && !step.detail && (
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" lineHeight="short">
                        Queued
                    </Text>
                )}
            </Flex>
        </Flex>
    );
}

export function RunSteps({ steps, now }: { steps: RunStep[]; now: number }) {
    if (!steps || steps.length === 0) {
        return (
            <HStack gap={1.5}>
                <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                <Text fontSize="12px" color="var(--ink-secondary)">
                    Running analysis…
                </Text>
            </HStack>
        );
    }
    return (
        <VStack gap={3.5} align="stretch">
            {steps.map((s) => (
                <StepRow key={s.key} step={s} now={now} />
            ))}
        </VStack>
    );
}
