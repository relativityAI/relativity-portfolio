/**
 * Theme — the single place for colors, glyphs, and column widths.
 *
 * Five colors max (accent/success/warn/error/dim + bold), one glyph per
 * meaning, and a plain-mode switch that the renderer obeys: piped output,
 * CI, NO_COLOR and --plain all fall back to append-only lines with no
 * cursor control and no color.
 */

import { readFileSync } from "node:fs";
import pc from "picocolors";

let version = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string };
  if (pkg?.version) version = pkg.version;
} catch {
  // package.json not reachable (bundled) — keep the default.
}

export const VERSION = version;

/** Colors follow the classic NO_COLOR/FORCE_COLOR contract (captured at import). */
export const colorsEnabled =
  !process.env.NO_COLOR && (process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== "0" : !!process.stdout.isTTY);

// Our flag is the single source of truth — picocolors' own env sniffing may
// have run earlier (or in another module) under different conditions.
const p = pc.createColors(colorsEnabled);
const off = (s: string) => s;

export const accent = colorsEnabled ? p.cyan : off;
export const success = colorsEnabled ? p.green : off;
export const warn = colorsEnabled ? p.yellow : off;
export const error = colorsEnabled ? p.red : off;
export const dim = colorsEnabled ? p.dim : off;
export const bold = colorsEnabled ? p.bold : off;
export const italic = colorsEnabled ? p.italic : off;

/** Glyph set — one meaning each, no emoji roulette. */
export const G = {
  diamond: "◆",
  dot: "●",
  ok: "✓",
  err: "✗",
  arrow: "▸",
  think: "◦",
  compact: "⟲",
  spin: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const,
  barOn: "▰",
  barOff: "▱",
};

/** Fixed tool-line columns (label flexes and truncates to fit). */
export const COL = {
  /** indent + glyph + space */
  lead: 5,
  tool: 12,
  gap: 2,
  metric: 12,
  dur: 7,
};

/** Append-only mode: piped, CI, NO_COLOR, or --plain. */
export function detectPlain(out: { isTTY?: boolean } | undefined = process.stdout, explicit = false): boolean {
  if (explicit) return true;
  if (process.env.NO_COLOR) return true;
  if (process.env.CI) return true;
  return !out?.isTTY;
}
