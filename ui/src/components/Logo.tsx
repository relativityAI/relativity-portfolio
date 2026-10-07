type Preset = "nav" | "landing" | "login";

const PRESETS: Record<Preset, { size: number; bg: string; color: string; fontSize: string }> = {
  nav: { size: 20, bg: "#1a1a1a", color: "#ffffff", fontSize: "12px" },
  landing: { size: 36, bg: "#1a1a1a", color: "#ffffff", fontSize: "16px" },
  login: { size: 24, bg: "#1a1a1a", color: "#ffffff", fontSize: "13px" },
};

export default function Logo({ preset = "nav", showWordmark = false }: { preset?: Preset; showWordmark?: boolean }) {
  const p = PRESETS[preset];
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: p.size,
        height: p.size,
        backgroundColor: p.bg,
        color: p.color,
        borderRadius: p.size * 0.25,
        fontFamily: "var(--font-display)",
        fontSize: p.fontSize,
        fontWeight: 700,
        flexShrink: 0,
      }}
      aria-label="R."
    >
      R.
    </div>
  );
}
