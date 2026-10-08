/**
 * Series extraction — turn any tool-result JSON into typed numeric series.
 *
 * This is what makes artifact builders generic. Voyager returns "XBRL-style"
 * field names whose exact spelling differs between NSE and SEC payloads, so
 * hardcoding cash-flow field names would break on the first mismatch. Instead
 * we walk the JSON and treat "a numeric field name shared across period-bearing
 * rows" as a series. Builders then select by fuzzy name match.
 *
 * Nothing here knows what a DCF is.
 */

export interface SeriesPoint {
  period: string;
  value: number;
}

export interface Series {
  /** Where in the payload it was found, for provenance notes. */
  path: string;
  /** The field name as the provider spells it. */
  name: string;
  points: SeriesPoint[];
}

const PERIOD_KEY_RE = /^(date|dates|period|periods|year|years|fy|fiscal[_\s-]?year|quarter|end[_\s-]?date|report[_\s-]?date|period[_\s-]?end|as[_\s-]?of)/i;

const NUMERIC_KEY_RE = /^(value|amount|total|cash|capex|fcf|ocf|revenue|sales|income|expense|profit|margin|growth|eps|shares|debt|equity|price|close|volume|ocf|capital)/i;

/** A scalar that looks like a reporting period rather than a measured value. */
function isPeriodish(value: unknown): boolean {
  if (typeof value === "number") {
    // Bare years (2019-2030) and quarter stamps (1-4) are periods; prices and
    // magnitudes are not. Anything with a fractional part is a measurement.
    return Number.isInteger(value) && value >= 1900 && value <= 2100;
  }
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > 32) return false;
  if (/^(fy)?\d{4}(-\d{2}(-\d{2})?)?(e[1-9])?$/i.test(v)) return true;      // 2024, 2024-03, FY2024
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;                              // ISO date
  if (/^q[1-4]\s*\d{0,4}$/i.test(v)) return true;                             // Q1, Q1 2024
  return false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parse an observation body. Observations are JSON.stringify'd tool results
 * (see runSkillEvaluation); arrays survive as JSON array text.
 */
export function parseObservation(result: string): unknown | null {
  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const MAX_DEPTH = 6;
const MAX_SERIES = 200;

/**
 * Walk an arbitrary payload and collect every numeric series.
 * Arrays of period-bearing objects are the common shape; a wide object whose
 * keys are periods (`{ "2023": {...}, "2024": {...} }`) is handled too.
 */
export function findSeries(root: unknown): Series[] {
  const found = new Map<string, Series>();

  const record = (path: string, name: string, points: SeriesPoint[]) => {
    if (!points.length || found.size >= MAX_SERIES) return;
    const key = `${path}::${name}`;
    const existing = found.get(key);
    // Same field seen in several places: keep the longest history.
    if (!existing || points.length > existing.points.length) {
      found.set(key, { path, name, points });
    }
  };

  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH || node == null || found.size >= MAX_SERIES) return;

    if (Array.isArray(node)) {
      const objects = node.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
      if (objects.length >= 2) {
        // Long shape: period column + numeric value columns.
        const keys = [...new Set(objects.flatMap((r) => Object.keys(r)))];
        const periodKey = keys.find((k) => objects.every((r) => isPeriodish(r[k])));
        if (periodKey) {
          for (const key of keys) {
            if (key === periodKey) continue;
            const points: SeriesPoint[] = [];
            for (const row of objects) {
              const value = row[key];
              if (!isFiniteNumber(value)) continue;
              points.push({ period: String(row[periodKey]), value });
            }
            record(path, key, points);
          }
        }
      }
      // Nested series inside a row (e.g. cash flows -> { annual: [...] }).
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        if (child && typeof child === "object") visit(child, `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    // Wide shape: keys are periods, values are row objects.
    const entries = Object.entries(obj);
    const periodKeys = entries.filter(([, v]) => isPeriodish(v)).map(([k]) => k);
    if (periodKeys.length >= 2) {
      const valueKeys = [...new Set(periodKeys.flatMap((k) => Object.keys((obj[k] || {}) as object)))];
      for (const key of valueKeys) {
        const points: SeriesPoint[] = [];
        for (const pk of periodKeys) {
          const value = ((obj[pk] || {}) as Record<string, unknown>)[key];
          if (isFiniteNumber(value)) points.push({ period: pk, value });
        }
        record(path, key, points);
      }
    }

    for (const [key, value] of entries) {
      if (value && typeof value === "object") visit(value, path ? `${path}.${key}` : key, depth + 1);
      else if (isFiniteNumber(value) && PERIOD_KEY_RE.test(key)) {
        // Scalar keyed by period name, e.g. { "2023": 1200 }.
        record(path, key, [{ period: key, value }]);
      }
    }
  };

  visit(root, "", 0);
  // Rank by history length so pickSeries can prefer the richest series.
  return [...found.values()].sort((a, b) => b.points.length - a.points.length);
}

/** First name match, longest history wins. Returns null when nothing matches. */
export function pickSeries(all: Series[], re: RegExp): Series | null {
  for (const s of all) {
    if (re.test(s.name)) return s;
  }
  return null;
}

/** Every name match, longest history first — useful when a provider duplicates a field. */
export function pickSeriesAll(all: Series[], re: RegExp): Series[] {
  return all.filter((s) => re.test(s.name));
}

/** Scalar lookup by fuzzy key name across a flat metrics object. */
export function pickNumber(root: unknown, re: RegExp): number | null {
  const walk = (node: unknown, depth: number): number | null => {
    if (depth > MAX_DEPTH || !node || typeof node !== "object") return null;
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (re.test(key) && isFiniteNumber(value)) return value;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        const hit = walk(value, depth + 1);
        if (hit != null) return hit;
      }
    }
    return null;
  };
  return walk(root, 0);
}