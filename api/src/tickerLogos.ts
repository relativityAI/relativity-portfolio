// Company logos for a ticker, hotlinked from AllInvestView's free Ticker
// Logos CDN (https://cdn.tickerlogos.com/{domain}). The CDN is keyed by
// website domain, not by symbol, so a symbol is first resolved to its domain
// through their search API. Logos are never downloaded or stored here — only
// a URL (or, for the PDF, the bytes of one image) moves around.
//
// Their search API is rate-limited to 60 req/min per IP. Everything here is
// built to stay well inside that on shared infrastructure:
//   * lookups are serialized and spaced ~1.1s apart (≈54/min ceiling),
//   * the symbol→domain map is persisted to disk so server restarts (dev
//     watch reloads included) never re-burn the quota on known symbols,
//   * transient 429s / quota-exhaustion are NOT cached, so the symbol is
//     retried once the next budget slot opens.
//
// Attribution: their terms require a visible dofollow link on every page that
// shows a logo — see ui/src/components/Footer.tsx and the analysis pages.

import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";

const CDN = "https://cdn.tickerlogos.com";
const SEARCH = "https://www.allinvestview.com/api/logo-search/";
const MISS_TTL_MS = 10 * 60 * 1000;

// ── Request pacing ────────────────────────────────────────────────────────
// Search budget: one request per slot; slots open at least 1.1s apart so the
// worst case is ~54 req/min, under the 60/min limit. A lookup that would have
// to wait longer than this bails out (renders the letter fallback) rather
// than pile onto the queue.
const SLOT_GAP_MS = Number(process.env.TICKER_LOGOS_SLOT_GAP_MS) || 1100;
const WAIT_BUDGET_MS = 30_000;
let nextSlotAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForSlot(): Promise<boolean> {
  for (;;) {
    const waitMs = nextSlotAt - Date.now();
    if (waitMs <= 0) return true;
    if (waitMs > WAIT_BUDGET_MS) return false;
    await sleep(Math.min(waitMs, 250));
  }
}

// ── Symbol → domain map, persisted to disk ────────────────────────────────
// Hits live forever; misses expire after MISS_TTL_MS so a not-yet-listed
// company eventually gets another chance. In-memory map is the source of
// truth; the file is a restart-proof mirror written on a 2s debounce.
type Entry = { url: string | null; at: number };
const cache = new Map<string, Entry>();
const CACHE_FILE =
  process.env.TICKER_LOGOS_CACHE_FILE ||
  path.join(config.assetsDir, "..", ".cache", "ticker-domains.json");

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Record<string, Entry>;
    const now = Date.now();
    for (const [sym, e] of Object.entries(raw)) {
      if (e?.url || now - e.at < MISS_TTL_MS) cache.set(sym.toUpperCase(), e);
    }
  } catch {
    /* no file yet / unreadable — start empty, still works this run */
  }
}
loadCache();

let saveTimer: NodeJS.Timeout | undefined;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const now = Date.now();
      const fresh = [...cache].filter(([, e]) => e.url || now - e.at < MISS_TTL_MS);
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(fresh)));
    } catch {
      /* read-only fs (prod container) — in-memory cache still guards */
    }
  }, 2000);
}

function cached(symbol: string): string | null | undefined {
  const hit = cache.get(symbol);
  if (!hit) return undefined;
  if (hit.url || Date.now() - hit.at < MISS_TTL_MS) return hit.url;
  return undefined;
}

// ── Resolver ──────────────────────────────────────────────────────────────
function normalizeDomain(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  let host = "";
  try {
    host = new URL(s.includes("://") ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

// Exact symbol match, or the NSE-suffixed twin the search API returns for
// Indian symbols (RELIANCE → RELIANCE.NS). Anything looser risks hanging the
// wrong company's logo on a row (TCS → The Container Store), so no fallback.
function pick(results: any[], symbol: string): string | null {
  const want = [symbol, `${symbol}.NS`];
  const hit = results.find((r) => want.includes(String(r?.symbol || "").toUpperCase()));
  return normalizeDomain(hit?.website);
}

// One live search at a time, spaced ≥ SLOT_GAP_MS (see header).
let tail: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<string | null>>();

async function search(symbol: string): Promise<string | null> {
  if (!(await waitForSlot())) return null; // too deep behind the queue — don't cache
  try {
    const res = await fetch(`${SEARCH}?q=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 429) {
      // Rate-limited upstream: back off for a minute, retry the symbol later.
      nextSlotAt = Date.now() + 60_000;
      return null;
    }
    if (!res.ok) return null; // server error — retried on its next lookup
    const data = await res.json();
    const domain = pick(Array.isArray(data?.results) ? data.results : [], symbol);
    // Cache hits forever and clean misses (10-min TTL); transient failures
    // above are returned before here so they stay eligible for retry.
    const url = domain ? `${CDN}/${domain}` : null;
    cache.set(symbol, { url, at: Date.now() });
    scheduleSave();
    return url;
  } catch {
    return null; // offline/timeout — not cached, retried next time
  }
}

/** CDN url for a ticker's logo, or null when the CDN has none. */
export function tickerLogoUrl(symbol?: string): Promise<string | null> {
  const key = String(symbol || "").trim().toUpperCase();
  if (!key) return Promise.resolve(null);
  const hit = cached(key);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    // Serialize resolutions; drop a lookup already queued behind a long line.
    const run = tail.then(() => search(key));
    tail = run.catch(() => undefined);
    p = run;
    inflight.set(key, p);
    p.then(
      () => inflight.delete(key),
      () => inflight.delete(key)
    );
  }
  return p;
}

/** The logo as a data URI, for embedding in the PDF. */
export async function tickerLogoDataUri(symbol?: string): Promise<string | null> {
  const url = await tickerLogoUrl(symbol);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = String(res.headers.get("content-type") || "");
    if (!res.ok || !type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}