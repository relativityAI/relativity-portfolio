/**
 * Feature derivation (plan §6.2) — flatten a Voyager metrics snapshot into the
 * §6.2 feature catalog and upsert into stock_features, keyed by
 * (symbol, source, data_version). Deterministic; same snapshot ⇒ same row.
 *
 * Only catalog keys are stored; everything else in the snapshot is ignored.
 * Series features (roe_annual, op_margin, …) are number[]; scalars are numbers.
 * A feature that cannot be computed is OMITTED (absent ≠ 0 — predicates treat
 * a missing required key as INSUFFICIENT).
 */

import { getDb } from "../db.js";
import { log } from "../logger.js";
import { FEATURE_CATALOG, toNumber, type Unit } from "../units.js";

/** Extract trailing numbers (oldest → newest) from any snapshot value shape. */
function seriesFrom(snapshot: Record<string, any>, key: string): number[] {
  const direct = snapshot[key];
  if (Array.isArray(direct)) {
    return direct.map((v) => toNumber(v)).filter((v): v is number => v !== null);
  }
  if (direct != null && typeof direct === "object") {
    // { fy2021: x, fy2022: y } → values sorted by year key.
    const entries = Object.entries(direct)
      .map(([k, v]) => ({ k, n: toNumber(v) }))
      .filter((e): e is { k: string; n: number } => e.n !== null)
      .sort((a, b) => a.k.localeCompare(b.k));
    return entries.map((e) => e.n);
  }
  return [];
}

function scalarFrom(snapshot: Record<string, any>, key: string): number | null {
  return toNumber(snapshot[key]);
}

/**
 * Compute the §6.2 features from a metrics snapshot. Percent features pass
 * through toPercent so fractions and percents compare in canonical units.
 */
export function deriveFeatures(snapshot: Record<string, any>): {
  features: Record<string, number | number[] | null>;
  missing: string[];
} {
  const features: Record<string, number | number[] | null> = {};
  const missing: string[] = [];
  for (const [key, spec] of Object.entries(FEATURE_CATALOG)) {
    const unit: Unit = spec.unit;
    if (spec.series) {
      const arr = seriesFrom(snapshot, key);
      if (arr.length === 0) {
        missing.push(key);
        continue;
      }
      const scaled = unit === "pct" ? arr.map((v) => toPercentTolerant(v)) : arr;
      features[key] = scaled;
    } else {
      const n = scalarFrom(snapshot, key);
      if (n === null) {
        missing.push(key);
        continue;
      }
      features[key] = unit === "pct" ? toPercentTolerant(n) : n;
    }
  }
  return { features, missing };
}

/** Percent inputs are accepted in either scale; |v|<1 is treated as a fraction. */
function toPercentTolerant(v: number): number {
  if (v !== 0 && Math.abs(v) < 1) return v * 100;
  return v;
}

/**
 * Upsert the derived feature row. data_version stamps the derivation rule set
 * so old rows remain auditable after the catalog changes.
 */
export const FEATURES_DATA_VERSION = "v1";

export async function persistFeatures(
  symbol: string,
  source: string,
  snapshot: Record<string, any>,
  asOf: string | null,
  db = getDb(),
): Promise<{ persisted: boolean; count: number }> {
  const { features } = deriveFeatures(snapshot);
  const keys = Object.keys(features);
  if (keys.length === 0) return { persisted: false, count: 0 };
  const row = {
    symbol,
    source,
    data_version: FEATURES_DATA_VERSION,
    as_of: asOf,
    features,
  };
  const { error } = await db
    .from("stock_features")
    .upsert(row, { onConflict: "symbol,source,data_version" });
  if (error) {
    log.warn("[features]", `upsert failed for ${symbol}/${source}: ${error.message}`);
    return { persisted: false, count: 0 };
  }
  return { persisted: true, count: keys.length };
}

// Self-check: npx tsx src/kb/features.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { features, missing } = deriveFeatures({
    roe_annual: [0.1, 0.22, 0.18],
    roic_ttm: 0.19,
    net_debt_ebitda: 1.4,
  });
  const roe = features.roe_annual as number[];
  if (roe.length !== 3 || roe[1] !== 22) throw new Error(`series: ${JSON.stringify(roe)}`);
  if (features.roic_ttm !== 19) throw new Error("pct scalar should be canonicalized to percent units");
  if (!missing.includes("op_margin")) throw new Error("missing series should be reported");
  if ("op_margin" in features) throw new Error("missing features must be omitted, not null");
  console.log("features OK");
}
