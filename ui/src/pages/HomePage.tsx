import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";
import { Avatar, Style } from "@dicebear/core";
import pixelArtDefinition from "@dicebear/styles/pixel-art.json";

const pixelArt = new Style(pixelArtDefinition);

const AGENTS = [
  { name: "Indian Indices Sentiment Agent", verdict: "Nifty 50 shows strong upward momentum with rising volume.", seed: "momentum-agent", when: "Today, 09:45" },
  { name: "Indian Investor Sentiment Agent", verdict: "Current valuations are stretched relative to historical averages.", seed: "value-agent", when: "Today, 09:42" },
  { name: "US Indices Sentiment Agent", verdict: "Earnings quality remains stable across large-cap constituents.", seed: "quality-agent", when: "Today, 09:40" },
  { name: "US Investor Sentiment Agent", verdict: "Volatility is elevated; position sizing should be conservative.", seed: "risk-agent", when: "Today, 09:38" },
];

const SECTOR_AGENTS = [
  { name: "Nifty Pharma Agent", seed: "pharma-agent", when: "Today, 09:44" },
  { name: "Nifty Auto Agent", seed: "auto-agent", when: "Today, 09:43" },
  { name: "Nifty IT Agent", seed: "it-agent", when: "Today, 09:41" },
  { name: "Nifty Bank Agent", seed: "bank-agent", when: "Today, 09:40" },
  { name: "Nifty FMCG Agent", seed: "fmcg-agent", when: "Today, 09:39" },
  { name: "Nifty Metal Agent", seed: "metal-agent", when: "Today, 09:37" },
  { name: "Nifty Realty Agent", seed: "realty-agent", when: "Today, 09:36" },
  { name: "Nifty Energy Agent", seed: "energy-agent", when: "Today, 09:35" },
];

function AgentAvatar({ seed, size = 64 }: { seed: string; size?: number }) {
  const svg = useMemo(
    () =>
      new Avatar(pixelArt, { seed })
        .toString()
        .replace("<svg ", '<svg width="100%" height="100%" '),
    [seed]
  );
  return (
    <span
      className="inline-block flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${seed} avatar`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const INDICES = [
  { name: "Nifty 50", value: "24,500", chg: "+1.66%", ytd: "-11.1%", up: true, spark: [12, 14, 13, 15, 17, 16, 18, 20, 19, 22] },
  { name: "Nifty Bank", value: "48,200", chg: "+0.82%", ytd: "+5.2%", up: true, spark: [10, 11, 12, 11, 13, 14, 13, 15, 16, 15] },
  { name: "Nifty IT", value: "38,400", chg: "-0.34%", ytd: "+12.3%", up: false, spark: [14, 13, 15, 14, 16, 15, 17, 16, 18, 17] },
  { name: "Nifty Midcap", value: "12,800", chg: "+2.10%", ytd: "+8.7%", up: true, spark: [8, 10, 9, 11, 13, 12, 14, 16, 15, 18] },
];

const SECTORS = [
  { name: "Nifty IT", r1m: "+3.2%", r3m: "+8.0%", r1y: "+12.3%" },
  { name: "Nifty Bank", r1m: "+1.8%", r3m: "+4.1%", r1y: "+5.2%" },
  { name: "Nifty Pharma", r1m: "+2.4%", r3m: "+6.8%", r1y: "+15.1%" },
  { name: "Nifty Auto", r1m: "-1.2%", r3m: "-3.5%", r1y: "-2.8%" },
  { name: "Nifty Cement", r1m: "-4.1%", r3m: "-12.7%", r1y: "-8.3%" },
  { name: "Nifty FMCG", r1m: "+0.9%", r3m: "+2.3%", r1y: "+4.6%" },
];

const EVENTS = [
  { date: "Thu, 15 Oct", items: [
    { name: "Bonfiglioli Transmissions", desc: "IPO opens, closes 19 Oct" },
    { name: "HD Fire Protect", desc: "IPO closes" },
    { name: "Ravita Engineering", desc: "SME IPO closes" },
  ]},
  { date: "Thu, 22 Oct", items: [
    { name: "ANGELONE", desc: "Interim dividend, ex-date" },
    { name: "ADANIENSOL", desc: "Results, period ended Sep 2026" },
    { name: "INFY", desc: "Results, dividend, period ended Sep 2026" },
  ]},
];

const RATINGS = [
  { label: "Very poor", color: "#C0453F" },
  { label: "Poor", color: "#D97736" },
  { label: "Fair", color: "#C9A227" },
  { label: "Good", color: "#7FA650" },
  { label: "Excellent", color: "#4C8B6B" },
];

function LivePulse({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.5" fill="none" stroke="var(--signal-positive)" strokeWidth="1.25">
        <animate
          attributeName="r"
          values="2.5;7;2.5"
          dur="1.8s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          keyTimes="0;0.5;1"
        />
        <animate
          attributeName="opacity"
          values="0.7;0;0.7"
          dur="1.8s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          keyTimes="0;0.5;1"
        />
      </circle>
      <circle cx="8" cy="8" r="2.5" fill="var(--signal-positive)" />
    </svg>
  );
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 84, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? "var(--signal-positive)" : "var(--signal-negative)"} strokeWidth="1.5" />
    </svg>
  );
}

function BigChart() {
  const series = [
    { color: "#4db6ac", data: [20, 25, 22, 30, 28, 35, 32, 38, 36, 42, 40, 45] },
    { color: "#ffa726", data: [15, 18, 22, 20, 25, 23, 28, 26, 30, 28, 32, 30] },
    { color: "#ab47bc", data: [10, 14, 12, 18, 16, 20, 22, 19, 24, 22, 26, 24] },
    { color: "#ec407a", data: [8, 10, 14, 12, 16, 15, 18, 17, 20, 19, 22, 20] },
  ];
  const w = 680, h = 180;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" style={{ maxHeight: 220 }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="var(--hairline)" strokeWidth="1" />
      ))}
      {series.map((s, i) => {
        const max = Math.max(...s.data);
        const min = Math.min(...s.data);
        const range = max - min || 1;
        const pts = s.data.map((v, j) => `${(j / (s.data.length - 1)) * w},${h - ((v - min) / range) * (h - 10) - 5}`).join(" ");
        return <polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth="2" />;
      })}
    </svg>
  );
}

// Demo cells get a random rating once at module load — decorative, not state.
const RATED_AGENTS = AGENTS.map((a) => ({
  ...a,
  rating: RATINGS[Math.floor(Math.random() * RATINGS.length)],
}));
const RATED_SECTORS = SECTOR_AGENTS.map((s) => ({
  ...s,
  rating: RATINGS[Math.floor(Math.random() * RATINGS.length)],
}));

function AgentCell({ agent }: { agent: { name: string; seed: string; when: string; rating: { label: string; color: string } } }) {
  return (
    <div className="flex items-stretch gap-3 p-3 transition-colors hover:bg-[var(--surface-recessed)]">
      <AgentAvatar seed={agent.seed} size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-[family-name:var(--font-body)] text-[10px] font-normal tracking-wide text-[var(--ink-tertiary)]">
            {agent.when}
          </span>
          <LivePulse size={22} />
        </div>
        <h3 className="mt-1.5 font-[family-name:var(--font-display)] font-normal text-[var(--ink-primary)] text-lg leading-snug">{agent.name}</h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p
            className="text-xs font-[family-name:var(--font-body)] font-medium tracking-wide"
            style={{ color: agent.rating.color }}
          >
            {agent.rating.label}
          </p>
          <Link
            to="/analysis-list"
            className="inline-flex flex-shrink-0 items-center gap-1 font-[family-name:var(--font-body)] text-xs font-normal text-[#4A6E8E] hover:text-[var(--ink-primary)] transition-colors underline-offset-2 hover:underline cursor-pointer"
          >
            Read full
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9L9 3" />
              <path d="M4.5 3H9v4.5" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
      <div>
        {/* Hero — tagline left, agent grid right */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-14 pb-10 items-start">
          <div className="text-left">
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.5rem,4.5vw,4.5rem)] leading-[1.05] font-light tracking-[-0.02em] text-[var(--ink-primary)]">
              Agents watch the market, you watch the agents.
            </h1>
            <p className="mt-6 text-lg font-[family-name:var(--font-body)] font-[200] text-[var(--ink-secondary)] leading-relaxed">
              <span className="font-[family-name:var(--font-display)] font-normal text-[var(--ink-primary)]">Relativity</span> agents evaluate stocks and markets against a specific investment thesis. Every agent's reasoning and verdict is supported by citations to official data sources.
            </p>
          </div>

          <div>
            <p className="text-xs font-[family-name:var(--font-body)] font-light text-[var(--ink-tertiary)] mb-4">
              US/Indian market data based on your location.{" "}
              <a href="#" className="underline underline-offset-2 hover:text-[var(--ink-primary)] transition-colors cursor-pointer">
                View more markets
              </a>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RATED_AGENTS.map((a) => (
                <AgentCell key={a.name} agent={a} />
              ))}
            </div>
          </div>
        </div>

        {/* Sector agents */}
        <div className="pb-10">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="sectoral-title font-[family-name:var(--font-display)] font-normal text-[clamp(2rem,3.5vw,3rem)] leading-tight">
                Sectoral Agents
              </h2>
              <p className="mt-1 text-xs font-[family-name:var(--font-body)] font-[200] text-[var(--ink-tertiary)]">
                Nifty sector agents — one per segment, ranked by coverage.
              </p>
            </div>
            <a href="#" className="text-xs font-[family-name:var(--font-body)] font-normal text-[#4A6E8E] hover:text-[var(--ink-primary)] transition-colors underline-offset-2 hover:underline cursor-pointer whitespace-nowrap">
              View all sectors
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {RATED_SECTORS.map((s) => (
              <AgentCell key={s.name} agent={s} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="py-8 border-t border-[var(--hairline)]">
          <div className="grid grid-cols-3 gap-6 text-sm">
            <div>
              <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Product</h4>
              <div className="space-y-2 text-[var(--ink-secondary)]">
                <Link to="/new-analysis" className="block hover:text-[var(--ink-primary)]">New Analysis</Link>
                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">Runs</Link>
                <Link to="/agents" className="block hover:text-[var(--ink-primary)]">Agents</Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Company</h4>
              <div className="space-y-2 text-[var(--ink-secondary)]">
                <Link to="/privacy" className="block hover:text-[var(--ink-primary)]">Privacy</Link>
                <Link to="/terms" className="block hover:text-[var(--ink-primary)]">Terms</Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Resources</h4>
              <div className="space-y-2 text-[var(--ink-secondary)]">
                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">My Workspace</Link>
                <Link to="/settings" className="block hover:text-[var(--ink-primary)]">Settings</Link>
              </div>
            </div>
          </div>
          <p className="text-xs text-[var(--ink-tertiary)] text-center mt-8">
            Historical research, not investment advice. No trade calls, no recommendations.
          </p>
        </footer>
      </div>
    </div>
  );
}
