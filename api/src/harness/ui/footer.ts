/**
 * Footer — the pinned status line. One line of truth: phase, step counter,
 * token budget with a mini bar, elapsed clock; a dim key hint under it when
 * the terminal is interactive.
 *
 * Degrades gracefully: no step counter until one finishes, no token segment
 * when the provider reported no usage (never NaN), shorter segments dropped
 * first on narrow terminals.
 */

import { G, dim, error, success, warn } from "./theme.js";
import { displayWidth, fmtDur, fmtTokens, truncate } from "./format.js";

export interface FooterInput {
  phase: string;
  /** Completed steps; undefined until the first step finishes. */
  step?: number;
  maxSteps: number;
  /** Cumulative output tokens; undefined when the provider reported no usage. */
  outputTokens?: number;
  maxTokens: number;
  elapsedMs: number;
  spinFrame: number;
  paused?: boolean;
  /** Show the `v verbose · ctrl+c stop` hint (interactive TTY only). */
  hint?: boolean;
}

const BAR_CELLS = 8;

export function budgetBar(outputTokens: number, maxTokens: number): string {
  const pct = maxTokens > 0 ? Math.min(1, outputTokens / maxTokens) : 0;
  const on = Math.round(pct * BAR_CELLS);
  const bar = G.barOn.repeat(on) + G.barOff.repeat(BAR_CELLS - on);
  const paint = pct > 0.95 ? error : pct > 0.8 ? warn : (s: string) => s;
  return `${paint(bar)} ${paint(`${Math.round(pct * 100)}%`)}`;
}

/** The status line (without the hint) — unit-testable on its own. */
export function statusLine(input: FooterInput): string {
  const parts: string[] = [`${dim(G.spin[input.spinFrame % G.spin.length])} ${input.paused ? warn("[paused]") : input.phase}`];
  if (input.step != null && Number.isFinite(input.step)) {
    parts.push(`step ${input.step}/${input.maxSteps}`);
  }
  const output = input.outputTokens;
  if (output != null && Number.isFinite(output) && output >= 0) {
    parts.push(`${fmtTokens(output)}/${fmtTokens(input.maxTokens)} ${budgetBar(output, input.maxTokens)}`);
  }
  parts.push(fmtDur(input.elapsedMs));
  return parts.join(" · ");
}

/** Footer block: status line (+ key hint when interactive). Always ≤ width. */
export function renderFooter(input: FooterInput, width: number): string[] {
  const lines = [truncate(statusLine(input), width)];
  if (input.hint && width >= 48) {
    lines.push(dim(truncate("v verbose · space pause · ctrl+c stop", width)));
  }
  return lines;
}

/** The completion line that replaces the footer when the run ends. */
export function finalLine(opts: {
  state: "complete" | "partial" | "failed" | "interrupted";
  elapsedMs: number;
  width: number;
  /** Five-band quality verdict — rides the line when the run produced one. */
  verdict?: string | null;
}): string {
  const glyph =
    opts.state === "complete" ? success(G.ok) : opts.state === "partial" ? warn("!") : error(G.err);
  const text =
    opts.state === "complete" ? "Report complete" : opts.state === "partial" ? "Report partial" : opts.state === "failed" ? "Run failed" : "Interrupted";
  const left = ` ${glyph} ${text}${opts.verdict ? ` · ${opts.verdict}` : ""}`;
  const right = fmtDur(opts.elapsedMs);
  const pad = opts.width - displayWidth(left) - displayWidth(right) - 1;
  return `${left}${" ".repeat(Math.max(1, pad))}${dim(right)}`;
}
