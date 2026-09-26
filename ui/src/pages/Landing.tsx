import { useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { motion, useScroll, useMotionValueEvent } from "motion/react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { dur, ease } from "@/lib/motion";
import Logo from "@/components/Logo";
import resultScreenshot from "@/assets/hero-screenshot.png";
import FitScoreDemo from "@/components/landing/FitScoreDemo";
import DataSourceMarquee from "@/components/landing/DataSourceMarquee";
import HowItWorks from "@/components/landing/HowItWorks";
import ProofSection from "@/components/landing/ProofSection";
import TrustBlock from "@/components/landing/TrustBlock";
import AgentShowcase from "@/components/landing/AgentShowcase";
import LandingFaq from "@/components/landing/LandingFaq";
import Footer from "@/components/Footer";

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const sectionFadeUp = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-15%" },
};

const BLOB_POS = {
  tl: { top: "-14%", left: "-10%" },
  br: { bottom: "-14%", right: "-10%" },
  tr: { top: "-10%", right: "-10%" },
  bl: { bottom: "-12%", left: "-10%" },
} as const;

function Section({
  id,
  blob,
  children,
}: {
  id?: string;
  blob?: keyof typeof BLOB_POS;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="section"
      id={id}
      position="relative"
      w="100%"
      maxW="1180px"
      mx="auto"
      px={{ base: 4, md: 8 }}
      py={{ base: 14, md: 20 }}
    >
      {blob && <Box className="ambient-blob" style={BLOB_POS[blob]} />}
      <Box position="relative" zIndex={1}>
        {children}
      </Box>
    </Box>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: rootRef });
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (latest) => setScrolled(latest > 40));

  const scrollToScoring = () => {
    rootRef.current
      ?.querySelector("#how-it-works")
      ?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <Box ref={rootRef} h="100%" overflowY="auto" overflowX="hidden" position="relative" bg="var(--surface-canvas)" className="landing">
      <Helmet>
        <title>Relativity AI — Customizable Agents for Stock Analysis</title>
        <meta name="description" content="Create your own research agents. They screen and analyze stocks against your thesis and return a single FIT Score — no trade calls, no recommendations." />
        <meta property="og:title" content="Relativity AI — Customizable Agents for Stock Analysis" />
        <meta property="og:description" content="Create research agents that analyze stocks against your thesis." />
      </Helmet>

      <motion.header
        initial={false}
        animate={{
          backgroundColor: scrolled ? "var(--surface-panel)" : "var(--surface-canvas)",
          borderColor: scrolled ? "var(--hairline)" : "transparent",
        }}
        transition={{ duration: dur.fast, ease }}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          borderBottomWidth: 1,
          borderBottomStyle: "solid",
        }}
      >
        <Flex
          align="center"
          justify="space-between"
          position="relative"
          w="100%"
          maxW="1180px"
          mx="auto"
          px={{ base: 4, md: 8 }}
          py={3}
        >
          <Flex align="center" gap={2}>
            <Logo preset="landing" />
          </Flex>
          <Flex align="center" gap={2}>
            <Button size="sm" variant="outline" onClick={() => navigate("/login")}>
              Log in
            </Button>
          </Flex>
        </Flex>
      </motion.header>

      <Section blob="tl">
        <Flex direction="column" gap={{ base: 8, md: 12 }} pt={{ base: 8, md: 14 }} pb={{ base: 4, md: 8 }}>
          <Flex direction="column" gap={{ base: 5, md: 6 }} position="relative" zIndex={1} maxW="720px">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease }}
            >
              <Text
                as="h1"
                fontSize="clamp(2.5rem, 5.2vw, 4.5rem)"
                lineHeight={1.04}
                fontWeight={800}
                letterSpacing="-0.035em"
                color="var(--ink-primary)"
                maxW="14ch"
              >
                Your thesis. Every stock. One score.
              </Text>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease, delay: 0.08 }}
            >
              <Text
                fontSize={{ base: "md", md: "lg" }}
                color="var(--ink-secondary)"
                lineHeight="relaxed"
                maxW="54ch"
              >
                Build an agent that invests the way you do. It reads the filings, runs the numbers, and scores every stock against your rules — with the reasoning shown, not hidden.
              </Text>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease, delay: 0.16 }}
            >
              <Flex align="center" gap={{ base: 3, md: 4 }}>
                <Button
                  size="lg"
                  variant="surface"
                  colorPalette="blue"
                  minH="44px"
                  onClick={() => navigate("/login")}
                  _hover={{ transform: "scale(1.02)", boxShadow: "0 10px 30px -10px var(--accent-primary)" }}
                  _active={{ transform: "scale(0.98)" }}
                >
                  Get started
                </Button>
                <Button size="lg" variant="ghost" color="var(--accent-primary)" minH="44px" onClick={scrollToScoring}>
                  See how scoring works
                </Button>
              </Flex>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: dur.slow, ease, delay: 0.3 }}
            >
              <Flex align="center" gap={3} mt={{ base: 2, md: 4 }}>
                <Flex align="center" gap={2}>
                  <Box w={2} h={2} borderRadius="full" bg="var(--signal-positive)" />
                  <Text fontFamily="var(--font-mono)" fontSize="11px" color="var(--ink-tertiary)">
                    No trade calls, no recommendations — research only
                  </Text>
                </Flex>
              </Flex>
            </motion.div>
          </Flex>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.slow, ease, delay: 0.2 }}
            style={{ width: "100%" }}
          >
            <Box
              w="100%"
              maxW="980px"
              borderRadius="2xl"
              overflow="hidden"
              border="1px solid var(--hairline)"
              bg="var(--surface-panel)"
              boxShadow="0 40px 100px -24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)"
            >
                <Flex align="center" gap={3} px={{ base: 4, md: 5 }} py={3} borderBottom="1px solid var(--hairline)">
                  <Flex gap={1.5} aria-hidden="true">
                    <Box w="9px" h="9px" borderRadius="full" bg="var(--hairline)" />
                    <Box w="9px" h="9px" borderRadius="full" bg="var(--hairline)" />
                    <Box w="9px" h="9px" borderRadius="full" bg="var(--hairline)" />
                  </Flex>
                  <Text fontFamily="var(--font-mono)" fontSize={{ base: "10px", md: "11px" }} fontWeight={500} color="var(--ink-tertiary)" letterSpacing="0.08em">
                    RELATIVITY / ANALYSIS RESULT
                  </Text>
                  <Box flex={1} />
                  <Flex align="center" gap={1.5}>
                    <Box w={2} h={2} borderRadius="full" bg="var(--signal-positive)" />
                    <Text fontFamily="var(--font-mono)" fontSize={{ base: "10px", md: "11px" }} fontWeight={500} color="var(--signal-positive)">
                      COMPLETE
                    </Text>
                  </Flex>
                </Flex>
              <img
                src={resultScreenshot}
                alt="Relativity analysis result: KEI Industries scored 76.8 FIT with quantitative gates and per-criterion breakdown"
                style={{ display: "block", width: "100%", height: "auto" }}
                fetchPriority="high"
              />
            </Box>
          </motion.div>
        </Flex>
      </Section>

      <Box w="100%" maxW="1180px" mx="auto" px={{ base: 4, md: 8 }}>
        <Flex align={{ base: "flex-start", md: "center" }} justify={{ base: "flex-start", md: "center" }} gap={3} mb={{ base: 6, md: 8 }} opacity={0.85}>
          <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-tertiary)">
            Pulls from SEC & NSE filings, across 12 categories of market data
          </Text>
        </Flex>
        <DataSourceMarquee />
      </Box>

      <Section id="how-it-works" blob="br">
        <AgentShowcase />
        <Box h={{ base: 14, md: 20 }} />

        <Flex direction="column" gap={{ base: 5, md: 6 }} mb={{ base: 8, md: 12 }}>
          <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
            How it works
          </Text>
        </Flex>
        <HowItWorks />
      </Section>

      <Box w="100%" maxW="1180px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 14, md: 20 }}>
        <ProofSection />

        <Flex justify="center" mt={{ base: 10, md: 14 }}>
          <FitScoreDemo />
        </Flex>
      </Box>

      <Section>
        <TrustBlock />
      </Section>

      <Section blob="tr">
        <LandingFaq />
      </Section>

      <Section blob="bl">
        <motion.div {...sectionFadeUp} transition={{ duration: dur.base, ease }}>
          <Flex direction="column" align={{ base: "flex-start", md: "center" }} textAlign={{ base: "left", md: "center" }} gap={{ base: 5, md: 6 }}>
            <Text as="h2" fontSize={{ base: "2xl", md: "3xl" }} fontWeight={800} letterSpacing="-0.035em" color="var(--ink-primary)" maxW="16ch">
              Tell it your thesis. It tells you what fits.
            </Text>
            <Button
              size="lg"
              variant="surface"
              colorPalette="blue"
              minH="44px"
              onClick={() => navigate("/login")}
              _hover={{ transform: "scale(1.02)", boxShadow: "0 10px 30px -10px var(--accent-primary)" }}
              _active={{ transform: "scale(0.98)" }}
            >
              Get started
            </Button>
          </Flex>
        </motion.div>
      </Section>

      <Footer />
    </Box>
  );
}