import { useState } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

type Preset = {
  id: string;
  name: string;
  tagline: string;
  horizon: string;
  risk: number;
  qual: { label: string; weight: number }[];
  quant: { metric: string; rule: string; weight: number }[];
};

const PRESETS: Preset[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    tagline: "Great businesses at a fair price, held for years",
    horizon: "Long-term",
    risk: 4,
    qual: [
      { label: "Economic moat", weight: 9 },
      { label: "Margin of safety", weight: 9 },
      { label: "Management integrity", weight: 8 },
    ],
    quant: [
      { metric: "Return on Equity", rule: "> 15%", weight: 8 },
      { metric: "Debt to Equity", rule: "< 0.5", weight: 7 },
      { metric: "P/E Ratio", rule: "< 25", weight: 6 },
    ],
  },
  {
    id: "oneil",
    name: "William O'Neil",
    tagline: "CAN SLIM — buy leaders breaking out, cut losses fast",
    horizon: "Positional",
    risk: 8,
    qual: [
      { label: "Current quarterly earnings", weight: 9 },
      { label: "New catalyst", weight: 8 },
      { label: "Leader vs laggard", weight: 8 },
    ],
    quant: [
      { metric: "EPS Growth", rule: "> 25%", weight: 9 },
      { metric: "RSI (14)", rule: "\u2265 55", weight: 5 },
      { metric: "SMA 200", rule: "> 0", weight: 6 },
    ],
  },
  {
    id: "garp",
    name: "GARP (Lynch / Fisher)",
    tagline: "Growth at a reasonable price — compounders, not story stocks",
    horizon: "Positional",
    risk: 7,
    qual: [
      { label: "Growth I can understand", weight: 9 },
      { label: "Pricing power", weight: 8 },
      { label: "Capital discipline", weight: 7 },
    ],
    quant: [
      { metric: "PEG Ratio", rule: "< 1.5", weight: 9 },
      { metric: "Gross Margin", rule: "> 50%", weight: 7 },
      { metric: "Revenue Growth", rule: "> 15%", weight: 8 },
    ],
  },
];

function usePreset(id: string) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

function CriteriaPanel({ preset }: { preset: Preset }) {
  return (
    <motion.div
      key={preset.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: dur.base, ease }}
    >
      <Flex direction="column" gap={5}>
        {/* Qualitative checklist */}
        <Flex direction="column" gap={2}>
          <Text fontFamily="var(--font-mono)" fontSize="10px" fontWeight={600} letterSpacing="0.12em" color="var(--ink-tertiary)">
            QUALITATIVE — SCORED AS A CHECKLIST
          </Text>
          {preset.qual.map((q, i) => (
            <Flex key={q.label} align="center" justify="space-between" gap={3} py={2} borderTop="1px solid var(--hairline)">
              <Flex align="center" gap={2.5} minW={0}>
                <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)" w="16px" flexShrink={0}>
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text fontSize="sm" fontWeight={500} color="var(--ink-primary)" truncate>
                  {q.label}
                </Text>
              </Flex>
              <Flex align="center" gap={2} flexShrink={0}>
                <Flex gap="3px" aria-label={`weight ${q.weight} of 10`}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <Box
                      key={j}
                      w="3px"
                      h="10px"
                      borderRadius="1px"
                      bg={j < q.weight ? "var(--accent-primary)" : "var(--surface-recessed)"}
                      border={j < q.weight ? "none" : "1px solid var(--hairline)"}
                    />
                  ))}
                </Flex>
                <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)" w="18px" textAlign="right">
                  {q.weight}
                </Text>
              </Flex>
            </Flex>
          ))}
        </Flex>

        {/* Quantitative rules */}
        <Flex direction="column" gap={2}>
          <Text fontFamily="var(--font-mono)" fontSize="10px" fontWeight={600} letterSpacing="0.12em" color="var(--ink-tertiary)">
            QUANTITATIVE — DETERMINISTIC GATES
          </Text>
          {preset.quant.map((q) => (
            <Flex key={q.metric} align="center" justify="space-between" gap={3} py={2} borderTop="1px solid var(--hairline)">
              <Text fontSize="sm" fontWeight={500} color="var(--ink-primary)" truncate>
                {q.metric}
              </Text>
              <Flex align="center" gap={3} flexShrink={0}>
                <Text
                  fontFamily="var(--font-mono)"
                  fontSize="xs"
                  fontWeight={600}
                  color="var(--accent-primary)"
                  bg="var(--surface-recessed)"
                  border="1px solid var(--hairline)"
                  borderRadius="sm"
                  px={2}
                  py={0.5}
                >
                  {q.rule}
                </Text>
                <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)" w="26px" textAlign="right">
                  w {q.weight}
                </Text>
              </Flex>
            </Flex>
          ))}
        </Flex>
      </Flex>
    </motion.div>
  );
}

export default function AgentShowcase() {
  const [activeId, setActiveId] = useState(PRESETS[0].id);
  const preset = usePreset(activeId);

  return (
    <Flex direction="column" gap={{ base: 6, md: 8 }}>
      <Flex direction="column" gap={2} maxW="560px">
        <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={600} letterSpacing="0.12em" color="var(--accent-primary)">
          START FROM A LEGEND
        </Text>
        <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
          Or borrow a proven investing style
        </Text>
        <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-secondary)" lineHeight="relaxed">
          Every agent — preset or custom — is a readable spec: qualitative criteria scored as checklists, quantitative rules
          enforced by code. Nothing hidden.
        </Text>
      </Flex>

      <Flex
        direction={{ base: "column", md: "row" }}
        gap={{ base: 6, md: 10 }}
        align={{ base: "stretch", md: "flex-start" }}
      >
        {/* Preset selector */}
        <Flex direction="column" gap={2} flex={1} minW={0}>
          {PRESETS.map((p) => {
            const active = p.id === activeId;
            return (
              <Box
                key={p.id}
                as="button"
                textAlign="left"
                onClick={() => setActiveId(p.id)}
                cursor="pointer"
                border="1px solid"
                borderColor={active ? "var(--accent-primary)" : "var(--hairline)"}
                bg={active ? "var(--surface-panel)" : "transparent"}
                borderRadius="lg"
                px={4}
                py={3}
                transition="border-color 0.2s, background 0.2s"
                _hover={{ borderColor: active ? "var(--accent-primary)" : "var(--grid-line)" }}
                _active={{ transform: "scale(0.985)" }}
              >
                <Flex align="center" justify="space-between" gap={3} mb={1}>
                  <Text fontSize="sm" fontWeight={700} color={active ? "var(--accent-primary)" : "var(--ink-primary)"}>
                    {p.name}
                  </Text>
                  <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)">
                    {p.horizon} · risk {p.risk}/10
                  </Text>
                </Flex>
                <Text fontSize="xs" color="var(--ink-secondary)" lineHeight="short">
                  {p.tagline}
                </Text>
              </Box>
            );
          })}
        </Flex>

        {/* Criteria preview */}
        <Box
          flex={1.4}
          minW={0}
          border="1px solid var(--hairline)"
          borderRadius="xl"
          bg="var(--surface-panel)"
          px={{ base: 4, md: 6 }}
          py={{ base: 4, md: 5 }}
        >
          <AnimatePresence mode="wait">
            <CriteriaPanel preset={preset} />
          </AnimatePresence>
        </Box>
      </Flex>
    </Flex>
  );
}
