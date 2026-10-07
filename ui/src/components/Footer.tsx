import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="flex flex-col px-4 md:px-16 py-6 md:py-8 mt-4 border-t border-t-[var(--hairline)] items-center justify-center gap-4 text-center">
      <div className="flex items-center gap-2 justify-center">
        <div
          className="flex items-center justify-center"
          style={{
            width: 24,
            height: 24,
            backgroundColor: "#1a1a1a",
            color: "#ffffff",
            borderRadius: 6,
            fontFamily: "var(--font-display)",
            fontSize: "12px",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          R.
        </div>
        <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--ink-primary)]">Relativity.</span>
      </div>
      <div className="flex gap-4 items-center justify-center">
        <Link
          to="/privacy"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Privacy
        </Link>
        <Link
          to="/terms"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Terms
        </Link>
        <a
          href="#support"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Support
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        &copy; 2026 Relativity AI
      </p>
    </footer>
  );
}
