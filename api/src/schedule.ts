/**
 * Daily schedules: compute when a wall-clock time in an IANA timezone last
 * occurred (DST-safe, stdlib Intl only) and fire due rows once per local day.
 *
 * The ticker runs in-process like the stale-run sweeper — nothing survives a
 * restart beyond `last_fired_date` (one catch-up fire on boot). ponytail:
 * whole missed days are skipped; if that ever matters, drive `tick()` from an
 * external cron hitting an internal HTTP trigger.
 */

import { getDb } from "./db.js";
import { log } from "./logger.js";
import { startAnalysisRun } from "./runs.js";

const TICK_MS = 60_000;

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsInTz(utcMs: number, tz: string): Record<string, number> {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** UTC ms for `localDate` ("YYYY-MM-DD") at wall-clock `hh:mm` in `tz`.
 *  Two offset passes: guess as UTC, measure the real offset, correct — keeps
 *  21:00 local at 21:00 across DST transitions. */
export function occurrence(localDate: string, hhmm: string, tz: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p1 = partsInTz(guess, tz);
  const off1 = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second) - guess;
  const t1 = guess - off1;
  const p2 = partsInTz(t1, tz);
  const off2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second) - t1;
  return guess - off2;
}

function dateInTz(utcMs: number, tz: string): string {
  const p = partsInTz(utcMs, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function prevDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

/** Most recent occurrence of `hhmm` in `tz` at or before `now`, with its
 *  local date (the dedupe key). Candidates: today's and yesterday's wall day. */
export function latestOccurrence(
  hhmm: string,
  tz: string,
  now: number,
): { at: number; date: string } {
  const today = dateInTz(now, tz);
  const yest = prevDate(today);
  const todayAt = occurrence(today, hhmm, tz);
  return todayAt <= now
    ? { at: todayAt, date: today }
    : { at: occurrence(yest, hhmm, tz), date: yest };
}

async function tick(): Promise<void> {
  try {
    const { data, error } = await getDb().from("schedules").select("*");
    if (error) {
      log.warn("[schedules]", `tick failed: ${error.message}`);
      return;
    }
    const now = Date.now();
    for (const s of data ?? []) {
      const due = latestOccurrence(s.time, s.timezone, now);
      if (due.at < +new Date(s.created_at)) continue; // occurrence predates the schedule
      if (s.last_fired_date && s.last_fired_date >= due.date) continue;
      // Atomic claim: only one tick may win a given local day.
      const { data: claimed, error: cErr } = await getDb()
        .from("schedules")
        .update({ last_fired_date: due.date })
        .eq("id", s.id)
        .or(`last_fired_date.is.null,last_fired_date.neq.${due.date}`)
        .select("id");
      if (cErr) {
        log.warn("[schedules]", `claim failed for ${s.id}: ${cErr.message}`);
        continue;
      }
      if (!claimed?.length) continue;
      log.info("[schedules]", `firing ${s.symbol} @ ${s.time} ${s.timezone}`);
      startAnalysisRun({
        userId: s.user_id,
        symbol: s.symbol,
        source: s.source,
        agentId: s.agent_id || undefined,
        model: s.model || undefined,
        systemPrompt: s.system_prompt || undefined,
        skillIds: s.skill_ids?.length ? s.skill_ids : undefined,
        budget: {
          ...(s.max_steps ? { maxSteps: s.max_steps } : {}),
          ...(s.max_tokens ? { maxTokens: s.max_tokens } : {}),
        },
      }).catch((e: any) => log.warn("[schedules]", `fire failed: ${e?.message || e}`));
    }
  } catch (e: any) {
    log.warn("[schedules]", `tick error: ${e?.message || e}`);
  }
}

/** Boot + periodic calls used by the server's listen callback. */
export function startScheduleTicker(): void {
  void tick();
  setInterval(() => void tick(), TICK_MS).unref?.();
}
