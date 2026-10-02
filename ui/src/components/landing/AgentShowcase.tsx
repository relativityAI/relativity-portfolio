import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Preset = {
  id: string;
  name: string;
  tagline: string;
  horizon: string;
  risk: number;
  philosophy: string;
  qual: { label: string; weight: number }[];
  quant: { metric: string; rule: string; weight: number }[];
};

const PRESETS: Preset[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    tagline: "Great businesses at a fair price, held for years",
    horizon: "Long-term",
    risk: 4,
    philosophy: "Focus on wide economic moats, predictable earnings, excellent management integrity, and conservative capital allocation.",
    qual: [
      { label: "Economic moat & pricing power", weight: 9 },
      { label: "Margin of safety on intrinsic value", weight: 9 },
      { label: "Management integrity & capital allocation", weight: 8 },
    ],
    quant: [
      { metric: "Return on Equity (ROE)", rule: "> 15%", weight: 8 },
      { metric: "Debt to Equity", rule: "< 0.5", weight: 7 },
      { metric: "P/E Ratio", rule: "< 25", weight: 6 },
    ],
  },
  {
    id: "oneil",
    name: "William O'Neil",
    tagline: "CAN SLIM — buy leaders breaking out, cut losses fast",
    horizon: "Positional",
    risk: 8,
    philosophy: "Combine strong quarterly/annual earnings acceleration with technical breakout setups and institutional support.",
    qual: [
      { label: "Current quarterly earnings acceleration", weight: 9 },
      { label: "New product, management or market high catalyst", weight: 8 },
      { label: "Market leader vs sector laggard", weight: 8 },
    ],
    quant: [
      { metric: "EPS Growth (YoY)", rule: "> 25%", weight: 9 },
      { metric: "RSI (14-day)", rule: "≥ 55", weight: 5 },
      { metric: "Price vs 200 SMA", rule: "> 0", weight: 6 },
    ],
  },
  {
    id: "garp",
    name: "GARP (Lynch / Fisher)",
    tagline: "Growth at a reasonable price — compounders, not story stocks",
    horizon: "Positional",
    risk: 7,
    philosophy: "Target well-run growth companies trading at reasonable valuations relative to their underlying earnings growth rate.",
    qual: [
      { label: "Simple, understandable business model", weight: 9 },
      { label: "High gross margin & pricing power", weight: 8 },
      { label: "Disciplined capital expenditure", weight: 7 },
    ],
    quant: [
      { metric: "PEG Ratio", rule: "< 1.5", weight: 9 },
      { metric: "Gross Margin", rule: "> 50%", weight: 7 },
      { metric: "Revenue Growth (3Y CAGR)", rule: "> 15%", weight: 8 },
    ],
  },
];

function usePreset(id: string) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

function CriteriaPanel({ preset }: { preset: Preset }) {
  const [activeTab, setActiveTab] = useState<"overview" | "persona" | "rules">("rules");

  return (
    <motion.div
      key={preset.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: dur.base, ease }}
      className="flex flex-col gap-4"
    >
      {/* Agent Card Header (copied from real Agent Settings UI) */}
      <div className="flex flex-col gap-3 p-4 rounded-lg bg-[var(--surface-canvas)] border border-[var(--hairline)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 flex items-center justify-center font-[family-name:var(--font-mono)] font-bold text-sm text-[var(--accent-primary)]">
              {preset.name.charAt(0)}
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--ink-primary)] leading-tight">
                {preset.name}
              </h3>
              <p className="text-xs text-[var(--ink-secondary)]">
                {preset.tagline}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--signal-positive)] border-[var(--signal-positive)]/30 bg-[var(--signal-positive)]/5">
            Active Agent
          </Badge>
        </div>

        {/* Configuration summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-[var(--hairline)]">
          <div>
            <span className="block font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] uppercase">Horizon</span>
            <span className="text-xs font-semibold text-[var(--ink-primary)]">{preset.horizon}</span>
          </div>
          <div>
            <span className="block font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] uppercase">Risk Appetite</span>
            <span className="text-xs font-semibold text-[var(--ink-primary)]">{preset.risk} / 10</span>
          </div>
          <div>
            <span className="block font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] uppercase">Qualitative</span>
            <span className="text-xs font-semibold text-[var(--ink-primary)]">{preset.qual.length} Criteria</span>
          </div>
          <div>
            <span className="block font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] uppercase">Quantitative</span>
            <span className="text-xs font-semibold text-[var(--ink-primary)]">{preset.quant.length} Gates</span>
          </div>
        </div>
      </div>

      {/* Tabs matching real Agent.tsx navigation */}
      <div className="flex border-b border-[var(--hairline)] gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("rules")}
          className={cn(
            "rounded-none border-b-2 font-[family-name:var(--font-mono)] text-xs h-8 px-2.5",
            activeTab === "rules"
              ? "border-[var(--accent-primary)] text-[var(--accent-primary)] font-semibold"
              : "border-transparent text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
          )}
        >
          Asset Evaluation
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("persona")}
          className={cn(
            "rounded-none border-b-2 font-[family-name:var(--font-mono)] text-xs h-8 px-2.5",
            activeTab === "persona"
              ? "border-[var(--accent-primary)] text-[var(--accent-primary)] font-semibold"
              : "border-transparent text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
          )}
        >
          Agent Persona
        </Button>
      </div>

      {activeTab === "rules" ? (
        <div className="flex flex-col gap-4 pt-1">
          {/* Qualitative checklist */}
          <div className="flex flex-col gap-2">
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-tertiary)]">
              QUALITATIVE — SCORED AS A CHECKLIST
            </p>
            {preset.qual.map((q, i) => (
              <div key={q.label} className="flex items-center justify-between gap-3 py-1.5 border-t border-t-[var(--hairline)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] w-[16px] shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-xs font-medium text-[var(--ink-primary)] truncate">
                    {q.label}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex gap-[3px]" aria-label={`weight ${q.weight} of 10`}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <div
                        key={j}
                        className={cn("w-[3px] h-[10px] rounded-[1px]", j < q.weight ? "bg-[var(--accent-primary)] border-none" : "bg-[var(--surface-recessed)] border border-[var(--hairline)]")}
                      />
                    ))}
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] w-[18px] text-right">
                    {q.weight}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Quantitative rules */}
          <div className="flex flex-col gap-2">
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-tertiary)]">
              QUANTITATIVE — DETERMINISTIC GATES
            </p>
            {preset.quant.map((q) => (
              <div key={q.metric} className="flex items-center justify-between gap-3 py-1.5 border-t border-t-[var(--hairline)]">
                <p className="text-xs font-medium text-[var(--ink-primary)] truncate">
                  {q.metric}
                </p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-[var(--accent-primary)] bg-[var(--surface-recessed)] border border-[var(--hairline)] rounded-sm px-2 py-0.5">
                    {q.rule}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)] w-[26px] text-right">
                    w {q.weight}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-2">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-tertiary)]">
            PHILOSOPHY & MINDSET
          </p>
          <p className="text-xs text-[var(--ink-secondary)] leading-relaxed italic bg-[var(--surface-canvas)] p-3 rounded border border-[var(--hairline)]">
            "{preset.philosophy}"
          </p>
        </div>
      )}
    </motion.div>
  );
}

export default function AgentShowcase() {
  const [activeId, setActiveId] = useState(PRESETS[0].id);
  const preset = usePreset(activeId);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="flex flex-col gap-2 max-w-[560px]">
        <p className="font-[family-name:var(--font-mono)] text-xs font-semibold tracking-[0.12em] text-[var(--accent-primary)]">
          CUSTOMIZABLE AGENT PROFILE
        </p>
        <h2 className="text-xl md:text-2xl font-bold text-[var(--ink-primary)] leading-tight">
          Borrow a legend or construct your own spec
        </h2>
        <p className="text-sm md:text-base text-[var(--ink-secondary)] leading-relaxed">
          Every agent is built using real settings UI: define qualitative checklists, quantitative gates, and investment philosophy.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-stretch md:items-start">
        {/* Preset selector */}
        <div className="flex flex-col gap-2.5 flex-1 min-w-0">
          {PRESETS.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                className={cn(
                  "text-left cursor-pointer border rounded-lg px-4 py-3 transition-all duration-200 active:scale-[0.985]",
                  active
                    ? "border-[var(--accent-primary)] bg-[var(--surface-panel)] shadow-sm"
                    : "border-[var(--hairline)] bg-transparent hover:border-[var(--grid-line)]"
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className={cn("text-sm font-bold", active ? "text-[var(--accent-primary)]" : "text-[var(--ink-primary)]")}>
                    {p.name}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-tertiary)]">
                    {p.horizon} · risk {p.risk}/10
                  </span>
                </div>
                <p className="text-xs text-[var(--ink-secondary)] leading-snug">
                  {p.tagline}
                </p>
              </button>
            );
          })}
        </div>

        {/* Real Agent Settings UI Preview */}
        <div className="flex-[1.4] min-w-0 border border-[var(--hairline)] rounded-xl bg-[var(--surface-panel)] px-4 py-4 md:px-5 md:py-5 shadow-lg">
          <AnimatePresence mode="wait">
            <CriteriaPanel preset={preset} />
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
