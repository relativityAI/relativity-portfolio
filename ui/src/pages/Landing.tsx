import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { dur, ease } from "@/lib/motion";
import logo from "@/assets/logo.png";
import screenshot from "@/assets/hero-screenshot.png";
import {
  LuFileText,
  LuScale,
  LuBuilding,
  LuMegaphone,
  LuMic,
  LuBadgeDollarSign,
  LuUsers,
  LuTarget,
  LuActivity,
  LuNewspaper,
  LuNetwork,
  LuShieldCheck,
} from "react-icons/lu";

const STEPS = [
  { n: "01", title: "Create your agent", sub: "Define your thesis in plain language" },
  { n: "02", title: "Evaluate & score stocks", sub: "Every stock is screened against your thesis" },
  { n: "03", title: "Get a FIT score", sub: "One number that shows how well you match" },
];

const SOURCES: Array<{ icon: typeof LuFileText; label: string }> = [
  { icon: LuFileText, label: "Financial statements" },
  { icon: LuScale, label: "Ratios & metrics" },
  { icon: LuBuilding, label: "Shareholding patterns" },
  { icon: LuMegaphone, label: "Filings" },
  { icon: LuMic, label: "Earnings calls" },
  { icon: LuBadgeDollarSign, label: "Corporate actions" },
  { icon: LuUsers, label: "Insider & block deals" },
  { icon: LuTarget, label: "Analyst estimates" },
  { icon: LuActivity, label: "Price & volume" },
  { icon: LuNewspaper, label: "News & sentiment" },
  { icon: LuNetwork, label: "Peer comparison" },
  { icon: LuShieldCheck, label: "Credit ratings" },
];

const stagger = {
  animate: { transition: { staggerChildren: 0.04 } },
};
const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
};

export default function Landing() {
  const navigate = useNavigate();
  const wordSplit = ["Customizable", "Agents", "for", "Stock", "Analysis"];

  return (
    <Flex h="100%" direction="column" overflow="hidden" position="relative">
      <Helmet>
        <title>Relativity AI — Customizable Agents for Stock Analysis</title>
        <meta name="description" content="Create your own research agents. They screen and analyze stocks against your thesis and return a single FIT Score — no trade calls, no recommendations." />
        <meta property="og:title" content="Relativity AI — Customizable Agents for Stock Analysis" />
        <meta property="og:description" content="Create research agents that analyze stocks against your thesis." />
      </Helmet>

      <Box
        position="absolute"
        top="-20%"
        left="-10%"
        w="40vw"
        h="40vw"
        borderRadius="full"
        background="radial-gradient(circle, var(--accent-primary) 0%, transparent 70%)"
        opacity={0.1}
        pointerEvents="none"
      />
      <Box
        position="absolute"
        bottom="-15%"
        right="-8%"
        w="34vw"
        h="34vw"
        borderRadius="full"
        background="radial-gradient(circle, var(--accent-primary) 0%, transparent 70%)"
        opacity={0.08}
        pointerEvents="none"
      />

      <Flex
        position="relative"
        zIndex={1}
        h="100%"
        direction="column"
        gap={{ base: 1, md: 2 }}
        px={{ base: 4, md: 10 }}
        pt={{ base: 2, md: 3 }}
        pb={{ base: 2, md: 3 }}
      >
        {/* Header */}
        <Flex align="center" justify="space-between" flexShrink={0}>
          <motion.a
            href="/"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease } }}
            style={{ display: "inline-block" }}
          >
            <Flex align="center" gap={2} bg="#0B0D10" border="1px solid var(--hairline)" px={2} py={1} borderRadius="xl">
              <img src={logo} alt="Relativity" width={22} height={22} style={{ borderRadius: 4 }} />
              <Text fontFamily="var(--font-mono)" fontWeight="bold" fontSize="xs" letterSpacing="0.18em" color="#EDEDEC" display={{ base: "none", sm: "block" }}>
                RELATIVITY
              </Text>
            </Flex>
          </motion.a>
          <Button size="sm" variant="subtle" onClick={() => navigate("/login")}>
            Log in
          </Button>
        </Flex>

        {/* Headline */}
        <motion.div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            paddingTop: "clamp(2px, 1vh, 12px)",
            paddingBottom: "clamp(4px, 1vh, 12px)",
          }}
        >
          <Text
            as="h1"
            fontSize="clamp(1.38rem, 3.6vw, 3rem)"
            lineHeight={1.06}
            fontWeight={800}
            letterSpacing="-0.03em"
            maxW="100%"
            textAlign="center"
            color="var(--ink-primary)"
          >
            {wordSplit.map((word, wi) => (
              <motion.span
                key={wi}
                style={{ display: "inline-block", whiteSpace: "nowrap", marginRight: "0.28em" }}
              >
                {word.split("").map((ch, ci) => (
                  <motion.span
                    key={ci}
                    style={{ display: "inline-block" }}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.12 + (ci + wi * 12) * 0.02 } }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.span>
            ))}
          </Text>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { duration: dur.slow, ease, delay: 0.75 } }}
          style={{ textAlign: "center" }}
        >
          <Button
            size="lg"
            variant="surface"
            colorPalette="blue"
            minH="44px"
            minW="160px"
            onClick={() => navigate("/login")}
            _hover={{ transform: "scale(1.02)", boxShadow: "0 10px 30px -10px var(--accent-primary)" }}
          >
            Get started
          </Button>
        </motion.div>

        {/* Main row: screenshot left, info right */}
        <Flex
          flex={1}
          minH={0}
          align="center"
          justify="center"
          gap={{ base: 2, md: 6 }}
          direction={{ base: "column", md: "row" }}
          overflowY={{ base: "auto", md: "hidden" }}
        >
          {/* Screenshot — single component, border wrapped directly on the image */}
          <Box
            as={motion.img}
            src={screenshot}
            alt="Relativity analysis result showing a FIT score and per-criterion evaluation"
            flex={{ base: "0 0 auto", md: "0 1 auto" }}
            minW={0}
            maxW={{ base: "100%", md: "60%" }}
            maxH={{ base: "16vh", md: "60vh" }}
            w="auto"
            h="auto"
            borderRadius="14px"
            border="1px solid var(--hairline)"
            boxShadow="0 20px 50px -20px rgba(0,0,0,0.35)"
            display="block"
            initial={{ opacity: 0, x: -20, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1, transition: { duration: dur.slow, ease, delay: 0.4 } }}
          />

          {/* Info column */}
          <Flex flex={1} minW={0} direction="column" gap={{ base: 2, md: 4 }} py={{ base: 1, md: 0 }}>
            {/* How it works */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.5 } }}>
              <Text
                fontFamily="var(--font-mono)"
                fontSize="10.5px"
                fontWeight={500}
                letterSpacing="0.14em"
                textTransform="uppercase"
                color="var(--ink-tertiary)"
                textAlign={{ base: "center", md: "left" }}
                mb={{ base: 2, md: 2.5 }}
              >
                How it works
              </Text>
              <Flex direction="column" gap={{ base: 2, md: 2.5 }}>
                {STEPS.map((s, i) => (
                  <motion.div key={s.n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.55 + i * 0.04 } }}>
                    <Flex
                      direction={{ base: "column", md: "row" }}
                      alignItems={{ base: "center", md: "flex-start" }}
                      gap={{ base: 0.5, md: 3 }}
                      textAlign={{ base: "center", md: "left" }}
                    >
                      <Text
                        fontFamily="var(--font-mono)"
                        fontSize={{ base: "10px", md: "xs" }}
                        fontWeight={600}
                        letterSpacing="0.08em"
                        color="var(--accent-primary)"
                        w={{ base: "auto", md: "22px" }}
                        flexShrink={0}
                        mt={{ md: 0.5 }}
                      >
                        {s.n}
                      </Text>
                      <Box>
                        <Text fontSize={{ base: "xs", md: "sm" }} fontWeight={600} color="var(--ink-primary)" lineHeight="short">
                          {s.title}
                        </Text>
                        <Text fontSize={{ base: "10px", md: "xs" }} color="var(--ink-secondary)" lineHeight="short" mt={0.5}>
                          {s.sub}
                        </Text>
                      </Box>
                    </Flex>
                  </motion.div>
                ))}
              </Flex>
            </motion.div>

            {/* Data sources */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.65 } }}>
              <Text
                fontFamily="var(--font-mono)"
                fontSize="10.5px"
                fontWeight={500}
                letterSpacing="0.14em"
                textTransform="uppercase"
                color="var(--ink-tertiary)"
                textAlign={{ base: "center", md: "left" }}
                mb={{ base: 1.5, md: 2 }}
              >
                Data sources
              </Text>
              <motion.div variants={stagger} initial="initial" animate="animate">
                <Flex flexWrap="wrap" justifyContent={{ base: "center", md: "flex-start" }} gap={{ base: 1, md: 1.5 }}>
                  {SOURCES.map((s) => (
                    <motion.div key={s.label} variants={fadeUp}>
                      <Flex
                        align="center"
                        gap={{ base: 1, md: 1.5 }}
                        borderRadius="full"
                        border="1px solid var(--hairline)"
                        bg="var(--surface-recessed)"
                        px={{ base: 2, md: 2.5 }}
                        py={{ base: 0.5, md: 1 }}
                      >
                        <s.icon size={10} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                        <Text fontSize={{ base: "10px", md: "11px" }} fontWeight="semibold" color="var(--ink-primary)" noOfLines={1} whiteSpace="nowrap">
                          {s.label}
                        </Text>
                      </Flex>
                    </motion.div>
                  ))}
                </Flex>
              </motion.div>
            </motion.div>
          </Flex>
        </Flex>

        {/* Disclaimer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.base, ease, delay: 0.8 } }} style={{ flexShrink: 0, textAlign: "center" }}>
          <Text fontFamily="var(--font-mono)" fontSize="10.5px" letterSpacing="0.06em" color="var(--ink-tertiary)">
            *Not investment advice · No trade calls, no recommendations
          </Text>
        </motion.div>
      </Flex>
    </Flex>
  );
}