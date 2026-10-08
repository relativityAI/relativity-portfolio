import { Button } from "@/components/ui/button";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import Footer from "@/components/Footer";
import resultScreenshot from "@/assets/hero-screenshot.png";
import { SOURCE_DEFS, SourceMark, type SourceKey } from "@/lib/sourceLogos";

const SOURCE_KEYS: SourceKey[] = ["nse", "sec", "voyager", "reddit", "youtube", "web"];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing h-full overflow-y-auto overflow-x-hidden relative bg-[var(--surface-canvas)]">
      <Helmet>
        <title>Relativity — Research agents on live market data</title>
        <meta name="description" content="Create research agents wired to live market data. They read filings, prices, and news, and score stocks against your thesis — no trade calls, no recommendations." />
        <meta property="og:title" content="Relativity — Research agents on live market data" />
        <meta property="og:description" content="Create research agents wired to live market data." />
      </Helmet>

      <header className="sticky top-0 z-50 px-4 md:px-8 py-4">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <Link to="/" aria-label="Relativity home" className="text-[var(--ink-primary)] select-none" style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 28 }}>
            Relativity.
          </Link>
          <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => navigate("/login")}>
            Log in
          </Button>
        </div>
      </header>

      <section className="max-w-[1500px] mx-auto px-4 md:px-8 pt-8 md:pt-12 pb-10 md:pb-14">
        <div className="grid lg:grid-cols-[2.1fr_1fr] gap-8 lg:gap-10 items-center">
          {/* Analysis result screenshot — kept as the first thing a visitor sees */}
          <div className="relative lg:-ml-4">
            <img
              src={resultScreenshot}
              alt="Relativity analysis result: a stock scored against an agent's rules with per-criterion breakdown"
              className="w-full h-auto rounded-2xl border border-[var(--hairline)] bg-[var(--surface-panel)] shadow-[0_40px_100px_-24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)]"
              style={{ display: "block" }}
              fetchPriority="high"
            />
          </div>

          {/* Short, plain-language pitch */}
          <div className="flex flex-col gap-5 lg:gap-6">
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.6rem,2.6vw,2.4rem)] leading-[1.15] font-normal tracking-[-0.01em] text-[var(--ink-primary)]">
              Relativity helps you create custom agents connected to real market data — so your research runs itself.
            </h1>

            <p className="text-base md:text-lg text-[var(--ink-secondary)] leading-relaxed max-w-[44ch]">
              Agents pull from filings, prices, and news, score stocks against your thesis, and show the reasoning.
            </p>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--ink-tertiary)]">Data sources</p>
              <div className="flex items-center gap-5">
                {SOURCE_KEYS.map((k) => (
                  <span key={k} title={SOURCE_DEFS[k].full} className="opacity-70 hover:opacity-100 transition-opacity duration-150 cursor-help flex items-center">
                    <SourceMark source={k} size={24} />
                  </span>
                ))}
              </div>
            </div>

            <Button
              size="lg"
              variant="default"
              className="w-fit min-h-[44px] hover:scale-[1.02] hover:shadow-[0_10px_30px_-10px_var(--accent-primary)] active:scale-[0.98]"
              onClick={() => navigate("/login")}
            >
              Get started
            </Button>
          </div>
        </div>
      </section>

      {/* What this is not — small, quiet, one line */}
      <section className="px-4 md:px-8 pb-4">
        <p className="text-center text-xs md:text-sm text-[var(--ink-tertiary)] max-w-[46ch] mx-auto leading-relaxed">
          Not investment advice · no trade calls · no hidden ranking — research only.
        </p>
      </section>

      <Footer />
    </div>
  );
}