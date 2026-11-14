/**
 * Harness logger — self-contained so the module never reaches for the API's
 * logger (or anything else outside harness/). Same contract: leveled, tagged,
 * colored on a TTY. Verbosity via LOG_LEVEL (debug | info | warn | error),
 * colors via FORCE_COLOR / NO_COLOR.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const rawLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const configured: LogLevel = (rawLevel in RANK ? rawLevel : "info") as LogLevel;

const useColor = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== "0"
  : process.env.NO_COLOR === undefined && !!process.stdout.isTTY;

function paint(text: string, code: number): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

const LEVEL_STYLE: Record<LogLevel, number> = { debug: 36, info: 32, warn: 33, error: 31 };

const TAG_PALETTE = [36, 34, 35, 33, 96, 95, 94];

function tagColor(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

function emit(level: LogLevel, tag: string, args: unknown[]): void {
  if (RANK[level] < RANK[configured]) return;
  const head = `${paint(stamp(), 2)} ${paint(`[${level.toUpperCase()}]`, LEVEL_STYLE[level])} ${paint(tag, tagColor(tag))}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(head, ...args);
}

export const log = {
  debug: (tag: string, ...args: unknown[]) => emit("debug", tag, args),
  info: (tag: string, ...args: unknown[]) => emit("info", tag, args),
  warn: (tag: string, ...args: unknown[]) => emit("warn", tag, args),
  error: (tag: string, ...args: unknown[]) => emit("error", tag, args),
};
