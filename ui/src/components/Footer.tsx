import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="flex px-4 md:px-16 py-3 md:py-5 mt-4 border-t border-t-[var(--hairline)] justify-between items-center gap-3 flex-wrap md:flex-nowrap">
      <p className="text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Relativity AI
      </p>
      <div className="flex gap-3 md:gap-4 items-center">
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
      </div>
    </footer>
  );
}
