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
  LuUsers,
  LuMic,
  LuBadgeDollarSign,
  LuActivity,
  LuNewspaper,
  LuNetwork,
  LuShieldCheck,
  LuMegaphone,
  LuBuilding,
  LuTarget,
  LuCheck,
} from "react-icons/lu";

const STEPS = [
  { n: "01", title: "Create your agent", sub: "Define your investment thesis in plain language." },
  { n: "02", title: "Let it evaluate stocks", sub: "The agent screens and analyzes against your thesis." },
  { n: "03", title: "Get a FIT Score", sub: "One score showing how well a stock matches you." },
];

const SOURCES: Array<{ icon: typeof LuFileText; label: string; hint: string }> = [
  { icon: LuFileText, label: "Financial statements", hint: "income, balance, cash flow" },
  { icon: LuScale, label: "Ratios & metrics", hint: "valuation, profitability, leverage" },
  { icon: LuBuilding, label: "Shareholding patterns", hint: "promoter, institutional, public" },
  { icon: LuMegaphone, label: "Announcements & filings", hint: "corporate disclosures" },
  { icon: LuMic, label: "Earnings call transcripts", hint: "management commentary" },
  { icon: LuBadgeDollarSign, label: "Corporate actions", hint: "dividends, splits, bonuses" },
  { icon: LuUsers, label: "Insider & block deals", hint: "bulk transactions" },
  { icon: LuTarget, label: "Analyst estimates", hint: "targets & forecasts" },
  { icon: LuActivity, label: "Price & volume history", hint: "live and historical" },
  { icon: LuNewspaper, label: "News & sentiment", hint: "web and press coverage" },
  { icon: LuNetwork, label: "Peer comparison", hint: "industry positioning" },
  { icon: LuShieldCheck, label: "Credit ratings", hint: "where applicable" },
];

const TRUST = ["Real-time filings", "Exchange-sourced", "Institutional-grade"];

const stack = {
  animate: { transition: { staggerChildren: 0.1, delayChildren: 0.08 } },
};

const riseShort = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
};

export default function Landing() {
  const navigate = useNavigate();

  const wordSplit = ["Customizable", "Agents", "for", "Stock", "Analysis"];

  return (
    <Flex
      h="100%"
      direction="column"
      overflow="hidden"
      position="relative"
    >
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
        flex={1}
        minH={0}
        direction="column"
        px={{ base: 4, md: 8 }}
        py={{ base: 3, md: 3 }}
      >
        {/* Header / logo row */}
        <Flex align="center" justify="space-between" minH="40px" flexShrink={0}>
          <motion.a href="/" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease } }} style={{ display: "inline-block" }}>
            <Flex
              align="center"
              gap={2}
              borderRadius="xl"
              bg="#0B0D10"
              border="1px solid var(--hairline)"
              px={2}
              py={1}
            >
              <img src={logo} alt="Relativity" width={22} height={22} style={{ borderRadius: 4 }} />
              <Text fontFamily="var(--font-mono)" fontWeight="bold" fontSize="xs" letterSpacing="0.18em" color="#EDEDEC" display={{ base: "none", sm: "block" }}>
                RELATIVITY
              </Text>
            </Flex>
          </motion.a>
          <Flex gap={3} align="center">
            <Button size="sm" variant="subtle" onClick={() => navigate("/login")}>
              Log in
            </Button>
          </Flex>
        </Flex>

        <Flex flex={1} minH={0} direction="column">
        {/* Headline block */}
        <motion.div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            paddingTop: "clamp(8px, 1.4vh, 18px)",
            paddingBottom: "clamp(6px, 1vh, 12px)",
          }}
        >
          <Text
            as="h1"
            fontSize="clamp(1.6rem, 4.4vw, 3.1rem)"
            lineHeight={1.08}
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
                    animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.15 + (ci + wi * 12) * 0.02 } }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.span>
            ))}
          </Text>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur.slow, ease, delay: 0.7 } }}
            style={{
              fontSize: "clamp(0.9rem, 1.6vw, 1.1rem)",
              fontWeight: 400,
              color: "var(--ink-secondary)",
              maxWidth: 600,
              marginTop: "clamp(8px, 1.6vh, 16px)",
            }}
          >
            Save hours and days of research.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur.slow, ease, delay: 0.85 } }}
            style={{ marginTop: "clamp(14px, 2.4vh, 24px)" }}
          >
            <Button
              size="lg"
              variant="surface"
              colorPalette="blue"
              minH="48px"
              minW="168px"
              onClick={() => navigate("/login")}
              _hover={{ transform: "scale(1.02)", boxShadow: "0 10px 30px -10px var(--accent-primary)" }}
            >
              Get started
            </Button>
            <Text
              mt={2}
              textAlign="center"
              fontFamily="var(--font-mono)"
              fontSize="10.5px"
              letterSpacing="0.06em"
              color="var(--ink-tertiary)"
            >
              *No investment advice · No trade calls, no recommendations
            </Text>
          </motion.div>
        </motion.div>

        {/* Desktop: flanked row + mobile: stacked. Column order via CSS order + responsive stack. */}
        <Flex
          minH={0}
          align={{ base: "stretch", md: "center" }}
          justify={{ base: "flex-start", md: "center" }}
          gap={{ base: 3, md: 1 }}
          marginTop="auto"
          marginBottom="auto"
          direction={{ base: "column", md: "row" }}
        >
          {/* Left column — How it works */}
          <Box
            width="100%"
            maxW={{ base: "100%", md: 190 }}
            flexShrink={1}
            order={{ base: 3, md: 1 }}
            mt={{ base: 3, md: 0 }}
          >
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0, transition: { duration: dur.base, ease, delay: 0.3 } }}
          >
            <Box display={{ base: "none", md: "block" }}>
              <Heading label="How it works" />
              <Flex direction="column" gap={3}>
                {STEPS.map((s, i) => (
                  <motion.div key={s.n} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0, transition: { duration: dur.base, ease, delay: 0.35 + i * 0.06 } }}>
                    <Flex gap={3} align="flex-start">
                      <Text
                        fontFamily="var(--font-mono)"
                        fontSize="xs"
                        fontWeight="bold"
                        letterSpacing="0.08em"
                        color="var(--accent-primary)"
                        mt={0.5}
                      >
                        {s.n}
                      </Text>
                      <Box>
                        <Text fontSize="sm" fontWeight="bold" color="var(--ink-primary)">
                          {s.title}
                        </Text>
                        <Text fontSize="xs" color="var(--ink-secondary)" lineHeight="short" mt={0.5}>
                          {s.sub}
                        </Text>
                      </Box>
                    </Flex>
                  </motion.div>
                ))}
              </Flex>
            </Box>
            {/* Mobile condensed steps */}
            <Box display={{ base: "block", md: "none" }}>
              <Flex direction="column" gap={1.5}>
                {STEPS.map((s, i) => (
                  <motion.div key={s.n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: 0.3 + i * 0.05 } }}>
                    <Flex gap={2} align="flex-start">
                      <Text fontFamily="var(--font-mono)" fontSize="10px" fontWeight="bold" letterSpacing="0.08em" color="var(--accent-primary)" mt={0.5}>
                        {s.n}
                      </Text>
                      <Text fontSize="xs" color="var(--ink-primary)">
                        <Box as="span" fontWeight="bold">{s.title}</Box> — {s.sub}
                      </Text>
                    </Flex>
                  </motion.div>
                ))}
              </Flex>
            </Box>
          </motion.div>
          </Box>

          {/* Center: screenshot in glass panel */}
          <Box
            w="fit-content"
            maxW="100%"
            mx="auto"
            flex={{ base: "0 0 auto", md: "0 0 auto" }}
            borderRadius="20px"
            border="1px solid var(--hairline)"
            bg="var(--surface-panel)"
            backdropFilter="blur(12px)"
            WebkitBackdropFilter="blur(12px)"
            boxShadow="0 20px 60px -20px rgba(0,0,0,0.25)"
            p={2}
            position="relative"
            overflow="hidden"
            order={{ base: 1, md: 2 }}
          >
            <Box
              position="absolute"
              inset={0}
              background="radial-gradient(ellipse at 50% 0%, var(--accent-primary) 0%, transparent 70%)"
              opacity={0.14}
              pointerEvents="none"
            />
            <Box
              as={motion.img}
              src={screenshot}
              alt="Relativity analysis result showing a FIT score and per-criterion evaluation"
              maxH={{ base: "20vh", md: "58vh" }}
              w="auto"
              maxW="100%"
              borderRadius={16}
              mx="auto"
              display="block"
              position="relative"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: dur.slow, ease, delay: 0.35 } }}
            />
          </Box>

          {/* Right column — Data sources */}
          <Box
            width="100%"
            maxW={{ base: "100%", md: 190 }}
            flexShrink={1}
            order={{ base: 2, md: 3 }}
            mt={{ base: 4, md: 0 }}
          >
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0, transition: { duration: dur.base, ease, delay: 0.3 } }}
          >
            <Box display={{ base: "none", md: "block" }}>
              <Text
                fontFamily="var(--font-mono)"
                fontSize="10.5px"
                fontWeight={500}
                letterSpacing="0.14em"
                textTransform="uppercase"
                color="var(--ink-tertiary)"
                mb={3}
              >
                Data sources
              </Text>
              <Text fontSize="sm" fontWeight="semibold" color="var(--ink-primary)" mb={3}>
                Built on institutional-grade financial data
              </Text>
              <Flex gap={2} mb={4} wrap="wrap">
                {TRUST.map((t) => (
                  <Flex key={t} align="center" gap={1.5} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-recessed)" px={2} py={0.5}>
                    <LuCheck size={11} color="var(--accent-primary)" />
                    <Text fontSize="10px" fontWeight="medium" color="var(--ink-secondary)">{t}</Text>
                  </Flex>
                ))}
              </Flex>
              <motion.div variants={stack} initial="initial" animate="animate">
                <Box width="100%" sx={{ columnCount: 2, columnGap: 3 }}>
                  {SOURCES.map((s) => (
                    <motion.div key={s.label} variants={riseShort} style={{ breakInside: "avoid", marginBottom: 9 }}>
                      <Flex gap={2} align="flex-start">
                        <s.icon size={13} color="var(--accent-primary)" style={{ marginTop: 1, flexShrink: 0 }} />
                        <Text fontSize="xs" fontWeight="semibold" color="var(--ink-primary)" lineHeight="short">
                          {s.label}
                        </Text>
                      </Flex>
                    </motion.div>
                  ))}
                </Box>
              </motion.div>
            </Box>
            {/* Mobile data sources: full readability with page scroll */}
            <Box display={{ base: "block", md: "none" }} mt={2}>
              <Text
                fontFamily="var(--font-mono)"
                fontSize="10.5px"
                fontWeight={500}
                letterSpacing="0.14em"
                textTransform="uppercase"
                color="var(--ink-tertiary)"
                mb={1.5}
              >
                Data sources
              </Text>
              <Text fontSize="sm" fontWeight="semibold" color="var(--ink-primary)" mb={2}>
                Built on institutional-grade financial data
              </Text>
              <Box as="motion.div" variants={stack} initial="initial" animate="animate" mt={1}>
                <Box width="100%" sx={{ columnCount: 2, columnGap: 3 }}>
                  {SOURCES.map((s) => (
                    <motion.div key={s.label} variants={riseShort} style={{ breakInside: "avoid", marginBottom: 8 }}>
                      <Flex gap={2} align="flex-start">
                        <s.icon size={13} color="var(--accent-primary)" style={{ marginTop: 1, flexShrink: 0 }} />
                        <Text fontSize="xs" fontWeight="semibold" color="var(--ink-primary)" lineHeight="short">
                          {s.label}
                        </Text>
                      </Flex>
                    </motion.div>
                  ))}
                </Box>
              </Box>
            </Box>
          </motion.div>
          </Box>
        </Flex>

        {/* Caption below */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.base, ease, delay: 0.5 } }}
          style={{ textAlign: "center", paddingTop: "clamp(4px, 1vh, 10px)" }}
        >
          <Text
            fontFamily="var(--font-mono)"
            fontSize="10.5px"
            letterSpacing="0.06em"
            color="var(--ink-tertiary)"
          >
            *Not investment advice · No trade calls, no recommendations
          </Text>
        </motion.div>
        </Flex>
      </Flex>
    </Flex>
  );
}

function Heading({ label }: { label: string }) {
  return (
    <Text
      fontFamily="var(--font-mono)"
      fontSize="10.5px"
      fontWeight={500}
      letterSpacing="0.14em"
      textTransform="uppercase"
      color="var(--ink-tertiary)"
      mb={3}
    >
      {label}
    </Text>
  );
}
