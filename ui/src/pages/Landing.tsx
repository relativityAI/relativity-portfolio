import { useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { FcGoogle } from "react-icons/fc";
import { motion, AnimatePresence } from "motion/react";
import { Helmet } from "react-helmet-async";
import { dur, ease } from "@/lib/motion";
import { useAuth } from "@/auth/useAuth";

const POINTS = [
  { n: "01", title: "Create an agent", sub: "Capture your investing style in rules." },
  { n: "02", title: "Agents do the digging", sub: "Filings, news, numbers — everything cited." },
  { n: "03", title: "Judge the results", sub: "Your entire research process, done fast." },
];

const HEADLINE: Array<{ w: string; accent?: boolean }> = [
  { w: "Every" },
  { w: "investor" },
  { w: "has" },
  { w: "a" },
  { w: "style." },
  { w: "We", accent: true },
  { w: "capture", accent: true },
  { w: "it.", accent: true },
];

const stack = {
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};

const rise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.slow, ease } },
};

const draw = {
  initial: { scaleX: 0 },
  animate: { scaleX: 1, transition: { duration: dur.slow, ease } },
};

function SpacetimeGrid() {
  return (
    <motion.svg
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.35, transition: { duration: 1.2, ease, delay: 0.4 } }}
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="var(--surface-canvas)" />
      <g stroke="var(--accent-primary)" strokeWidth="0.35" filter="url(#glow)">
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
          <motion.line
            key={`v${v}`}
            x1={v} y1={0} x2={v} y2={100}
            initial={{ scaleY: 0, originY: 0.5 }}
            animate={{ scaleY: 1, transition: { duration: 0.8, ease, delay: v * 0.02 + 0.2 } }}
          />
        ))}
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
          <motion.line
            key={`h${v}`}
            x1={0} y1={v} x2={100} y2={v}
            initial={{ scaleX: 0, originX: 0.5 }}
            animate={{ scaleX: 1, transition: { duration: 0.8, ease, delay: v * 0.02 + 0.6 } }}
          />
        ))}
      </g>
      <motion.circle
        cx={50} cy={50} r={0}
        fill="var(--accent-primary)"
        animate={{ r: [0, 18, 0], opacity: [0.6, 0, 0], transition: { duration: 4, ease: "linear", repeat: Infinity } }}
      />
    </motion.svg>
  );
}

function Seam() {
  return (
    <motion.div
      style={{
        width: "100%",
        height: 2,
        background: "linear-gradient(90deg, transparent, var(--accent-primary) 20%, var(--accent-primary) 80%, transparent)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <motion.div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, transparent, var(--surface-canvas), transparent)",
        }}
        animate={{ x: ["-100%", "100%"], transition: { duration: 3, ease: "linear", repeat: Infinity } }}
      />
    </motion.div>
  );
}

export default function Landing() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) setError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex h="100dvh" direction="column" overflow="hidden" position="relative">
      <Helmet>
        <title>Relativity AI — Every investor has a style. We capture it.</title>
        <meta name="description" content="AI-powered investment research platform. Create agents that capture your investing style and dig through filings, news, and numbers — everything cited." />
        <meta property="og:title" content="Relativity AI — Every investor has a style. We capture it." />
        <meta property="og:description" content="AI-powered investment research platform. Create agents that capture your investing style." />
      </Helmet>
      <Flex flex={1} minH={0} direction={{ base: "column", md: "row" }}>
        {/* Pitch */}
        <Flex
          flex={1}
          direction="column"
          justify="center"
          minW={0}
          position="relative"
          px={{ base: 6, md: 14 }}
          pt={{ base: 5, md: 10 }}
          pb={{ base: 3, md: 10 }}
        >
          <SpacetimeGrid />
          <motion.div variants={stack} initial="initial" animate="animate" style={{ position: "relative", zIndex: 1 }}>
            <motion.div variants={rise} style={{ marginBottom: "clamp(14px, 3vh, 24px)" }}>
              <Text
                fontFamily="var(--font-mono)"
                fontWeight="bold"
                fontSize="sm"
                letterSpacing="0.35em"
                color="fg"
              >
                RELATIVITY
              </Text>
            </motion.div>

            <motion.h1
              variants={stack}
              style={{
                fontSize: "clamp(1.7rem, 5.5vw + 0.4rem, 3.2rem)",
                lineHeight: 1.08,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                maxWidth: 540,
                marginBottom: "clamp(18px, 4vh, 36px)",
                color: "var(--ink-primary)",
              }}
            >
              {HEADLINE.map(({ w, accent }, i) => (
                <motion.span
                  key={i}
                  variants={rise}
                  style={{
                    display: "inline-block",
                    marginRight: "0.28em",
                    color: accent ? "var(--accent-primary)" : undefined,
                  }}
                >
                  {w}
                </motion.span>
              ))}
            </motion.h1>

            <Flex direction="column" gap={{ base: 3, md: 4 }} maxW={{ md: "440px" }}>
              {POINTS.map((p) => (
                <motion.div key={p.n} variants={rise} whileHover={{ x: 4 }}>
                  <motion.div
                    variants={draw}
                    style={{
                      height: 1,
                      background: "var(--hairline)",
                      marginBottom: 10,
                      originX: 0,
                    }}
                  />
                  <Flex gap={3} align="baseline">
                    <Text
                      fontFamily="var(--font-mono)"
                      fontSize="xs"
                      fontWeight="bold"
                      letterSpacing="0.08em"
                      color="var(--accent-primary)"
                    >
                      {p.n}
                    </Text>
                    <Box>
                      <Text fontSize={{ base: "sm", md: "md" }} fontWeight="semibold">
                        {p.title}
                      </Text>
                      <Text fontSize={{ base: "xs", md: "sm" }} color="fg.muted" mt={0.5}>
                        {p.sub}
                      </Text>
                    </Box>
                  </Flex>
                </motion.div>
              ))}
            </Flex>
          </motion.div>
        </Flex>

        {/* Sign in */}
        <Flex
          flex={1}
          align="center"
          justify="center"
          minW={0}
          px={{ base: 6, md: 12 }}
          pt={{ base: 2, md: 10 }}
          pb={{ base: 4, md: 10 }}
          borderLeft={{ base: "none", md: "1px solid var(--hairline)" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease, delay: 0.25 }}
            style={{ width: "100%", maxWidth: 360 }}
          >
            <Text
              fontFamily="var(--font-mono)"
              fontSize="10.5px"
              fontWeight={500}
              letterSpacing="0.14em"
              color="fg.muted"
              mb={1}
              textAlign="center"
            >
              MEMBER ACCESS
            </Text>
            <Text fontWeight="bold" fontSize="lg" mb={4} textAlign="center">
              Sign in to your workspace
            </Text>

            <AnimatePresence>
              {error && (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: dur.base, ease }}
                  style={{ overflow: "hidden", marginBottom: 3 }}
                >
                  <Text fontSize="sm" color="red.400" textAlign="center">
                    {error}
                  </Text>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleGoogle}
                loading={submitting}
                w="full"
                size="lg"
                variant="solid"
                colorPalette="blue"
              >
                <FcGoogle size={18} />
                <Text ml={2}>Continue with Google</Text>
              </Button>
            </motion.div>

            <Text
              mt={3}
              textAlign="center"
              fontFamily="var(--font-mono)"
              fontSize="10.5px"
              letterSpacing="0.08em"
              color="fg.muted"
            >
              NO CARD NEEDED · YOUR KEYS STAY YOURS
            </Text>
          </motion.div>
        </Flex>
      </Flex>

      <Seam />
    </Flex>
  );
}