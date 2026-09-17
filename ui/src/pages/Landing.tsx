import { useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { motion, useScroll, useMotionValueEvent } from "motion/react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { dur, ease } from "@/lib/motion";
import logoMark from "@/assets/logo-mark.png";
import FitScoreDemo from "@/components/landing/FitScoreDemo";
import DataSourceMarquee from "@/components/landing/DataSourceMarquee";
import HowItWorks from "@/components/landing/HowItWorks";
import ProofSection from "@/components/landing/ProofSection";
import TrustBlock from "@/components/landing/TrustBlock";
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
    <Box ref={rootRef} h="100%" overflowY="auto" overflowX="hidden" position="relative" bg="var(--surface-canvas)">
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
          w="100%"
          maxW="1180px"
          mx="auto"
          px={{ base: 4, md: 8 }}
          py={3}
        >
          <Flex align="center" gap={2}>
            <img src={logoMark} alt="Relativity" style={{ height: "34px", width: "auto", borderRadius: 8 }} />
            <Text fontFamily="var(--font-mono)" fontWeight="bold" fontSize="xs" letterSpacing="0.18em" color="var(--ink-primary)" display={{ base: "none", sm: "block" }}>
              RELATIVITY
            </Text>
          </Flex>
          <Flex align="center" gap={2}>
            <Button size="sm" variant="outline" onClick={() => navigate("/login")}>
              Log in
            </Button>
            <Button size="sm" variant="surface" colorPalette="blue" onClick={() => navigate("/login")}>
              Get started
            </Button>
          </Flex>
        </Flex>
      </motion.header>

      <Section blob="tl">
        <Flex direction="column" align="center" textAlign="center" gap={{ base: 5, md: 6 }} pt={{ base: 8, md: 12 }}>
          <Box position="relative">
            <img
              src={logoMark}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "40vh",
                maxWidth: "80vw",
                opacity: 0.05,
                borderRadius: "3.5%",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
            <Flex direction="column" gap={{ base: 4, md: 5 }} align="center" position="relative" zIndex={1}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur.base, ease }}
              >
                <Text
                  as="h1"
                  fontSize="clamp(2.75rem, 6vw, 5.5rem)"
                  lineHeight={1.05}
                  fontWeight={800}
                  letterSpacing="-0.035em"
                  color="var(--ink-primary)"
                  maxW="16ch"
                  mx="auto"
                >
                  Tell it your thesis.
                  <br />
                  It tells you what fits.
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
                  maxW="640px"
                  mx="auto"
                >
                  Define an investment thesis in plain language. Every stock gets screened against it and scored — no trade calls, no recommendations.
                </Text>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur.base, ease, delay: 0.16 }}
              >
                <Flex align="center" gap={{ base: 3, md: 4 }} justify="center">
                  <Button
                    size="lg"
                    variant="surface"
                    colorPalette="blue"
                    minH="44px"
                    onClick={() => navigate("/login")}
                    _hover={{ transform: "scale(1.02)", boxShadow: "0 10px 30px -10px var(--accent-primary)" }}
                  >
                    Get started
                  </Button>
                  <Button size="lg" variant="ghost" color="var(--accent-primary)" minH="44px" onClick={scrollToScoring}>
                    See how scoring works
                  </Button>
                </Flex>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur.base, ease, delay: 0.24 }}
                style={{ width: "100%", display: "flex", justifyContent: "center" }}
              >
                <FitScoreDemo />
              </motion.div>
            </Flex>
          </Box>
        </Flex>
      </Section>

      <Box w="100%" maxW="1180px" mx="auto" px={{ base: 4, md: 8 }}>
        <Flex align="center" justify="center" gap={3} mb={{ base: 6, md: 8 }} opacity={0.85}>
          <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-tertiary)">
            Pulls from SEC & NSE filings, across 12 categories of market data
          </Text>
        </Flex>
        <DataSourceMarquee />
      </Box>

      <Section id="how-it-works" blob="br">
        <Flex direction="column" gap={{ base: 5, md: 6 }} mb={{ base: 8, md: 12 }}>
          <Text as="h2" fontSize={{ base: "xl", md: "2xl" }} fontWeight={700} color="var(--ink-primary)" lineHeight="tight">
            How it works
          </Text>
        </Flex>
        <HowItWorks />
      </Section>

      <Box w="100%" maxW="1180px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 14, md: 20 }}>
        <ProofSection />
      </Box>

      <Section>
        <TrustBlock />
      </Section>

      <Section blob="tr">
        <LandingFaq />
      </Section>

      <Section blob="bl">
        <motion.div {...sectionFadeUp} transition={{ duration: dur.base, ease }}>
          <Flex direction="column" align="center" textAlign="center" gap={{ base: 5, md: 6 }}>
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