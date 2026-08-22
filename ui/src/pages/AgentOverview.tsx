import { Flex, Text, Box } from "@chakra-ui/react"
import { MdChevronRight } from "react-icons/md"
import { motion } from "motion/react"
import { dur, ease, stagger, staggerItem, CountUp } from "@/lib/motion"

interface OverviewSection {
  id: string;
  label: string;
  summary: string;
  hasContent: boolean;
}

interface AgentOverviewProps {
  agentName: string;
  isDirty: boolean;
  sections: OverviewSection[];
  onNavigate: (section: string) => void;
}

export default function AgentOverview({ agentName, sections, onNavigate }: AgentOverviewProps) {
  const done = sections.filter((s) => s.hasContent).length
  const pct = Math.round((done / sections.length) * 100)

  return (
    <Flex direction="column" gap={7}>
      <motion.div variants={staggerItem} transition={{ duration: dur.base, ease }}>
        <Text fontSize="13px" color="var(--ink-secondary)" mb={4}>
          An agent needs all four parts defined before it can run an analysis. Jump to any section — order matters.
        </Text>
        <Flex align="flex-end" gap={4}>
          <Text
            fontFamily="var(--font-mono)"
            fontSize="56px"
            fontWeight={600}
            lineHeight="1"
            letterSpacing="-0.03em"
            color="var(--ink-primary)"
          >
            <CountUp value={pct} decimals={0} />
            <Text as="span" fontSize="28px" color="var(--ink-tertiary)">%</Text>
          </Text>
          <Box flex={1} pb={2} minW={0}>
            <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mb={2} letterSpacing="0.05em">
              {done}/{sections.length} SECTIONS COMPLETE
            </Text>
            <Flex h="3px" bg="var(--surface-recessed)" borderRadius="2px" overflow="hidden">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: pct / 100 }}
                style={{ originX: 0, width: "100%", height: "100%", background: "var(--accent-primary)", borderRadius: "2px" }}
                transition={{ duration: dur.slow, ease }}
              />
            </Flex>
          </Box>
        </Flex>
      </motion.div>

      <Flex direction="column" gap={2} as={motion.div} variants={stagger} initial="initial" animate="animate">
        {sections.map((section, i) => (
          <Box
            key={section.id}
            as={motion.div}
            variants={staggerItem}
            whileHover={{ y: -2 }}
            transition={{ duration: dur.fast, ease }}
            onClick={() => onNavigate(section.id)}
            cursor="pointer"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onNavigate(section.id)
              }
            }}
            border="1px solid var(--hairline)"
            borderRadius="4px"
            bg="var(--surface-panel)"
            px={4}
            py={3.5}
            _hover={{ borderColor: "var(--accent-primary)" }}
            display="flex"
            align="center"
            gap={3.5}
          >
            <Text
              fontFamily="var(--font-mono)"
              fontSize="11px"
              fontWeight={500}
              color={section.hasContent ? "var(--signal-positive)" : "var(--ink-tertiary)"}
              flexShrink={0}
            >
              {String(i + 1).padStart(2, "0")}
            </Text>
            <Box flex={1} minW={0}>
              <Text fontSize="14px" fontWeight={600} color="var(--ink-primary)">
                {section.label}
              </Text>
              <Text fontSize="12px" color="var(--ink-tertiary)" truncate>
                {section.summary}
              </Text>
            </Box>
            <MdChevronRight size={16} color="var(--ink-tertiary)" style={{ flexShrink: 0 }} />
          </Box>
        ))}
      </Flex>
    </Flex>
  )
}
