import { Accordion, Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

const FAQS = [
  {
    q: "Which markets and exchanges are covered?",
    a: "We currently cover Indian equities across NSE and BSE, including mid-caps and small-caps. More markets are on the roadmap.",
  },
  {
    q: "Where does the data come from?",
    a: "Financial statements, shareholding patterns, filings, earnings calls, corporate actions, insider and block deals, analyst estimates, price and volume data, news and sentiment, peer comparison, and credit ratings.",
  },
  {
    q: "Is this a broker? Does it place trades?",
    a: "No. Relativity AI is a research and screening tool. It does not place trades, hold cash, or interface with any broker.",
  },
  {
    q: "What does an agent mean here?",
    a: "An agent is a screening and analysis process you configure. You define a thesis in plain language, and the agent evaluates stocks against it.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes. You can create agents and run analyses with no API keys required. Certain data sources may need you to supply your own API key.",
  },
];

export default function LandingFaq() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: dur.base, ease }}
    >
      <Flex direction="column" gap={4}>
        <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
          Frequently asked questions
        </Text>
        <Accordion.Root variant="plain" collapsible>
          {FAQS.map((f) => (
            <Accordion.Item key={f.q} value={f.q} borderBottom="1px solid var(--hairline)">
              <Accordion.ItemTrigger py={4} _hover={{ color: "var(--accent-primary)" }}>
                <Text flex={1} fontSize={{ base: "sm", md: "md" }} fontWeight={600} color="var(--ink-primary)" textAlign="left">
                  {f.q}
                </Text>
                <Accordion.ItemIndicator color="var(--ink-tertiary)" />
              </Accordion.ItemTrigger>
              <Accordion.ItemContent pb={4}>
                <Box>
                  <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-secondary)" lineHeight="relaxed">
                    {f.a}
                  </Text>
                </Box>
              </Accordion.ItemContent>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </Flex>
    </motion.div>
  );
}