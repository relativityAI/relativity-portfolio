import { Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

const ITEMS = [
  {
    title: "Not investment advice.",
    body: "Relativity AI provides research tools and scoring. It does not tell you what to buy or sell.",
  },
  {
    title: "No trade calls.",
    body: "You decide what to do with the score. The platform does not place orders or recommend actions.",
  },
  {
    title: "No hidden ranking.",
    body: "Every criterion in the FIT score is visible. There is no black-box weighting or opaque ranking.",
  },
];

export default function TrustBlock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: dur.base, ease }}
    >
      <Flex direction="column" gap={6}>
        <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
          What this is not
        </Text>
        {/* Divided rows instead of card grid — separation via 1px lines, not boxes */}
        <Flex direction="column">
          {ITEMS.map((item) => (
            <Flex
              key={item.title}
              direction={{ base: "column", md: "row" }}
              gap={{ base: 1, md: 8 }}
              align={{ base: "stretch", md: "baseline" }}
              py={{ base: 4, md: 5 }}
              borderTop="1px solid var(--hairline)"
            >
              <Text
                fontSize={{ base: "md", md: "lg" }}
                fontWeight={600}
                color="var(--ink-primary)"
                lineHeight="short"
                flex={{ md: "0 0 240px" }}
              >
                {item.title}
              </Text>
              <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-secondary)" lineHeight="relaxed" maxW="60ch">
                {item.body}
              </Text>
            </Flex>
          ))}
          <Box borderTop="1px solid var(--hairline)" />
        </Flex>
      </Flex>
    </motion.div>
  );
}
