import { Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import screenshot from "@/assets/hero-screenshot.png";

export default function ProofSection() {
  return (
    <Box bg="var(--surface-inverse)" borderRadius="2xl" overflow="hidden">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-15%" }}
        transition={{ duration: dur.slow, ease }}
      >
        <Flex
          direction={{ base: "column", md: "row" }}
          align={{ base: "stretch", md: "center" }}
          gap={{ base: 8, md: 12 }}
          px={{ base: 6, md: 12 }}
          py={{ base: 10, md: 14 }}
        >
          <Flex direction="column" gap={4} flex={1}>
            <Text as="h2" fontSize={{ base: "2xl", md: "3xl" }} fontWeight={700} color="var(--ink-inverse-primary)" lineHeight="tight">
              One thesis. A full read on every stock that matches it.
            </Text>
            <Flex direction="column" gap={3}>
              <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-inverse-secondary)" lineHeight="relaxed">
                Your agent reads financial statements, shareholding patterns, filings, and earnings calls — then scores every stock on how well it fits your thesis.
              </Text>
              <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-inverse-secondary)" lineHeight="relaxed">
                Each FIT score comes with visible criteria so you can see exactly why a stock scored the way it did.
              </Text>
            </Flex>
          </Flex>

          <Flex flex={1} justify="center" align="center">
            <Box
              as={motion.img}
              src={screenshot}
              alt="Relativity analysis result showing a FIT score and per-criterion evaluation"
              maxW={{ base: "100%", md: "420px" }}
              w="100%"
              h="auto"
              borderRadius="xl"
              border="1px solid var(--grid-line)"
              boxShadow="0 20px 60px -15px rgba(0,0,0,0.5)"
              display="block"
            />
          </Flex>
        </Flex>
      </motion.div>
    </Box>
  );
}
