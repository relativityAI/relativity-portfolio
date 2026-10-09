/**
 * Investment style presets — v3 skill-based agents (decision D8).
 *
 * Each preset is metadata + philosophy + a curated skill list reflecting the
 * investor's core focus. Skill weights encode relative importance within the
 * agent's process. Also seeds the four default profiles for new users.
 */

import { randomUUID } from "node:crypto";
import { serializeAgentMd } from "./agentmd.js";

export interface PresetTemplateV3 {
  name: string;
  description: string;
  philosophy: string;
  skills: { skill_id: string; weight: number }[];
}

export const BUFFETT_PHILOSOPHY = `I treat every share purchase as buying a fractional stake in an actual business, not a ticker. I seek companies with durable competitive advantages — economic moats — that protect above-average returns on invested capital for decades. My moat view includes modern intangible assets: brand strength, network effects, intellectual property, and human capital. I demand honest, capable, shareholder-oriented managers who allocate capital rationally and widen the moat over time. I only buy when the price is meaningfully below my estimate of intrinsic value (margin of safety) and stay within my circle of competence — businesses I can understand and predict ten years out. I concentrate capital in my best ideas rather than diversify into ignorance, and I am willing to sit in cash when no margin of safety exists. My favorite holding period is forever; I ignore short-term noise and let compounding work. Earning power and return on equity matter far more than book value or quarterly price action.`;

export const ONEIL_PHILOSOPHY = `I follow the CAN SLIM framework, built from a study of every major stock market winner since 1880: current quarterly earnings up sharply and accelerating (C), strong annual earnings growth (A), something new — a product, management, or new price high (N), favorable supply and demand (S), the leader in a leading industry group (L), institutional sponsorship (I), and a market in a confirmed uptrend (M). I buy the highest-quality growth leaders when they emerge from a proper price base on heavy institutional volume, not laggards and not cheap stocks. The market direction filter is the most important: three out of four stocks follow the general market, so I only add exposure on a follow-through day and step aside once distribution days stack up. I cut every loss at no more than 7-8% below the buy point with no exceptions, and I let winners run. Discipline, not prediction, is my edge.`;

export const GROWTH_PHILOSOPHY = `I look for businesses compounding revenue and earnings at high rates because the market systematically underestimates how long exceptional companies can keep growing. Growth level matters less than trajectory — I want acceleration or stability, not deceleration — and it must be funded internally, bought with dilution or leverage is fragile. The engine has to live in a large and expanding industry with economics that let leaders convert growth into high returns on capital. I will pay up for quality and durability, but I watch the price of growth: a decelerating story on a premium multiple is where growth investors lose a decade of returns. I hold winners as long as the growth engine runs and re-examine everything when it stalls.`;

export const LYNCH_PHILOSOPHY = `Behind every stock is a company; find out what it's worth and pay a fair price for a growing business. I look for growth at a reasonable price: the P/E of any company ought to relate to its growth rate — that is the PEG discipline. I favor the categories I can understand — slow growers I buy for the dividend and patience, stalwarts for protection, fast growers and cyclicas at the right point in their story for the real money. I want simple businesses I can explain in a paragraph, strong balance sheets, insiders buying their own stock, and a story that still has room to run — a company whose product I can see spreading but which the institutions haven't fully discovered. I turn over many stones, expect my winners to make the whole portfolio, and I never time the market: selling great companies because the price wiggled is how you miss the next ten years.`;

export const PRESETS: Record<string, PresetTemplateV3> = {
  buffett: {
    name: "Warren Buffett",
    description: "Great businesses at a fair price — durable economic moats, honest management, margin of safety, held for the long term.",
    philosophy: BUFFETT_PHILOSOPHY,
    skills: [
      { skill_id: "dcf-valuation", weight: 9 },
      { skill_id: "growth-analysis", weight: 7 },
    ],
  },
  oneil: {
    name: "William O'Neil",
    description: "CAN SLIM — leading growth stocks breaking out of sound bases in a confirmed market uptrend; cut losses fast, let winners run.",
    philosophy: ONEIL_PHILOSOPHY,
    skills: [
      { skill_id: "technical-analysis", weight: 9 },
      { skill_id: "growth-analysis", weight: 9 },
    ],
  },
  growth: {
    name: "Growth Investor",
    description: "High-quality compounding machines — accelerating growth funded internally, expanding industries, price secondary to durability.",
    philosophy: GROWTH_PHILOSOPHY,
    skills: [
      { skill_id: "growth-analysis", weight: 9 },
      { skill_id: "dcf-valuation", weight: 7 },
    ],
  },
  lynch: {
    name: "Peter Lynch",
    description: "Growth at a reasonable price — understandable businesses, PEG discipline, insider buying, stories with room left to run.",
    philosophy: LYNCH_PHILOSOPHY,
    skills: [
      { skill_id: "growth-analysis", weight: 8 },
      { skill_id: "dcf-valuation", weight: 8 },
      { skill_id: "technical-analysis", weight: 5 },
    ],
  },
};

export function listPresets(): { key: string; name: string; description: string }[] {
  return Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description }));
}

export function getPreset(key: string): PresetTemplateV3 | null {
  return PRESETS[key] || null;
}

/** Serialize a preset to the v3 agent markdown. */
export function presetToMarkdown(preset: PresetTemplateV3): string {
  return serializeAgentMd({
    name: preset.name,
    description: preset.description,
    persona: { philosophy: preset.philosophy },
    skills: preset.skills,
  });
}

/** Seed rows for new users (the four default profiles). */
export function buildSeedAgents(userId: string): Record<string, unknown>[] {
  const now = new Date().toISOString();
  return Object.entries(PRESETS).map(([key, preset]) => ({
    id: randomUUID(),
    user_id: userId,
    name: preset.name,
    description: preset.description,
    source: "default",
    preset_key: key,
    persona: { philosophy: preset.philosophy },
    md_config: presetToMarkdown(preset),
    created_at: now,
    updated_at: now,
  }));
}
