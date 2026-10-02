import { useEffect, useReducer, useRef, useCallback } from "react";
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
    <div
      className="relative w-full max-w-[520px] border border-[var(--hairline)] rounded-xl bg-[var(--surface-panel)] overflow-hidden"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
    >
      <div className="px-4 md:px-5 pt-4 md:pt-5 pb-3">
        <p className="font-[family-name:var(--font-mono)] text-xs font-medium text-[var(--ink-tertiary)] tracking-[0.04em] mb-3">
          Thesis
        </p>
        <div className="min-h-[3.2em] md:min-h-[2.4em]">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.phase === "typing" ? `typing-${state.thesisIdx}` : `other-${state.thesisIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.fast, ease }}
            >
              <p className="text-sm md:text-base font-medium text-[var(--ink-primary)] leading-snug">
                {state.phase === "typing" ? (
                  <>
                    {typedText}
                    <span
                      className="inline-block w-[2px] h-[1em] bg-[var(--accent-primary)] ml-[1px] align-text-bottom"
                    />
                  </>
                ) : (
                  thesis.text
                )}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {state.phase === "scanning" && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.fast, ease }}
          >
            <div className="flex px-4 md:px-5 py-3 border-t border-t-[var(--hairline)] items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />
              <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--accent-primary)] font-medium">
                Scanning {SCANNING_LABELS[state.scanIdx]}...
              </p>
            </div>
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
            <div className="px-4 md:px-5 py-3 border-t border-t-[var(--hairline)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-baseline gap-2">
                  <p className="font-[family-name:var(--font-mono)] text-lg font-bold text-[var(--ink-primary)] tracking-[-0.02em]">
                    {thesis.ticker}
                  </p>
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--ink-tertiary)]">
                    NSE
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <p className="font-[family-name:var(--font-mono)] text-2xl md:text-3xl font-extrabold text-[var(--accent-primary)] leading-none tracking-[-0.03em]">
                    <CountUp value={thesis.score} decimals={1} duration={0.8} />
                  </p>
                  <p className="font-[family-name:var(--font-mono)] text-xs font-medium text-[var(--ink-tertiary)]">
                    FIT
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {thesis.why.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="mt-[6px] w-1 h-1 rounded-full bg-[var(--accent-primary)] opacity-50 shrink-0" />
                    <p className="text-xs text-[var(--ink-secondary)] leading-snug">
                      {w}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex px-4 md:px-5 py-2.5 border-t border-t-[var(--hairline)] gap-1.5 flex-wrap">
        {SOURCES.slice(0, 5).map((s) => (
          <div key={s.label} className="flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-recessed)] px-2 py-0.5">
            <s.icon size={10} color="var(--ink-tertiary)" />
            <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] font-medium whitespace-nowrap">
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
