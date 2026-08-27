import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { MdCheck } from "react-icons/md";

export interface BuilderStep {
  label: string;
  detail?: string;
  links?: { label: string; url: string }[];
  status: "pending" | "active" | "done";
}

interface StepsTraceProps {
  steps: BuilderStep[];
}

function StepRow({ step }: { step: BuilderStep }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: dur.fast, ease }}
    >
      <Flex align="flex-start" gap={2}>
        <Flex w="14px" justify="center" flexShrink={0} mt="2px">
          {step.status === "done" ? (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 24 }}
              style={{ display: "inline-flex" }}
            >
              <MdCheck size={11} color="var(--signal-positive)" />
            </motion.div>
          ) : step.status === "active" ? (
            <Spinner size="xs" color="var(--ink-secondary)" />
          ) : (
            <Box w="9px" h="9px" borderRadius="50%" border="1px solid var(--hairline)" />
          )}
        </Flex>
        <Flex direction="column" minW={0} flex={1}>
          <Text
            fontSize="12px"
            lineHeight="1.5"
            color={step.status === "pending" ? "var(--ink-tertiary)" : "var(--ink-primary)"}
          >
            {step.label}
          </Text>
          {step.links && step.links.length > 0 && (
            <Flex direction="column" gap={0.5} mt={1}>
              {step.links.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "11px",
                    lineHeight: "1.35",
                    color: "var(--ink-secondary)",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  {l.label}
                </a>
              ))}
            </Flex>
          )}
          {step.detail && (
            <Text
              fontSize="11px"
              lineHeight="1.4"
              color="var(--ink-tertiary)"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
            >
              {step.detail}
            </Text>
          )}
        </Flex>
      </Flex>
    </motion.div>
  );
}

export default function StepsTrace({ steps }: StepsTraceProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base, ease }}
    >
      <Box
        border="1px solid var(--hairline)"
        borderRadius="4px"
        bg="var(--surface-panel)"
        px={3}
        py={2.5}
      >
        <Text
          fontSize="10px"
          fontWeight={600}
          color="var(--ink-tertiary)"
          letterSpacing="0.04em"
          textTransform="uppercase"
          mb={1.5}
        >
          Agent activity
        </Text>
        <Flex direction="column" gap={1.5}>
          {steps.map((step) => (
            <StepRow key={step.label} step={step} />
          ))}
        </Flex>
      </Box>
    </motion.div>
  );
}