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
      <Flex direction="column" gap={4}>
        <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
          What this is not
        </Text>
        <Flex
          direction={{ base: "column", md: "row" }}
          gap={{ base: 6, md: 8 }}
        >
          {ITEMS.map((item) => (
            <Box key={item.title} flex={1}>
              <Text fontSize={{ base: "md", md: "lg" }} fontWeight={600} color="var(--ink-primary)" lineHeight="short" mb={2}>
                {item.title}
              </Text>
              <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-secondary)" lineHeight="relaxed">
                {item.body}
              </Text>
            </Box>
          ))}
        </Flex>
      </Flex>
    </motion.div>
  );
}
