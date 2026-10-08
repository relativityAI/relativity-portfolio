import { Link } from "react-router-dom";
import Logo from "@/components/Logo";

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-t-[var(--hairline)]">
      <div className="mx-auto max-w-[1100px] px-6 md:px-10 py-10 md:py-14">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo preset="landing" fontWeight={400} showMark={false} />
          <p className="text-sm text-[var(--ink-secondary)] max-w-[42ch] leading-relaxed">
            Research agents wired to live market data — filings, prices, and news in one score.
          </p>
          <nav className="flex items-center gap-6 md:gap-10 mt-3" aria-label="Footer">
            <Link to="/terms" className="text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
              Terms
            </Link>
            <Link to="/privacy" className="text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
              Privacy
            </Link>
            <Link to="/privacy" className="text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
              Support
            </Link>
          </nav>
          <p className="text-xs text-[var(--ink-tertiary)] mt-3">
            &copy; {new Date().getFullYear()} Relativity
          </p>

        </div>
      </div>
    </footer>
  );
}