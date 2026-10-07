import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { motion, useScroll, useMotionValueEvent } from "motion/react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { dur, ease } from "@/lib/motion";
import Logo from "@/components/Logo";
import resultScreenshot from "@/assets/hero-screenshot.png";
import secLogo from "@/assets/sec_logo.png";
import nseLogo from "@/assets/nse_logo.png";
import DataSourceMarquee from "@/components/landing/DataSourceMarquee";
import HowItWorks from "@/components/landing/HowItWorks";
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
    <section
      id={id}
      className="relative w-full max-w-[1180px] mx-auto px-4 md:px-8 py-14 md:py-20"
    >
      {blob && <div className="ambient-blob" style={{ ...BLOB_POS[blob] }} />}
      <div className="relative z-[1]">
        {children}
      </div>
    </section>
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
    <div ref={rootRef} className="landing h-full overflow-y-auto overflow-x-hidden relative bg-[var(--surface-canvas)]">
      <Helmet>
        <title>Relativity AI — Customizable Agents for Stock Analysis</title>
        <meta name="description" content="Create your own research agents. They screen and analyze stocks against your thesis and return a single FIT Score — no trade calls, no recommendations." />
        <meta property="og:title" content="Relativity AI — Customizable Agents for Stock Analysis" />
        <meta property="og:description" content="Create research agents that analyze stocks against your thesis." />
      </Helmet>

      <motion.header
        initial={false}
        animate={{
          backgroundColor: scrolled ? "rgba(var(--surface-panel-rgb, 18, 18, 18), 0.85)" : "rgba(var(--surface-panel-rgb, 18, 18, 18), 0.65)",
          borderColor: "var(--hairline)",
        }}
        transition={{ duration: dur.fast, ease }}
        className="sticky top-4 z-50 max-w-[900px] mx-auto px-4 md:px-6 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all duration-200"
        style={{
          borderStyle: "solid",
          borderWidth: "1px",
        }}
      >
        <div className="flex items-center justify-between relative w-full">
          <div className="flex items-center gap-2">
            <Logo preset="landing" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => navigate("/login")}>
              Log in
            </Button>
          </div>
        </div>
      </motion.header>

      <Section blob="tl">
        <div className="flex flex-col items-center text-center gap-8 md:gap-10 pt-6 md:pt-10 pb-4 md:pb-8">
          {/* Badge: Data pulled by NSE & SEC */}
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.fast, ease }}
          >
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface-panel)] shadow-sm">
              <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-[var(--ink-secondary)]">
                Data pulled by
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-[var(--surface-recessed)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                  <img src={nseLogo} alt="NSE" className="h-3.5 w-auto object-contain" />
                  <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold text-[var(--ink-primary)]">NSE</span>
                </div>
                <span className="text-[var(--ink-tertiary)] text-xs">&</span>
                <div className="flex items-center gap-1 bg-[var(--surface-recessed)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                  <img src={secLogo} alt="SEC" className="h-3.5 w-auto object-contain" />
                  <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold text-[var(--ink-primary)]">SEC</span>
                </div>
              </div>
            </div>
          </motion.div>

          <div className="flex flex-col items-center text-center gap-5 md:gap-6 relative z-[1] max-w-[800px]">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease }}
            >
              <h1 className="text-[clamp(2.5rem,5.5vw,4.8rem)] leading-[1.04] font-extrabold tracking-[-0.035em] text-[var(--ink-primary)]">
                Your thesis. Every stock. One score.
              </h1>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease, delay: 0.08 }}
            >
              <p className="text-base md:text-xl text-[var(--ink-secondary)] leading-relaxed max-w-[60ch] mx-auto">
                Build an agent that invests the way you do. It reads filings, runs numbers, and scores every stock against your rules — with the reasoning shown, not hidden.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.base, ease, delay: 0.16 }}
            >
              <div className="flex items-center justify-center gap-3 md:gap-4 flex-wrap">
                <Button
                  size="lg"
                  variant="default"
                  className="min-h-[44px] hover:scale-[1.02] hover:shadow-[0_10px_30px_-10px_var(--accent-primary)] active:scale-[0.98]"
                  onClick={() => navigate("/login")}
                >
                  Get started
                </Button>
                <Button size="lg" variant="ghost" className="text-[var(--accent-primary)] min-h-[44px]" onClick={scrollToScoring}>
                  See how scoring works
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: dur.slow, ease, delay: 0.3 }}
            >
              <div className="flex items-center justify-center gap-2 mt-1 md:mt-2">
                <div className="w-2 h-2 rounded-full bg-[var(--signal-positive)]" />
                <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-tertiary)]">
                  No trade calls, no recommendations — research only
                </p>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.slow, ease, delay: 0.2 }}
            style={{ width: "100%" }}
          >
            <div className="w-full max-w-[980px] mx-auto rounded-2xl overflow-hidden border border-[var(--hairline)] bg-[var(--surface-panel)] shadow-[0_40px_100px_-24px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-b-[var(--hairline)]">
                <div className="flex gap-1.5" aria-hidden="true">
                  <div className="w-[9px] h-[9px] rounded-full bg-[var(--hairline)]" />
                  <div className="w-[9px] h-[9px] rounded-full bg-[var(--hairline)]" />
                  <div className="w-[9px] h-[9px] rounded-full bg-[var(--hairline)]" />
                </div>
                <p className="font-[family-name:var(--font-mono)] text-[10px] md:text-[11px] font-medium text-[var(--ink-tertiary)] tracking-[0.08em]">
                  RELATIVITY / ANALYSIS RESULT
                </p>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--signal-positive)]" />
                  <p className="font-[family-name:var(--font-mono)] text-[10px] md:text-[11px] font-medium text-[var(--signal-positive)]">
                    COMPLETE
                  </p>
                </div>
              </div>
              <img
                src={resultScreenshot}
                alt="Relativity analysis result: KEI Industries scored 76.8 FIT with quantitative gates and per-criterion breakdown"
                style={{ display: "block", width: "100%", height: "auto" }}
                fetchPriority="high"
              />
            </div>
          </motion.div>
        </div>
      </Section>

      <div className="w-full max-w-[1180px] mx-auto px-4 md:px-8">
        <div className="flex items-start md:items-center justify-start md:justify-center gap-3 mb-6 md:mb-8 opacity-85">
          <p className="font-[family-name:var(--font-mono)] text-xs font-medium text-[var(--ink-tertiary)]">
            Pulls from SEC & NSE filings, across 12 categories of market data
          </p>
        </div>
        <DataSourceMarquee />
      </div>

      <Section id="how-it-works" blob="br">
        <AgentShowcase />
        <div className="h-14 md:h-20" />

        <div className="flex flex-col gap-5 md:gap-6 mb-8 md:mb-12">
          <h2 className="text-xl md:text-2xl font-bold text-[var(--ink-primary)] leading-tight">
            How it works
          </h2>
        </div>
        <HowItWorks />
      </Section>

      <Section>
        <TrustBlock />
      </Section>

      <Section blob="tr">
        <LandingFaq />
      </Section>

      <Section blob="bl">
        <motion.div {...sectionFadeUp} transition={{ duration: dur.base, ease }}>
          <div className="flex flex-col items-start md:items-center text-left md:text-center gap-5 md:gap-6">
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-[-0.035em] text-[var(--ink-primary)] max-w-[16ch]">
              Tell it your thesis. It tells you what fits.
            </h2>
            <Button
              size="lg"
              variant="default"
              className="min-h-[44px] hover:scale-[1.02] hover:shadow-[0_10px_30px_-10px_var(--accent-primary)] active:scale-[0.98]"
              onClick={() => navigate("/login")}
            >
              Get started
            </Button>
          </div>
        </motion.div>
      </Section>

      <Footer />
    </div>
  );
}