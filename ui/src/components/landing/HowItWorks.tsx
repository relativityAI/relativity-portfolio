import { Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

const STEPS = [
  {
    n: "01",
    title: "Create your agent",
    sub: "Define your thesis in plain language",
    visual: (
      <Flex direction="column" gap={2} w="100%" maxW="280px">
        <Box border="1px solid var(--hairline)" borderRadius="md" bg="var(--surface-panel)" px={3} py={2}>
          <Text fontFamily="var(--font-mono)" fontSize="xs" color="var(--ink-tertiary)" lineHeight="short">
            "High-ROE businesses with consistent..."
          </Text>
        </Box>
        <Flex gap={1.5}>
          <Box borderRadius="full" bg="var(--accent-primary)" px={2} py={0.5}>
            <Text fontFamily="var(--font-mono)" fontSize="10px" color="white" fontWeight={500}>Create</Text>
          </Box>
          <Box borderRadius="full" border="1px solid var(--hairline)" px={2} py={0.5}>
            <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)">Cancel</Text>
          </Box>
        </Flex>
      </Flex>
    ),
  },
  {
    n: "02",
    title: "Evaluate & score stocks",
    sub: "Every stock is screened against your thesis",
    visual: (
      <Flex direction="column" gap={1.5} w="100%" maxW="280px">
        {["TCS", "INFY", "HDFCBANK", "RELIANCE", "TATASTEEL"].map((t, i) => (
          <Flex key={t} align="center" justify="space-between" border="1px solid var(--hairline)" borderRadius="md" bg="var(--surface-panel)" px={3} py={1.5}>
            <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={600} color="var(--ink-primary)">{t}</Text>
            <Flex align="center" gap={2}>
              <Box w={{ base: "40px", md: "60px" }} h={1.5} borderRadius="full" bg="var(--surface-recessed)" overflow="hidden">
                <Box h="100%" borderRadius="full" bg="var(--accent-primary)" w={`${60 + i * 8}%`} opacity={0.4 + i * 0.1} />
              </Box>
              <Text fontFamily="var(--font-mono)" fontSize="10px" fontWeight={600} color="var(--ink-tertiary)">{(72 + i * 4.2).toFixed(1)}</Text>
            </Flex>
          </Flex>
        ))}
      </Flex>
    ),
  },
  {
    n: "03",
    title: "Get a FIT score",
    sub: "One number that shows how well you match",
    visual: (
      <Flex direction="column" align="center" gap={2} w="100%" maxW="200px">
        <Box border="1px solid var(--hairline)" borderRadius="xl" bg="var(--surface-panel)" px={5} py={4} textAlign="center">
          <Text fontFamily="var(--font-mono)" fontSize="sm" fontWeight={600} color="var(--ink-primary)" mb={1}>HDFCBANK</Text>
          <Text fontFamily="var(--font-mono)" fontSize={{ base: "3xl", md: "4xl" }} fontWeight={800} color="var(--accent-primary)" lineHeight={1} letterSpacing="-0.03em">92.1</Text>
          <Text fontFamily="var(--font-mono)" fontSize="xs" color="var(--ink-tertiary)" mt={1}>FIT Score</Text>
        </Box>
      </Flex>
    ),
  },
];

export default function HowItWorks() {
  return (
    <Flex direction="column" gap={{ base: 16, md: 20 }}>
      {STEPS.map((step, i) => {
        const isReversed = i === 1;
        const isCentered = i === 2;

        return (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: dur.base, ease }}
          >
            <Flex
              direction={{ base: "column", md: isCentered ? "column" : "row" }}
              align={{ base: "stretch", md: "center" }}
              justify={{ base: "stretch", md: "center" }}
              gap={{ base: 8, md: 12 }}
              textAlign={isCentered ? "center" : "left"}
            >
              <Flex
                direction="column"
                gap={3}
                flex={1}
                order={{ base: 1, md: isReversed ? 2 : 1 }}
                align={isCentered ? "center" : "flex-start"}
              >
                <Text fontFamily="var(--font-mono)" fontSize="sm" fontWeight={600} letterSpacing="0.08em" color="var(--accent-primary)">
                  {step.n}
                </Text>
                <Text as="h3" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
                  {step.title}
                </Text>
                <Text fontSize={{ base: "sm", md: "md" }} color="var(--ink-secondary)" lineHeight="relaxed" maxW="420px">
                  {step.sub}
                </Text>
              </Flex>

              <Flex
                flex={1}
                justify="center"
                align="center"
                order={{ base: 2, md: isReversed ? 1 : 2 }}
              >
                {step.visual}
              </Flex>
            </Flex>
          </motion.div>
        );
      })}
    </Flex>
  );
}
