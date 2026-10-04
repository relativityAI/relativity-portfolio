/**
 * reportGate — deterministic consistency checks over the synthesized report (WS-2).
 *
 * The KEI eval found the report contradicting itself: "Momentum is constructive"
 * while RSI fell 73→33; "matrix does not contradict" while weekly was 4-bear/0-bull.
 * This gate checks the finished prose against the code-computed facts pack and
 * blocks, regenerates, or stamps low confidence on contradiction.
 *
 * Every check is deterministic and testable — no LLM in the loop.
 */

import type { AnalysisReport, ReportBlock } from "./agent.js";

export interface GateResult {
  pass: boolean;
  /** Factual contradictions — the report disagrees with its own figures. Blocks. */
  issues: string[];
  /** Vagueness / hedging — the prose is sloppy but not false. Never blocks. */
  warnings: string[];
}

interface Facts {
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  price: number | null;
  levelMapAvailable: boolean;
  mtf: { timeframe: string; bull: number; bear: number }[];
  volumeRatioMax: number | null;
  /** P0-2 interpretation tags, parsed back out of the READING lines. */
  reading: {
    oversoldTimeframes: string[];
    overboughtTimeframes: string[];
    macdLevel: string | null;
    macdMomentum: string | null;
    macdDisagree: boolean;
    maStack: string | null;
    regime: string | null;
    vwapState: string | null;
    volumeState: string | null;
  } | null;
}

function parseFacts(factsPack: string): Facts {
  const f: Facts = {
    rsi14: null,
    sma20: null,
    sma50: null,
    sma200: null,
    price: null,
    levelMapAvailable: true,
    mtf: [],
    volumeRatioMax: null,
    reading: null,
  };
  if (!factsPack) return f;
  const grab = (re: RegExp): number | null => {
    const m = factsPack.match(re);
    return m ? Number(m[1]) : null;
  };
  f.rsi14 = grab(/rsi14=([\d.]+)/);
  f.sma20 = grab(/sma20=([\d.]+)/);
  f.sma50 = grab(/sma50=([\d.]+)/);
  f.sma200 = grab(/sma200=([\d.]+)/);
  f.price = grab(/price=([\d.]+)/);
  f.volumeRatioMax = grab(/volume_ratio_max=([\d.]+)/);
  if (/level map: INSUFFICIENT/.test(factsPack)) f.levelMapAvailable = false;
  const mtfMatch = factsPack.match(/mtf_matrix: (.+)/);
  if (mtfMatch) {
    for (const part of mtfMatch[1].split(";")) {
      const m = part.trim().match(/(\w+):\s*(\d+)\s*bull\s*\/\s*(\d+)\s*bear/);
      if (m) f.mtf.push({ timeframe: m[1], bull: Number(m[2]), bear: Number(m[3]) });
    }
  }

  // READING tags (P0-2). Only set when the pack actually carries them, so a
  // pack built before this landed simply skips the interpretation checks.
  const rsiLine = factsPack.match(/READING rsi: ([^\n]*)/);
  const macdLine = factsPack.match(/READING macd: ([^\n]*)/);
  const maLine = factsPack.match(/READING ma_stack: (\w+)/);
  const regimeLine = factsPack.match(/READING regime: ([\w_]+)/);
  const vwapLine = factsPack.match(/READING vwap: price is (\w+)/);
  const volLine = factsPack.match(/READING volume: [^)]*\((supportive|weak|normal)\)/);
  if (rsiLine || macdLine || maLine || regimeLine) {
    // Read the ZONE per timeframe (`daily=36.45 (neutral)`), never the verdict
    // clause — scraping "(\w+) oversold" out of "no timeframe is oversold or
    // overbought" captured the word "is" and reported an oversold reading.
    const zones = rsiLine ? [...rsiLine[1].matchAll(/(\w+)=[\d.]+\s*\((\w+)\)/g)] : [];
    f.reading = {
      oversoldTimeframes: zones.filter((m) => m[2] === "oversold").map((m) => m[1]),
      overboughtTimeframes: zones.filter((m) => m[2] === "overbought").map((m) => m[1]),
      macdLevel: macdLine?.[1].match(/level=(\w+)/)?.[1] ?? null,
      macdMomentum: macdLine?.[1].match(/momentum=(\w+)/)?.[1] ?? null,
      macdDisagree: !!macdLine && /DISAGREE/.test(macdLine[1]),
      maStack: maLine?.[1] ?? null,
      regime: regimeLine?.[1] ?? null,
      vwapState: vwapLine?.[1]?.toLowerCase() ?? null,
      volumeState: volLine?.[1] ?? null,
    };
  }
  return f;
}

/** Extract all human-readable prose from the report blocks. */
function extractProse(report: AnalysisReport): string {
  const parts: string[] = [];
  const visit = (block: ReportBlock): void => {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "callout":
      case "quote":
        parts.push(block.text || "");
        break;
      case "table":
        for (const row of block.rows || []) {
          for (const cell of row) parts.push(String(cell));
        }
        break;
      case "chart":
        if (block.title) parts.push(block.title);
        break;
    }
  };
  for (const block of report.blocks || []) visit(block);
  return parts.join("\n");
}

/** Split prose into sentences for per-sentence checks. */
function sentences(prose: string): string[] {
  return prose
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True when `re` matches an actual ASSERTION in the sentence.
 *
 * Negated mentions are not claims: "no timeframe is oversold or overbought"
 * and "a pullback rather than an aligned downtrend" both contain the trigger
 * words while saying the opposite. Looks only at the 60 chars before the match
 * so "not" for one clause cannot excuse a claim in another.
 */
function asserted(s: string, re: RegExp): boolean {
  const m = s.match(re);
  if (!m || m.index == null) return false;
  const before = s.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
  return !/\b(no|not|none|never|neither|nor|rather than|instead of)\b/.test(before);
}

const TIMEFRAME_RE = /\b(daily|weekly|monthly|intraday|1d|1w|1m|3m|1y|short[- ]term|medium[- ]term|long[- ]term|near[- ]term)\b/i;
const BULLISH_SENTIMENT_RE = /\b(constructive|strong|bullish|positive|favorable|favourable|healthy|robust)\b/i;
const BEARISH_SENTIMENT_RE = /\b(weak|bearish|negative|poor|concerning|fragile|deteriorat\w*)\b/i;
const AGREEMENT_RE = /\b(timeframes? agree|no contradiction|matrix confirms|all aligned|fully aligned|no conflict|agrees with|does not contradict)\b/i;
const VOLUME_CLAIM_RE = /\b(above[- ]average volume|volume confirm\w*|volume support\w*|strong volume|volume backing|breakout.*volume)\b/i;

export function gateReport(report: AnalysisReport, factsPack: string): GateResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const facts = parseFacts(factsPack);
  const prose = extractProse(report);
  const sents = sentences(prose);

  // 1. Sentiment vs RSI — the KEI "constructive while RSI 33" contradiction.
  //    Gated on the COMPUTED zone (P0-2): an RSI of 36 is inside the neutral
  //    30-70 band, so bullish prose beside it is not a contradiction. The old
  //    numeric test (rsi < 40) false-fired on any sentence containing the word
  //    "positive" — including one about a positive MACD histogram. Falls back
  //    to the numeric rule only when the pack carries no READING tags.
  if (facts.rsi14 != null) {
    const r = facts.reading;
    const oversold = r ? r.oversoldTimeframes.length > 0 : facts.rsi14 < 30;
    const overbought = r ? r.overboughtTimeframes.length > 0 : facts.rsi14 > 70;
    for (const s of sents) {
      if (oversold && BULLISH_SENTIMENT_RE.test(s) && !BEARISH_SENTIMENT_RE.test(s)) {
        issues.push(`RSI ${facts.rsi14} is oversold but the report says "${s.slice(0, 80)}"`);
      }
      if (overbought && BEARISH_SENTIMENT_RE.test(s) && !BULLISH_SENTIMENT_RE.test(s)) {
        issues.push(`RSI ${facts.rsi14} is overbought but the report says "${s.slice(0, 80)}"`);
      }
    }
  }

  // 2. Trend claims should name their timeframe. A WARNING, not a block: an
  // unlabelled "uptrend" is vague prose, not a contradiction of the data. This
  // killed an AAPL run that scored 80 on a comma-run of table cells that
  // happened to contain the word "uptrend".
  for (const s of sents) {
    if (/\b(uptrend|downtrend)\b/i.test(s) && !TIMEFRAME_RE.test(s)) {
      warnings.push(`Trend claim without a timeframe: "${s.slice(0, 80)}"`);
    }
  }

  // 3. Levels claims require a grounded level map.
  if (!facts.levelMapAvailable) {
    for (const s of sents) {
      if (/\b(support|resistance|stop[- ]loss|take[- ]profit|entry zone|invalidation)\b/i.test(s) && /\d{2,}/.test(s)) {
        issues.push(`Report quotes specific levels but the level map is INSUFFICIENT: "${s.slice(0, 80)}"`);
      }
    }
  }

  // 4. MTF conflict must be stated — the KEI "matrix does not contradict"
  //    while weekly was 4-bear/0-bull.
  if (facts.mtf.length >= 2) {
    const daily = facts.mtf.find((m) => /daily|1d/i.test(m.timeframe));
    const weekly = facts.mtf.find((m) => /weekly|1w/i.test(m.timeframe));
    const monthly = facts.mtf.find((m) => /monthly|1m/i.test(m.timeframe));
    const conflict =
      (daily && weekly && ((daily.bull > daily.bear && weekly.bear > weekly.bull) || (daily.bear > daily.bull && weekly.bull > weekly.bear))) ||
      (daily && monthly && ((daily.bull > daily.bear && monthly.bear > monthly.bull) || (daily.bear > daily.bull && monthly.bull > monthly.bear)));
    if (conflict) {
      const statesConflict = sents.some((s) => /\b(disagree|conflict|contradict|diverge|mixed signal|not aligned|caution)\b/i.test(s) && TIMEFRAME_RE.test(s));
      const claimsAgreement = sents.some((s) => AGREEMENT_RE.test(s));
      if (claimsAgreement && !statesConflict) {
        issues.push("MTF timeframes disagree but the report claims agreement without stating the conflict");
      }
    }
  }

  // 5. Volume claims require a real >1.5× avg-50d volume day.
  if (facts.volumeRatioMax != null && facts.volumeRatioMax < 1.5) {
    for (const s of sents) {
      if (VOLUME_CLAIM_RE.test(s)) {
        issues.push(`Report claims volume confirmation but max 50d volume is only ${facts.volumeRatioMax}× average: "${s.slice(0, 80)}"`);
      }
    }
  }

  const interp = gateInterpretation(report, factsPack);
  issues.push(...interp.issues);
  warnings.push(...interp.warnings);

  // One distinct problem, one entry — every rule above iterates sentences, so a
  // repeated sentence produced N identical issues and the callout rendered the
  // same sentence N times.
  const distinct = [...new Set(issues)];
  return { pass: distinct.length === 0, issues: distinct, warnings: [...new Set(warnings)] };
}

/**
 * P0-1: the report a BLOCKED run publishes instead of a report.
 *
 * v2 shipped 8 pages — including a trade plan — behind three banners while
 * stating coverage 0% and 6 of 6 anchors insufficient. The reader got a full
 * report the pipeline itself called unusable. A blocked run now publishes this
 * and nothing else: no numbers, no levels, no trade plan, no invented stance.
 */
export function blockedReport(reason: string, asOf: string): AnalysisReport {
  return {
    heroPct: 0,
    heroLabel: "Unavailable",
    partial: true,
    source: "fallback",
    blocks: [
      {
        type: "callout",
        tone: "caution",
        text:
          `Analysis unavailable — data as of ${asOf}. This run could not be verified against its own figures, ` +
          `so no report was published rather than publish one that contradicts itself. Reason: ${reason}. ` +
          `Re-run to try again, or check the reasoning trace for the tool responses that were received.`,
      },
    ],
  };
}

/** True when a run scored nothing at all — nothing honest to render. */
export function isUnscoreable(scoredCount: number): boolean {
  return scoredCount <= 0;
}

// Each of these was a contradiction in the v2 eval. The tag is computed in
// marketdata.interpret(); here we only compare what the prose claimed against
// what the tag says.

// ── P0-5: checks that read the code-computed READING tags ──────────────────
// Each of these was a contradiction in the v2 eval. The tag is computed in
// marketdata.interpret(); here we only compare what the prose claimed against
// what the tag says.

const OVERSOLD_RE = /\b(oversold)\b/i;
const OVERBOUGHT_RE = /\b(overbought)\b/i;
const UNAVAILABLE_RE = /\b(level map (is |was )?(unavailable|not available)|no level map)\b/i;
const BEARISH_MOMENTUM_RE = /\b(bearish|negative|weak)\s+(momentum|macd)\b/i;
const BULLISH_MOMENTUM_RE = /\b(bullish|positive|strong)\s+(momentum|macd)\b/i;
const DOWNTREND_RE = /\b(aligned downtrend|confirmed downtrend|downtrend regime|trending down)\b/i;
const OBV_SUPPORT_RE = /\b(support|confirm|positive|strong)\w*/i;
const VWAP_SUPPORTS_RE = /\bvwap\b[^]{0,40}?\b(supports?|supportive|confirms?|bullish|strong)\b/i;

export function gateInterpretation(
  report: AnalysisReport,
  factsPack: string,
): { issues: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const facts = parseFacts(factsPack);
  const r = facts.reading;
  if (!r) return { issues: [], warnings: [] };
  const issues: string[] = [];
  const sents = sentences(extractProse(report));

  // "Level map is unavailable" while the same page lists support/resistance/
  // stop/TP is false — v2 printed both.
  if (facts.levelMapAvailable && sents.some((s) => asserted(s, UNAVAILABLE_RE))) {
    issues.push('Report says the level map is unavailable, but the facts pack carries support/resistance/stop/target values');
  }

  // "oversold and overbought" needs an RSI under 30 / over 70 on a named
  // timeframe. v2 called 36.45 / 52.52 / 41.37 "a mix of oversold and
  // overbought" — none of them is.
  if (!r.oversoldTimeframes.length && sents.some((s) => asserted(s, OVERSOLD_RE))) {
    issues.push("Report calls RSI oversold but no timeframe is below 30");
  }
  if (!r.overboughtTimeframes.length && sents.some((s) => asserted(s, OVERBOUGHT_RE))) {
    issues.push("Report calls RSI overbought but no timeframe is above 70");
  }

  // MACD level and momentum must both be stated when the tags disagree — v2
  // printed "bearish momentum" with a positive histogram.
  if (r.macdDisagree) {
    const statesBoth = sents.some(
      (s) => /\b(easing|improving|waning|fading|weakening|but|though|despite)\b/i.test(s) && /macd|momentum|histogram/i.test(s),
    );
    const claimsOneSide = sents.some((s) => asserted(s, BEARISH_MOMENTUM_RE) || asserted(s, BULLISH_MOMENTUM_RE));
    if (claimsOneSide && !statesBoth) {
      issues.push(
        `MACD level is ${r.macdLevel} but momentum is ${r.macdMomentum} — the report states only one side`,
      );
    }
  }

  // Price below VWAP is weakness, not support.
  if (r.vwapState === "below" && sents.some((s) => asserted(s, VWAP_SUPPORTS_RE))) {
    issues.push("Report calls VWAP supportive but the computed tag says price is BELOW VWAP");
  }

  // "regime is trending down" while SMA50 sits above SMA200 is a pullback.
  if (r.regime === "pullback" && sents.some((s) => asserted(s, DOWNTREND_RE))) {
    issues.push(`Report calls the regime a downtrend, but the MA stack is ${r.maStack} — the computed tag is "${r.regime}"`);
  }
  if (r.regime === "aligned_uptrend" && sents.some((s) => asserted(s, DOWNTREND_RE))) {
    issues.push(`Report calls the regime a downtrend, but the computed tag is "${r.regime}"`);
  }

  // A volume/OBV claim needs a volume reading to stand on.
  if (r.volumeState === "weak" && sents.some((s) => asserted(s, VOLUME_CLAIM_RE))) {
    warnings.push(`Report claims volume confirmation but the computed volume tag is "${r.volumeState}"`);
  }
  if (r.volumeState === "weak" && sents.some((s) => /\bobv\b/i.test(s) && asserted(s, OBV_SUPPORT_RE))) {
    warnings.push(`Report calls OBV supportive but the computed volume tag is "${r.volumeState}"`);
  }

  // P0-6: the model grading itself is not evidence.
  for (const s of sents) {
    if (/\b(is|are)\s+(actionable|honest|credible|comprehensive)\b/i.test(s) || /\bframing is honest\b/i.test(s)) {
      issues.push(`Self-grading language in report copy: "${s.slice(0, 80)}"`);
    }
  }

  // P0-6: prompt/instruction text leaking into reader-facing copy.
  for (const s of sents) {
    if (/\b(do not|never|don't)\s+(invent|state|write|compute|estimate)\b/i.test(s)) {
      issues.push(`Prompt instruction leaked into report copy: "${s.slice(0, 80)}"`);
    }
  }

  return { issues, warnings };
}
