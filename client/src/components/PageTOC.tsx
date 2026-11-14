import { useEffect, useState } from "react";

interface TOCEntry {
  id: string;
  label: string;
}

interface PageTOCProps {
  entries: TOCEntry[];
}

export default function PageTOC({ entries }: PageTOCProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav className="hidden lg:block" aria-label="On this page">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink-tertiary)]">
        On this page
      </p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className={`block text-[12px] leading-snug transition-colors duration-120 ${
                activeId === entry.id
                  ? "text-[var(--ink-primary)]"
                  : "text-[var(--ink-tertiary)] hover:text-[var(--ink-secondary)]"
              }`}
            >
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
