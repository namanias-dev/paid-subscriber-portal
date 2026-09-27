/**
 * One login identity for the executive brief and the login-trend averages.
 *
 * A genuine login is an analytics `login` event or an access-log `login`.
 * The person key is phone-first, then buyer id, then student id — the same
 * key `computePeople` uses. Staff, quiz leads, and documented internal
 * students are excluded.
 *
 * The previous trend counter keyed buyer id first and did not exclude staff,
 * so one student with two buyer ids, plus staff, counted as extra "Today" logins.
 */
import { istYMD } from "../dates";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "../leaderboardExclusions";
import { personKey } from "./businessMetrics";

export interface LoginHit {
  at: string;
  phone?: string | null;
  buyerId?: string | null;
  studentId?: string | null;
}

export interface LoginExclusion {
  phones: Set<string>;
  buyerIds: Set<string>;
  studentIds: Set<string>;
}

export function emptyLoginExclusion(): LoginExclusion {
  return {
    phones: new Set(),
    buyerIds: new Set(),
    studentIds: new Set(LEADERBOARD_EXCLUDED_STUDENT_IDS),
  };
}

/** Null when the hit is staff, a lead, or has no identity. */
export function genuineLoginKey(hit: LoginHit, excluded: LoginExclusion): string | null {
  if (hit.buyerId && excluded.buyerIds.has(hit.buyerId)) return null;
  if (hit.studentId && excluded.studentIds.has(hit.studentId)) return null;
  const key = personKey({ phone: hit.phone, buyerId: hit.buyerId, studentId: hit.studentId });
  if (!key) return null;
  if (key.startsWith("p:")) {
    const digits = key.slice(2);
    if (excluded.phones.has(digits)) return null;
  }
  return key;
}

/**
 * Old trend key, kept only so tests can show why "Today" used to disagree
 * with unique logins. Buyer id wins, and nobody is excluded.
 */
export function legacyTrendLoginKey(hit: Pick<LoginHit, "phone" | "buyerId">): string | null {
  const bid = (hit.buyerId || "").trim();
  if (bid) return `b:${bid}`;
  return personKey({ phone: hit.phone });
}

/** Unique genuine logins per IST calendar day. */
export function uniqueLoginsByDay(hits: LoginHit[], excluded: LoginExclusion): Map<string, Set<string>> {
  const byDay = new Map<string, Set<string>>();
  for (const hit of hits) {
    const ymd = istYMD(hit.at);
    if (!ymd) continue;
    const key = genuineLoginKey(hit, excluded);
    if (!key) continue;
    let set = byDay.get(ymd);
    if (!set) {
      set = new Set();
      byDay.set(ymd, set);
    }
    set.add(key);
  }
  return byDay;
}

export function uniqueLoginsOnDay(hits: LoginHit[], ymd: string, excluded: LoginExclusion): number {
  return uniqueLoginsByDay(hits, excluded).get(ymd)?.size || 0;
}

/** Mean of the given daily unique counts. Zeros stay in the denominator. */
export function meanDailyUniques(counts: number[]): number | null {
  if (!counts.length) return null;
  const sum = counts.reduce((a, n) => a + n, 0);
  return Math.round(sum / counts.length);
}

/**
 * Historical average over complete days that actually have a login.
 * Quiet days before tracking started are not in `activeCounts`.
 * The caller must already have dropped the still-open day.
 */
export function trackedDayAverage(activeCounts: number[]): number | null {
  return meanDailyUniques(activeCounts.filter((n) => n > 0));
}
