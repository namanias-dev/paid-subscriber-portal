/**
 * Pure insight math for AIVA agents — funnels, cohorts, conversion, pace and trend.
 * No I/O, no DB, no Three.js: deterministic and unit-tested so every headline number
 * an agent shows can be reproduced. The DB-facing builders live in ./agents.ts and feed
 * these helpers the already-fetched rows, reusing the portal's own reconciliation truth.
 */

const DAY_MS = 86_400_000;

/** Normalize a phone to the last 10 digits — the SAME identity key the portal reconciles on. */
export function normPhone(p: string | null | undefined): string {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

/** Percentage of n over d, one decimal, divide-by-zero safe (0 when d ≤ 0). */
export function pct(n: number, d: number): number {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

/** Booking/collection pace as events per day over a window (0 when the window is empty). */
export function ratePerDay(count: number, days: number): number {
  if (days <= 0) return 0;
  return Math.round((count / days) * 100) / 100;
}

/**
 * Days to exhaust `remaining` at `perDay`. Returns 0 when nothing remains and null when
 * the pace is zero (never fills — the honest answer, not Infinity or a fake ETA).
 */
export function etaDays(remaining: number, perDay: number): number | null {
  if (remaining <= 0) return 0;
  if (perDay <= 0) return null;
  return Math.ceil(remaining / perDay);
}

export type Trend = {
  current: number;
  previous: number;
  deltaPct: number;
  direction: "up" | "down" | "flat";
};

/** Period-over-period change. previous=0 with current>0 reports +100% (from zero). */
export function trend(current: number, previous: number): Trend {
  let deltaPct = 0;
  if (previous > 0) deltaPct = Math.round(((current - previous) / previous) * 1000) / 10;
  else if (current > 0) deltaPct = 100;
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";
  return { current, previous, deltaPct, direction };
}

/** Count rows per derived key (e.g. batch label). Stable, insertion-ordered keys. */
export function groupCount<T>(rows: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Sum a numeric field of rows whose timestamp falls in [fromMs, toMs). */
export function sumInWindow<T>(
  rows: T[],
  tsMs: (t: T) => number,
  amount: (t: T) => number,
  fromMs: number,
  toMs: number,
): number {
  let s = 0;
  for (const r of rows) {
    const t = tsMs(r);
    if (t >= fromMs && t < toMs) s += amount(r) || 0;
  }
  return s;
}

/** Milliseconds `days` before `now` (helper for rolling windows). */
export function daysAgo(now: number, days: number): number {
  return now - days * DAY_MS;
}

/**
 * Bucket dated amounts into a per-day series of length `days`, oldest→newest (index days-1 = today).
 * Pure/deterministic given `now`. Used for trend sparklines. Unit-tested.
 */
export function dailySeries(items: { date: string; amount: number }[], days: number, now = Date.now()): number[] {
  const DAY = 86_400_000;
  const out = new Array(days).fill(0);
  for (const it of items) {
    const t = Date.parse(it.date) || 0;
    if (!t) continue;
    const dayIdx = Math.floor((now - t) / DAY);
    if (dayIdx >= 0 && dayIdx < days) out[days - 1 - dayIdx] += Number(it.amount) || 0;
  }
  return out;
}

export type AttendanceSplit = {
  known: boolean;
  attendees: number;
  noShows: number;
  attendeeConverted: number;
  noShowConverted: number;
  attendeeConvPct: number;
  noShowConvPct: number;
};

/**
 * Attendee-vs-no-show conversion. `known` is false when no registrant has an attendance
 * flag yet (attendance list not uploaded) — callers should show "not uploaded", not zeros.
 */
export function attendeeConversion(rows: { attended: boolean; converted: boolean }[]): AttendanceSplit {
  const known = rows.some((r) => r.attended);
  let attendees = 0;
  let noShows = 0;
  let attendeeConverted = 0;
  let noShowConverted = 0;
  for (const r of rows) {
    if (r.attended) {
      attendees += 1;
      if (r.converted) attendeeConverted += 1;
    } else {
      noShows += 1;
      if (r.converted) noShowConverted += 1;
    }
  }
  return {
    known,
    attendees,
    noShows,
    attendeeConverted,
    noShowConverted,
    attendeeConvPct: pct(attendeeConverted, attendees),
    noShowConvPct: pct(noShowConverted, noShows),
  };
}

export type FunnelStage = { label: string; value: number; ofPrev: number; ofTop: number };

/**
 * Turn ordered stage counts into a funnel: each stage carries its conversion off the
 * PREVIOUS stage (ofPrev) and off the TOP of the funnel (ofTop), both divide-by-zero safe.
 */
export function funnelStages(stages: { label: string; value: number }[]): FunnelStage[] {
  const top = stages.length ? stages[0].value : 0;
  return stages.map((s, i) => ({
    label: s.label,
    value: s.value,
    ofPrev: i === 0 ? 100 : pct(s.value, stages[i - 1].value),
    ofTop: pct(s.value, top),
  }));
}
