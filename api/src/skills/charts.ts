/**
 * charts — code-grounded assembly of skill-declared charts (decision D5).
 *
 * Chart data NEVER comes from the LLM. Each skill's Charts section declares
 * specs like `type: candlestick | data: price_daily`; this module resolves
 * those specs against real data (market-data client, tool evidence, metrics
 * snapshot) and emits report blocks. Specs that can't be grounded are dropped,
 * never faked.
 */

import { getPriceHistory } from "../marketdata.js";
import { VoyagerClient } from "../voyager.js";
import { log } from "../logger.js";
import type { ReportBlock } from "../agent.js";
import type { ResolvedSkill } from "./resolve.js";
import type { ChartType, SkillOutput } from "./types.js";

interface ChartRequestIndex {
  /** skill_id -> requested spec indices (deduped, ordered). */
  bySkill: Map<string, Set<number>>;
}

function requestedSpecs(outputs: SkillOutput[], skills: ResolvedSkill[]): ChartRequestIndex {
  const bySkill = new Map<string, Set<number>>();
  for (const o of outputs) {
    const idx = new Set<number>();
    for (const req of o.chart_requests || []) idx.add(req.spec_index);
    bySkill.set(o.skill_id, idx);
  }
  // A skill that declares charts in its Charts section expects them in the
  // report — the analyst's chart_requests are advisory (small models often
  // omit them), never a veto. Include every declared spec; ungroundable ones
  // are dropped per-spec below, never faked.
  for (const { skill } of skills) {
    if (!bySkill.has(skill.id)) bySkill.set(skill.id, new Set());
    if (skill.charts?.length) {
      const idx = bySkill.get(skill.id)!;
      skill.charts.forEach((_, i) => idx.add(i));
    }
  }
  return { bySkill };
}

async function candlestickBlock(title: string, symbol: string, source?: string): Promise<ReportBlock | null> {
  const history = await getPriceHistory(symbol, "2y", source);
  if (!history || history.candles.length < 30) return null;
  // Downsample to ~120 points so the payload stays bounded. SMA overlays ride
  // along on the same rows so the ECharts view draws them.
  const step = Math.max(1, Math.ceil(history.candles.length / 120));
  const byDate = (series: { date: string; value: number | null }[]) => {
    const m = new Map<string, number>();
    for (const s of series) if (s.value != null) m.set(s.date, s.value);
    return m;
  };
  const s20 = byDate(history.sma20);
  const s50 = byDate(history.sma50);
  const s200 = byDate(history.sma200);
  const data = history.candles
    .filter((_, i) => i % step === 0)
    .map((c) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      sma20: s20.get(c.date) ?? "",
      sma50: s50.get(c.date) ?? "",
      sma200: s200.get(c.date) ?? "",
    }));
  return {
    type: "chart",
    chartType: "candlestick",
    title,
    data,
    // "code:" prefix = assembled deterministically from a real data feed, not
    // authored by the model. The numeric-integrity gate exempts these blocks
    // (their figures come from the price history itself, which is provenance,
    // not something the model could have invented).
    sourceKeys: ["code:marketdata.price_history"],
  } as unknown as ReportBlock;
}

/** Daily close + SMA 20/50/200 overlay for a technical-analysis line chart. */
async function priceSmaBlock(title: string, symbol: string, source?: string): Promise<ReportBlock | null> {
  const history = await getPriceHistory(symbol, "2y", source);
  if (!history || history.candles.length < 30) return null;
  const step = Math.max(1, Math.ceil(history.candles.length / 120));
  const byDate = (series: { date: string; value: number | null }[]) => {
    const m = new Map<string, number>();
    for (const s of series) if (s.value != null) m.set(s.date, s.value);
    return m;
  };
  const s20 = byDate(history.sma20);
  const s50 = byDate(history.sma50);
  const s200 = byDate(history.sma200);
  const data = history.candles
    .filter((_, i) => i % step === 0)
    .map((c) => ({
      date: c.date,
      close: c.close,
      sma20: s20.get(c.date) ?? "",
      sma50: s50.get(c.date) ?? "",
      sma200: s200.get(c.date) ?? "",
    }));
  return {
    type: "chart",
    chartType: "line",
    title,
    data,
    sourceKeys: ["code:marketdata.price_history"],
  } as unknown as ReportBlock;
}

async function rsiBlock(title: string, symbol: string, source?: string): Promise<ReportBlock | null> {
  const history = await getPriceHistory(symbol, "2y", source);
  if (!history) return null;
  const values = history.rsi14.filter((r) => r.value != null);
  if (values.length < 5) return null;
  const step = Math.max(1, Math.ceil(values.length / 120));
  return {
    type: "chart",
    chartType: "line",
    title,
    data: values.filter((_, i) => i % step === 0).map((r) => ({ date: r.date, rsi: r.value as number })),
    sourceKeys: ["code:marketdata.rsi14"],
  } as unknown as ReportBlock;
}

/** Recent daily volume bars — keeps the volume chart readable and real. */
async function volumeBlock(title: string, symbol: string, source?: string): Promise<ReportBlock | null> {
  const history = await getPriceHistory(symbol, "2y", source);
  if (!history) return null;
  const recent = history.candles.slice(-63);
  if (recent.length < 5) return null;
  return {
    type: "chart",
    chartType: "bar",
    title,
    data: recent.map((c) => ({ date: c.date, volume: c.volume })),
    sourceKeys: ["code:marketdata.price_history"],
  } as unknown as ReportBlock;
}

/**
 * Volume Profile — horizontal volume-at-price histogram from the Voyager
 * Advanced Data Suite Technicals report (GET /technicals,
 * `volume_profile.bins`). Each row is a price bin with its traded volume, so
 * the report can show where the market actually did business (POC, value
 * area) rather than a plain time-series of volume.
 */
async function volumeProfileBlock(
  title: string,
  voyager: VoyagerClient,
  symbol: string,
  source: string,
): Promise<ReportBlock | null> {
  const report = await voyager.getTechnicals(symbol, { source, sections: ["volume_profile"] });
  const bins = report?.sections?.volume_profile?.data?.bins;
  if (!Array.isArray(bins) || bins.length < 3) return null;
  const rows = bins
    .filter((b: any) => typeof b?.volume === "number" && typeof b?.price_low === "number")
    .map((b: any) => ({
      name: `${Number(b.price_low).toFixed(0)}–${Number(b.price_high ?? b.price_low).toFixed(0)}`,
      volume: Math.round(b.volume),
    }));
  if (rows.length < 3) return null;
  return {
    type: "chart",
    chartType: "bar",
    title,
    data: rows,
    sourceKeys: ["code:voyager.technicals.volume_profile"],
  } as unknown as ReportBlock;
}

/**
 * Multi-timeframe signal matrix — bull/bear signal counts per timeframe
 * (intraday/daily/weekly/monthly) from `mtf_signal_matrix` in the Technicals
 * report. Grounds the "which timeframe agrees" discussion in the report's own
 * counts instead of prose.
 */
async function mtfMatrixBlock(
  title: string,
  voyager: VoyagerClient,
  symbol: string,
  source: string,
): Promise<ReportBlock | null> {
  const report = await voyager.getTechnicals(symbol, { source, sections: ["mtf_signal_matrix"] });
  const rowsRaw = report?.sections?.mtf_signal_matrix?.data;
  if (!Array.isArray(rowsRaw) || rowsRaw.length < 2) return null;
  const rows = rowsRaw
    .filter((r: any) => typeof r?.timeframe === "string" && r.state !== "unavailable")
    .map((r: any) => ({
      name: String(r.timeframe),
      bullish: typeof r.bull === "number" ? r.bull : 0,
      bearish: typeof r.bear === "number" ? r.bear : 0,
    }));
  if (rows.length < 2) return null;
  return {
    type: "chart",
    chartType: "bar",
    title,
    data: rows,
    sourceKeys: ["code:voyager.technicals.mtf_signal_matrix"],
  } as unknown as ReportBlock;
}

/**
 * Ground a generic series key (revenue_by_quarter, margin_series, …) from the
 * per-skill tool evidence the analysts actually gathered. The LLM never types
 * chart values — only series the tools really returned get plotted.
 */
function evidenceSeriesBlock(
  spec: { type: ChartType; title: string; data: string; note?: string },
  evidence: Record<string, unknown>[],
): ReportBlock | null {
  const rows = extractSeries(evidence, spec.data);
  if (rows.length < 2) return null;
  const type: "line" | "bar" = spec.type === "bar" ? "bar" : "line";
  return {
    type: "chart",
    chartType: type,
    title: spec.title,
    data: rows,
    sourceKeys: ["code:skill_tool_evidence"],
  } as unknown as ReportBlock;
}

/**
 * Fallback for a skill that declared no (or only ungroundable) charts: a
 * close-price context chart for the analyzed symbol. Every skill's section of
 * the report must carry at least one plot — this guarantees the mandate with
 * real market data, never model-invented numbers.
 */
async function priceContextBlock(symbol: string, source?: string): Promise<ReportBlock | null> {
  const history = await getPriceHistory(symbol, "2y", source);
  if (!history || history.candles.length < 30) return null;
  const recent = history.candles.slice(-180);
  const step = Math.max(1, Math.ceil(recent.length / 120));
  return {
    type: "chart",
    chartType: "line",
    title: `Price context — ${symbol} closing price, last 6 months`,
    data: recent.filter((_, i) => i % step === 0).map((c) => ({ date: c.date, close: c.close })),
    sourceKeys: ["code:marketdata.price_history"],
  } as unknown as ReportBlock;
}

/**
 * Try to pull a plot-worthy series out of tool evidence for a named series key
 * ("revenue_by_quarter", "peer_benchmark", …). Matches are semantic: the key's
 * words must appear in a tool result near a plottable array. Conservative by
 * design — an unresolvable key returns nothing and the chart is dropped.
 */
function extractSeries(evidence: Record<string, unknown>[], seriesKey: string): Record<string, string | number>[] {
  const want = seriesKey.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const words = seriesKey.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const findRows = (v: unknown): Record<string, string | number>[] | null => {
    if (Array.isArray(v) && v.length >= 2 && v.length <= 60) {
      const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      if (objs.length >= 2) {
        const keys = new Set(objs.flatMap((o) => Object.keys(o)));
        const labelKey = ["name", "label", "period", "date", "quarter", "fiscal_year", "year"].find((k) =>
          [...keys].some((kk) => kk.toLowerCase() === k),
        );
        const numeric = [...keys].filter((k) =>
          objs.some((o) => typeof o[k] === "number" && Number.isFinite(o[k] as number)),
        );
        if (labelKey && numeric.length >= 1) {
          const rows = objs.slice(0, 24).map((o) => {
            const row: Record<string, string | number> = { name: String(o[labelKey] ?? "") };
            for (const k of numeric.slice(0, 3)) row[k] = o[k] as number;
            return row;
          });
          return rows;
        }
      }
    }
    if (v && typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) {
        const found = findRows(val);
        if (found) return found;
      }
    }
    return null;
  };
  // Prefer exact key match on arrays (e.g. result.financials.revenue_by_quarter).
  const exact = (v: unknown, path: string): Record<string, string | number>[] | null => {
    const p = path.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (p === want) return findRows(v);
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const found = exact(val, `${path}.${k}`);
        if (found) return found;
      }
    }
    return null;
  };
  for (const ev of evidence) {
    const found = exact(ev, typeof ev.tool === "string" ? ev.tool : "");
    if (found) return found;
  }
  // Fall back to semantic match: an array of labelled rows in a result whose
  // path mentions the series key's words (revenue, margin, peer…).
  const semantic = (v: unknown, path: string): Record<string, string | number>[] | null => {
    const p = path.toLowerCase();
    if (words.length && words.every((w) => p.includes(w))) {
      const found = findRows(v);
      if (found) return found;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const found = semantic(val, `${path}.${k}`);
        if (found) return found;
      }
    }
    return null;
  };
  for (const ev of evidence) {
    const found = semantic(ev, typeof ev.tool === "string" ? ev.tool : "");
    if (found) return found;
  }
  return [];
}

/**
 * Assemble report blocks for every declared chart spec that can be grounded
 * in real data: market data for price/RSI/volume specs, and the per-skill
 * tool evidence for series specs. Unresolvable specs are dropped with a log
 * line — never faked.
 *
 * MANDATE: every skill contributes at least one chart to the report. A skill
 * whose declared specs all fail to ground gets a code-assembled price-context
 * chart for the analyzed symbol (real market data, no invented numbers).
 */
export async function assembleSkillCharts(
  outputs: SkillOutput[],
  skills: ResolvedSkill[],
  symbol: string,
  toolEvidence?: Record<string, unknown>[],
  voyager?: VoyagerClient,
  source = "nse",
): Promise<ReportBlock[]> {
  const { bySkill } = requestedSpecs(outputs, skills);
  const blocks: ReportBlock[] = [];
  const groundedPerSkill = new Map<string, number>();
  const priceDataKeys = new Set(["price_daily", "price", "candles", "ohlcv", "rsi_series", "volume_series"]);

  for (const { skill } of skills) {
    const specs = skill.charts || [];
    const wanted = bySkill.get(skill.id) || new Set<number>();
    for (const i of wanted) {
      const spec = specs[i];
      if (!spec) continue;
      const title = spec.title;
      const key = spec.data.trim().toLowerCase();
      try {
        if (spec.type === "candlestick" && priceDataKeys.has(key)) {
          const block = await candlestickBlock(title, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          } else log.warn("charts", `[${skill.id}] candlestick dropped — no price history for ${symbol}`);
          continue;
        }
        if ((spec.type === "line" || spec.type === "candlestick") && (key === "price_sma" || key === "price_with_sma" || key === "price_daily")) {
          const block = await priceSmaBlock(title, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          } else log.warn("charts", `[${skill.id}] price/SMA chart dropped — no price history for ${symbol}`);
          continue;
        }
        if (spec.type === "line" && key === "rsi_series") {
          const block = await rsiBlock(title, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          }
          continue;
        }
        if (spec.type === "bar" && key === "volume_series") {
          const block = await volumeBlock(title, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          }
          continue;
        }
        // Voyager Advanced Data Suite Technicals specs — grounded against the
        // live GET /technicals report, section-scoped so each spec costs one
        // cheap call instead of the full 60-section pull.
        if (voyager && key === "technicals_volume_profile") {
          const block = await volumeProfileBlock(title, voyager, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          } else log.warn("charts", `[${skill.id}] volume-profile chart dropped — no bins for ${symbol}`);
          continue;
        }
        if (voyager && key === "technicals_mtf_matrix") {
          const block = await mtfMatrixBlock(title, voyager, symbol, source);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
          } else log.warn("charts", `[${skill.id}] MTF-matrix chart dropped — no signal matrix for ${symbol}`);
          continue;
        }
        // Generic series keys (revenue_by_quarter, margin_series, peer…)
        // ground against the tool evidence this run's analysts actually
        // gathered. Ungroundable specs are dropped, never invented.
        if (toolEvidence?.length) {
          const block = evidenceSeriesBlock(spec, toolEvidence);
          if (block) {
            blocks.push(block);
            groundedPerSkill.set(skill.id, (groundedPerSkill.get(skill.id) || 0) + 1);
            continue;
          }
        }
        log.info("charts", `[${skill.id}] chart spec "${spec.data}" dropped — could not be grounded in real tool data`);
      } catch (e: any) {
        log.warn("charts", `[${skill.id}] chart "${title}" failed: ${e?.message}`);
      }
    }
  }

  // The chart mandate: a skill with zero grounded charts still contributes a
  // plot — the symbol's price context, assembled from real market data.
  for (const { skill } of skills) {
    if ((groundedPerSkill.get(skill.id) || 0) > 0) continue;
    try {
      const fallback = await priceContextBlock(symbol, source);
      if (fallback) {
        blocks.push(fallback);
        log.info("charts", `[${skill.id}] no declared chart grounded — price-context fallback added`);
      }
    } catch (e: any) {
      log.warn("charts", `[${skill.id}] price-context fallback failed: ${e?.message}`);
    }
  }

  return blocks;
}

/**
 * Deterministic score visualizations — the run's own results, plotted from
 * the computed aggregate (never the model's words). One radar across scored
 * skills when ≥3 scored (a radar with fewer axes reads as decoration), and
 * one bar of every per-skill score. Data is code-transcribed from the same
 * `agg` the scorecard tables read, so it can't drift from the hero number.
 */
export function buildSkillScoreCharts(
  outputs: { skill_id: string; skill_name: string; score_0_100?: number | null; error?: string }[],
  perSkill: { skill_id: string; score_0_100: number | null }[],
  /** Null when the headline total was suppressed for thin coverage. */
  totalScore: number | null,
): ReportBlock[] {
  const scoreOf = new Map(perSkill.map((s) => [s.skill_id, s.score_0_100]));
  const scored = outputs
    .filter((o) => !o.error && typeof scoreOf.get(o.skill_id) === "number")
    .map((o) => ({ name: o.skill_name, score: scoreOf.get(o.skill_id) as number }));
  if (scored.length === 0) return [];

  const blocks: ReportBlock[] = [];

  if (scored.length >= 3) {
    blocks.push({
      type: "chart",
      chartType: "radar",
      title: "Skill score profile",
      data: scored.map((s) => ({ name: s.name, score: s.score })),
      sourceKeys: ["code:aggregate.per_skill"],
    } as unknown as ReportBlock);
  }

  blocks.push({
    type: "chart",
    chartType: "bar",
    title:
      totalScore != null
        ? `Skill scores — weighted aggregate ${Math.round(totalScore * 10) / 10}`
        : "Skill scores — weighted aggregate suppressed (coverage below the reliability floor)",
    data: scored.map((s) => ({ name: s.name, score: Math.round(s.score * 10) / 10 })),
    sourceKeys: ["code:aggregate.per_skill"],
  } as unknown as ReportBlock);

  return blocks;
}

/**
 * Flatten per-skill tool-call records into the evidence list the chart
 * grounder reads. Each entry keeps the tool name (the semantic path prefix)
 * plus its parsed result — no LLM text, tool output only.
 */
export function toolEvidenceForCharts(toolCalls: Record<string, unknown[]> | undefined): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [param, calls] of Object.entries(toolCalls || {})) {
    for (const c of Array.isArray(calls) ? calls : []) {
      if (!c || typeof c !== "object") continue;
      const rec = c as any;
      if (rec.status === "ERR") continue;
      let result: unknown = rec.result;
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          continue;
        }
      }
      if (result && typeof result === "object") {
        const toolName = typeof rec.tool_name === "string" ? rec.tool_name : typeof rec.tool === "string" ? rec.tool : param;
        out.push({ tool: toolName, result });
      }
    }
  }
  return out;
}
