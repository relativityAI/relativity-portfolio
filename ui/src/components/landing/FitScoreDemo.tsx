import { useEffect, useReducer, useRef, useCallback } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease, CountUp } from "@/lib/motion";
import { SOURCES } from "@/lib/dataSources";

type Phase = "typing" | "scanning" | "result";

type Thesis = {
  text: string;
  ticker: string;
  score: number;
  why: string[];
};

const THESES: Thesis[] = [
  {
    text: "Profitable mid-cap compounders with rising promoter holding",
    ticker: "TATAELXSI",
    score: 87.4,
    why: ["ROCE trending up 3 years", "Promoter stake +2.1% QoQ", "Valuation in-line with peers"],
  },
  {
    text: "High-ROE businesses with consistent dividend growth",
    ticker: "HDFCBANK",
    score: 92.1,
    why: ["ROE above 16% for 5 years", "Dividend CAGR 14%", "Low promoter pledging"],
  },
  {
    text: "Undervalued companies with improving credit metrics",
    ticker: "TATASTEEL",
    score: 71.8,
    why: ["Debt-to-equity down 0.3 YoY", "Interest coverage improving", "Sector tailwinds priced in"],
  },
];

const SCANNING_LABELS = ["Financial statements", "Shareholding", "Filings", "Peer comparison", "Earnings calls"];

type State = { phase: Phase; thesisIdx: number; charIdx: number; scanIdx: number };

type Action =
  | { type: "TICK" }
  | { type: "ENTER_SCANNING" }
  | { type: "ENTER_RESULT" }
  | { type: "NEXT_THESIS" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "TICK":
      if (state.phase === "typing") {
        const thesis = THESES[state.thesisIdx];
        if (state.charIdx < thesis.text.length) return { ...state, charIdx: state.charIdx + 1 };
        return state;
      }
      if (state.phase === "scanning") {
        return { ...state, scanIdx: (state.scanIdx + 1) % SCANNING_LABELS.length };
      }
      return state;
    case "ENTER_SCANNING":
      return { ...state, phase: "scanning", scanIdx: 0 };
    case "ENTER_RESULT":
      return { ...state, phase: "result" };
    case "NEXT_THESIS":
      return { phase: "typing", thesisIdx: (state.thesisIdx + 1) % THESES.length, charIdx: 0, scanIdx: 0 };
  }
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function FitScoreDemo() {
  const [state, dispatch] = useReducer(reducer, {
    phase: prefersReducedMotion ? "result" : "typing",
    thesisIdx: 0,
    charIdx: prefersReducedMotion ? THESES[0].text.length : 0,
    scanIdx: 0,
  });

  const paused = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    clearTimers();

    const pending: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      pending.push(setTimeout(fn, paused.current ? 10000 : ms));
    };

    const thesis = THESES[state.thesisIdx];

    if (state.phase === "typing" && state.charIdx < thesis.text.length) {
      later(() => dispatch({ type: "TICK" }), 35);
    } else if (state.phase === "typing" && state.charIdx >= thesis.text.length) {
      later(() => dispatch({ type: "ENTER_SCANNING" }), 400);
    } else if (state.phase === "scanning") {
      later(() => dispatch({ type: "TICK" }), 180);
      later(() => dispatch({ type: "ENTER_RESULT" }), 900);
    } else if (state.phase === "result") {
      later(() => dispatch({ type: "NEXT_THESIS" }), 3200);
    }

    return () => pending.forEach(clearTimeout);
  }, [state, clearTimers]);

  const thesis = THESES[state.thesisIdx];
  const typedText = thesis.text.slice(0, state.charIdx);

  return (
    <Box
      position="relative"
      w="100%"
      maxW="520px"
      border="1px solid var(--hairline)"
      borderRadius="xl"
      bg="var(--surface-panel)"
      overflow="hidden"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
    >
      <Box px={{ base: 4, md: 5 }} pt={{ base: 4, md: 5 }} pb={3}>
        <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-tertiary)" letterSpacing="0.04em" mb={3}>
          Thesis
        </Text>
        <Box minH={{ base: "3.2em", md: "2.4em" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={state.phase === "typing" ? `typing-${state.thesisIdx}` : `other-${state.thesisIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.fast, ease }}
            >
              <Text fontSize={{ base: "sm", md: "md" }} fontWeight={500} color="var(--ink-primary)" lineHeight="short">
                {state.phase === "typing" ? (
                  <>
                    {typedText}
                    <Box
                      as="span"
                      display="inline-block"
                      w="2px"
                      h="1em"
                      bg="var(--accent-primary)"
                      ml="1px"
                      verticalAlign="text-bottom"
                    />
                  </>
                ) : (
                  thesis.text
                )}
              </Text>
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>

      <AnimatePresence mode="wait">
        {state.phase === "scanning" && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.fast, ease }}
          >
            <Flex px={{ base: 4, md: 5 }} py={3} borderTop="1px solid var(--hairline)" align="center" gap={2}>
              <Box w={2} h={2} borderRadius="full" bg="var(--accent-primary)" />
              <Text fontFamily="var(--font-mono)" fontSize="xs" color="var(--accent-primary)" fontWeight={500}>
                Scanning {SCANNING_LABELS[state.scanIdx]}...
              </Text>
            </Flex>
          </motion.div>
        )}

        {state.phase === "result" && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.base, ease }}
          >
            <Box px={{ base: 4, md: 5 }} py={3} borderTop="1px solid var(--hairline)">
              <Flex align="center" justify="space-between" mb={3}>
                <Flex align="baseline" gap={2}>
                  <Text fontFamily="var(--font-mono)" fontSize="lg" fontWeight={700} color="var(--ink-primary)" letterSpacing="-0.02em">
                    {thesis.ticker}
                  </Text>
                  <Text fontFamily="var(--font-mono)" fontSize="xs" color="var(--ink-tertiary)">
                    NSE
                  </Text>
                </Flex>
                <Flex align="baseline" gap={1}>
                  <Text fontFamily="var(--font-mono)" fontSize={{ base: "2xl", md: "3xl" }} fontWeight={800} color="var(--accent-primary)" lineHeight={1} letterSpacing="-0.03em">
                    <CountUp value={thesis.score} decimals={1} duration={0.8} />
                  </Text>
                  <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-tertiary)">
                    FIT
                  </Text>
                </Flex>
              </Flex>
              <Flex direction="column" gap={1.5}>
                {thesis.why.map((w, i) => (
                  <Flex key={i} align="flex-start" gap={2}>
                    <Box mt="6px" w={1} h={1} borderRadius="full" bg="var(--accent-primary)" opacity={0.5} flexShrink={0} />
                    <Text fontSize="xs" color="var(--ink-secondary)" lineHeight="short">
                      {w}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      <Flex px={{ base: 4, md: 5 }} py={2.5} borderTop="1px solid var(--hairline)" gap={1.5} flexWrap="wrap">
        {SOURCES.slice(0, 5).map((s) => (
          <Flex key={s.label} align="center" gap={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-recessed)" px={2} py={0.5}>
            <s.icon size={10} color="var(--ink-tertiary)" />
            <Text fontFamily="var(--font-mono)" fontSize="10px" color="var(--ink-tertiary)" fontWeight={500} whiteSpace="nowrap">
              {s.label}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}
