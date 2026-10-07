import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import resultScreenshot from "@/assets/hero-screenshot.png";
import secLogo from "@/assets/sec_logo.png";
import nseLogo from "@/assets/nse_logo.png";
import redditLogo from "@/assets/reddit_logo.png";
import voyagerLogo from "@/assets/voyager_logo.png";
import youtubeLogo from "@/assets/youtube_logo.png";
import webLogo from "@/assets/web.svg";
import Footer from "@/components/Footer";

export default function Landing() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} className="landing h-full overflow-y-auto overflow-x-hidden relative bg-[var(--surface-canvas)]">
      <Helmet>
        <title>Relativity AI — Customizable Agents for Stock Analysis</title>
        <meta name="description" content="Create custom agents connected to real market data to automate your research process." />
      </Helmet>

      <header className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                backgroundColor: "#1a1a1a",
                color: "#ffffff",
                borderRadius: 6,
                fontFamily: "var(--font-display)",
                fontSize: "14px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              R.
            </div>
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--ink-primary)]">Relativity.</span>
          </div>
          <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => navigate("/login")}>
            Log in
          </Button>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 md:px-6 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
          <div className="flex justify-start">
            <div className="w-full max-w-[980px] rounded-2xl overflow-hidden border border-[var(--hairline)] bg-[var(--surface-panel)] shadow-sm">
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
                alt="Relativity analysis result"
                style={{ display: "block", width: "100%", height: "auto" }}
                fetchPriority="high"
              />
            </div>
          </div>

          <div className="flex flex-col gap-6 md:gap-8">
            <div>
              <p className="text-lg md:text-xl text-[var(--ink-primary)] leading-relaxed max-w-[60ch] font-[family-name:var(--font-body)]">
                Relativity helps you create custom agents which are connected to real market data for you to automate your research process.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--ink-secondary)] font-[family-name:var(--font-body)]">Data sources</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={nseLogo} alt="NSE" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    NSE
                  </span>
                </div>
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={secLogo} alt="SEC" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    SEC
                  </span>
                </div>
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={redditLogo} alt="Reddit" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    Reddit
                  </span>
                </div>
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={voyagerLogo} alt="Voyager" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    Voyager
                  </span>
                </div>
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={youtubeLogo} alt="YouTube" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    YouTube
                  </span>
                </div>
                <div className="group relative flex items-center justify-center p-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-panel)]">
                  <img src={webLogo} alt="Web" className="h-6 w-auto object-contain" />
                  <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-inverse)] px-2 py-1 text-xs text-[var(--ink-inverse-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    Web
                  </span>
                </div>
              </div>
            </div>

            <div>
              <Button
                size="lg"
                variant="default"
                onClick={() => navigate("/login")}
              >
                Get started
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}