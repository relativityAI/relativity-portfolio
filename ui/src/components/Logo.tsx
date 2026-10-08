type Preset = "nav" | "landing" | "login";

const PRESETS: Record<Preset, { mark: number; word: number; showWord: boolean }> = {
  // Wordmark is sized ~62% of the mark's cap height so the lockup reads as
  // one Newsreader brand unit rather than a big glyph with a small word.
  nav: { mark: 22, word: 14, showWord: true },
  landing: { mark: 32, word: 20, showWord: true },
  login: { mark: 24, word: 15, showWord: true },
};

/**
 * Brand mark. The mark is a single "R." set in the display face with no
 * favicon-style tile — it stays legible on every surface in both themes.
 */
export default function Logo({ preset = "nav", showWordmark = true, showMark = true, fontWeight }: { preset?: Preset; showWordmark?: boolean; showMark?: boolean; fontWeight?: number }) {
  const p = PRESETS[preset];
  return (
    <div className="flex items-center gap-2 min-w-0">
      {showMark && (
        <span
          className="leading-none text-[var(--ink-primary)] select-none shrink-0"
          style={{ fontFamily: "var(--font-display)", fontSize: p.mark, fontWeight: fontWeight ?? 700 }}
          aria-label="Relativity."
          role="img"
        >
          R.
        </span>
      )}
      {showWordmark && p.showWord && (
        <span
          className="text-[var(--ink-primary)] tracking-tight overflow-hidden text-ellipsis whitespace-nowrap max-[379px]:hidden"
          style={{ fontFamily: "var(--font-display)", fontSize: p.word, fontWeight: fontWeight ?? 600 }}
        >
          Relativity.
        </span>
      )}
    </div>
  );
}