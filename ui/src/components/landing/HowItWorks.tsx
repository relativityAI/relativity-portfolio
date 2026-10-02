import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LuCheck, LuShieldCheck, LuTerminal } from "react-icons/lu";
import secLogo from "@/assets/sec_logo.png";
import { SiGoogle } from "react-icons/si";

const STEPS = [
  {
    n: "01",
    title: "Configure & Launch Analysis",
    sub: "Pick an agent, target ticker, exchange, and AI model — rendered directly from our analysis page run summary card.",
    visual: (
      <Card className="w-full max-w-[340px] gap-3 rounded-lg py-4 shadow-xl border border-[var(--hairline)] bg-[var(--surface-panel)] text-left">
        <CardHeader className="px-4 pb-0">
          <CardTitle className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            Run summary
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 flex flex-col gap-2.5">
          {/* Company Chip */}
          <div className="flex items-center gap-2 min-w-0">
            <img src={secLogo} alt="SEC" className="h-3.5 w-auto flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[var(--ink-primary)] truncate leading-tight">
                Apple Inc.
              </p>
              <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] truncate leading-tight">
                AAPL
              </p>
            </div>
          </div>

          {/* Agent Chip */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-[family-name:var(--font-mono)] font-bold text-[9px] flex items-center justify-center flex-shrink-0">
              W
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[var(--ink-primary)] truncate leading-tight">
                Warren Buffett
              </p>
            </div>
          </div>

          {/* Model Chip */}
          <div className="flex items-center gap-2 min-w-0">
            <SiGoogle className="w-3.5 h-3.5 text-[var(--accent-primary)] flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[var(--ink-primary)] truncate leading-tight">
                gemini-3.5-flash-lite
              </p>
              <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] truncate leading-tight">
                Gemini
              </p>
            </div>
          </div>

          <p className="text-[9.5px] font-semibold text-[var(--accent-primary)] uppercase tracking-[0.05em] pl-0.5">
            Recommended
          </p>

          <div className="border-t border-[var(--hairline)] my-0.5" />

          {/* Web search toggle / live sources */}
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <Label className="cursor-pointer text-[11.5px] font-medium text-[var(--ink-secondary)]">
                Web search
              </Label>
              <p className="truncate text-[10.5px] text-[var(--ink-tertiary)]">
                Live sources beyond filings
              </p>
            </div>
            <Switch checked={true} className="shrink-0" />
          </div>

          <Button size="lg" className="w-full font-semibold mt-1 bg-[var(--accent-primary)] text-white">
            Start analysis
          </Button>
        </CardContent>
      </Card>
    ),
  },
  {
    n: "02",
    title: "Reasoning Step & Tool Trace",
    sub: "Copy of the exact AgentActivity log component rendering step durations, thoughts, and live tool calls.",
    visual: (
      <div className="w-full max-w-[480px] border border-[var(--hairline)] rounded-xl bg-[var(--surface-panel)] shadow-xl overflow-hidden text-left font-sans">
        {/* Agent Activity Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--hairline)] bg-[var(--surface-canvas)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] font-[family-name:var(--font-mono)] font-bold text-xs flex items-center justify-center shrink-0">
              W
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-[var(--ink-primary)] truncate">
                Reasoning history — INTERNATIONAL BUSINESS MACHINES CORP with Warren Buffett
              </h4>
              <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] truncate">
                gemini/gemini-3.5-flash-lite · full tool and thought trace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-[var(--signal-positive)]" />
            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--signal-positive)] font-semibold uppercase">FINISHED</span>
          </div>
        </div>

        {/* Trace Steps List */}
        <div className="p-3.5 flex flex-col gap-1.5 max-h-[320px] overflow-y-auto font-[family-name:var(--font-mono)] text-[11px]">
          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Load agent configuration</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">0.4s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Check data availability</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">5.7s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Ensure fresh data</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">4.3s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Quantitative scoring</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">5.2s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Qualitative scoring</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">77.5s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Summarize scoring tables</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">1.3s</span>
          </div>

          <div className="flex items-center justify-between text-[var(--ink-secondary)] py-0.5">
            <div className="flex items-center gap-2">
              <LuCheck className="w-3 h-3 text-[var(--signal-positive)] shrink-0" />
              <span>Finalize report</span>
            </div>
            <span className="text-[var(--ink-tertiary)]">6.8s</span>
          </div>

          {/* Tool Calls Log Box */}
          <div className="mt-2 p-2.5 rounded bg-[var(--surface-canvas)] border border-[var(--hairline)] flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[var(--accent-primary)] font-bold text-[10px]">
              <LuTerminal className="w-3 h-3" />
              <span>TOOL CALLS & DATA RETRIEVAL</span>
            </div>

            <div className="text-[10px] leading-relaxed text-[var(--ink-secondary)] space-y-1.5 border-t border-[var(--hairline)] pt-2">
              <div>
                <span className="text-[var(--signal-positive)] font-bold">✓ get_financial_metrics</span>
                <span className="text-[var(--ink-tertiary)] block font-mono">source=sec symbol=IBM filing_type=ttm</span>
                <p className="text-[var(--ink-tertiary)] font-mono text-[9.5px] truncate">
                  symbol: IBM peg_ratio: 0.40 net_margin: 11.02 price_data: live total_debt: 56,212,000,000 filing_type: ttm quick_ratio: 0.74 gross_margin: 57.53
                </p>
              </div>

              <div>
                <span className="text-[var(--signal-positive)] font-bold">✓ get_dcf_valuation</span>
                <span className="text-[var(--ink-tertiary)] block font-mono">source=sec symbol=IBM</span>
                <p className="text-[var(--ink-tertiary)] font-mono text-[9.5px]">
                  No free cash flow data available for IBM
                </p>
              </div>

              <div>
                <span className="text-[var(--signal-positive)] font-bold">✓ get_financial_metrics</span>
                <span className="text-[var(--ink-tertiary)] block font-mono">source=sec symbol=IBM filing_type=ttm</span>
                <p className="text-[var(--ink-tertiary)] font-mono text-[9.5px] truncate">
                  symbol: IBM peg_ratio: 0.40 n...
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    n: "03",
    title: "FIT Score & Verdict Summary",
    sub: "Direct copy of the headline score hero from the AnalysisResult page.",
    visual: (
      <div className="w-full max-w-[480px] border border-[var(--hairline)] rounded-xl bg-[var(--surface-panel)] shadow-xl p-5 flex flex-col gap-4 text-left">
        {/* Agent Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/40 text-[var(--accent-primary)] font-[family-name:var(--font-mono)] font-bold text-lg flex items-center justify-center">
            W
          </div>
          <div>
            <h4 className="text-base font-bold text-[var(--ink-primary)]">Warren Buffett</h4>
            <span className="text-xs text-[var(--ink-tertiary)]">Evaluated IBM (International Business Machines Corp)</span>
          </div>
        </div>

        {/* Hero Score Display */}
        <div className="flex items-baseline justify-between border-t border-b border-[var(--hairline)] py-4">
          <div>
            <span className="font-[family-name:var(--font-mono)] text-[11px] font-semibold text-[var(--ink-tertiary)] uppercase block mb-1">
              Total Score
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-mono)] text-5xl font-extrabold text-[var(--ink-primary)] tracking-tight">
                78.4
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xl font-bold text-[var(--ink-tertiary)]">
                / 100
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="outline" className="font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--signal-positive)] border-[var(--signal-positive)]/40 bg-[var(--signal-positive)]/10 px-3 py-1 rounded-full">
              STRONG FIT
            </Badge>
            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)] bg-[var(--surface-canvas)] border border-[var(--hairline)] px-2 py-0.5 rounded-full">
              100% of rubric scored
            </span>
          </div>
        </div>

        {/* Executive Verdict Callout */}
        <div className="p-3 rounded-lg bg-[var(--surface-canvas)] border border-[var(--hairline)]">
          <div className="flex items-center gap-2 font-bold text-xs text-[var(--ink-primary)] mb-1.5">
            <LuShieldCheck className="w-4 h-4 text-[var(--signal-positive)] shrink-0" />
            <span>Verdict Summary</span>
          </div>
          <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
            IBM satisfies key quantitative gates with strong return on equity and debt management. Qualitative scoring highlights significant economic moat, high management integrity, and consistent free cash flow generation.
          </p>
        </div>
      </div>
    ),
  },
];

export default function HowItWorks() {
  return (
    <div className="flex flex-col gap-16 md:gap-20">
      {STEPS.map((step, i) => {
        const isReversed = i === 1;

        return (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: dur.base, ease }}
          >
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-12 text-left">
              <div
                className={cn(
                  "flex flex-col gap-3 flex-1 max-w-[420px]",
                  isReversed ? "order-1 md:order-2" : "order-1"
                )}
              >
                <p className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[0.1em] text-[var(--accent-primary)]">
                  STEP {step.n}
                </p>
                <h3 className="text-xl md:text-2xl font-bold text-[var(--ink-primary)] leading-tight">
                  {step.title}
                </h3>
                <p className="text-sm md:text-base text-[var(--ink-secondary)] leading-relaxed">
                  {step.sub}
                </p>
              </div>

              <div
                className={cn(
                  "flex flex-1 justify-center items-center w-full",
                  isReversed ? "order-2 md:order-1" : "order-2"
                )}
              >
                {step.visual}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
