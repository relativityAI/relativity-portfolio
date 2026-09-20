import { useState } from "react";
import { Box, Flex, Text, Spinner, Button } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { type, tap } from "@/lib/tokens";
import { MdCheck, MdExpandMore, MdKeyboardArrowDown, MdKeyboardArrowRight } from "react-icons/md";

export interface BuilderStep {
  label: string;
  detail?: string;
  links?: { label: string; url: string }[];
  status: "pending" | "active" | "done";
}

function StepRow({ step }: { step: BuilderStep }) {
  return (
    <Flex align="flex-start" gap={2}>
      <Flex w="14px" justify="center" flexShrink={0} mt="2px">
        {step.status === "done" ? (
          <MdCheck size={11} color="var(--signal-positive)" />
        ) : step.status === "active" ? (
          <Spinner size="xs" color="var(--ink-secondary)" />
        ) : (
          <Box w="9px" h="9px" borderRadius="50%" border="1px solid var(--hairline)" />
        )}
      </Flex>
      <Flex direction="column" minW={0} flex={1}>
        <Text
          fontSize={type.meta}
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
                  fontSize: type.micro,
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
            fontSize={type.micro}
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
  );
}

export default function StepsTrace({ steps }: { steps: BuilderStep[] }) {
  return (
    <Box
      border="1px solid var(--hairline)"
      borderRadius="4px"
      bg="var(--surface-panel)"
      px={3}
      py={2.5}
    >
      <Text
        fontSize={type.micro}
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
  );
}

/** Collapsed historical trace — lets users revisit "how the AI built this". */
export function TraceBlock({ title, steps }: { title: string; steps: BuilderStep[] }) {
  const [open, setOpen] = useState(false);
  const done = steps.filter((s) => s.status === "done").length;

  return (
    <Box border="1px solid var(--hairline)" borderRadius="4px" bg="var(--surface-panel)">
      <Button
        variant="ghost"
        w="full"
        justifyContent="flex-start"
        gap={2}
        minH={`${tap}px`}
        h="auto"
        py={2}
        px={3}
        fontSize={type.body}
        fontWeight={500}
        color="var(--ink-secondary)"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="trace-content"
      >
        {open ? <MdKeyboardArrowDown size={18} /> : <MdKeyboardArrowRight size={18} />}
        <Box flex={1} textAlign="left" minW={0}>
          <Text as="span" fontWeight={600} color="var(--ink-primary)">{title}</Text>
          <Text as="span" color="var(--ink-tertiary)" ml={2}>
            {done} step{done === 1 ? "" : "s"}
          </Text>
        </Box>
        <MdExpandMore size={14} color="var(--ink-tertiary)" />
      </Button>
      {open && (
        <motion.div
          id="trace-content"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur.fast, ease }}
          style={{ padding: "0 16px 12px" }}
        >
          <Flex direction="column" gap={1.5}>
            {steps.map((step) => (
              <StepRow key={step.label} step={step} />
            ))}
          </Flex>
        </motion.div>
      )}
    </Box>
  );
}