/**
 * IST whole-day maths for the Portal Access Expiring `{days}` token.
 *
 * Computed at SEND TIME from the live grace-end instant. Never cached, never
 * precomputed at schedule time — an admin extension must change the next SMS.
 */
import { istTodayYMD, istYMD } from "../dates";

/** Parse "YYYY-MM-DD" as a UTC-noon calendar day for stable day arithmetic. */
function ymdToUtcDay(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Whole IST calendar days from "today" (at `now`) until the IST calendar day of
 * `graceEndsAt`. Same calendar day → 0. Past days → negative.
 */
export function istWholeDaysUntil(graceEndsAt: string | null | undefined, now = Date.now()): number | null {
  if (!graceEndsAt) return null;
  const endYmd = istYMD(graceEndsAt);
  const todayYmd = istYMD(new Date(now)) ?? istTodayYMD();
  if (!endYmd) return null;
  const end = ymdToUtcDay(endYmd);
  const today = ymdToUtcDay(todayYmd);
  if (end == null || today == null) return null;
  return Math.round((end - today) / 86_400_000);
}

/** IST weekday 0=Sun … 6=Sat for an instant. */
export function istWeekday(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).formatToParts(new Date(now));
  const w = parts.find((p) => p.type === "weekday")?.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w || ""] ?? 0;
}

/** IST hour 0–23 for an instant. */
export function istHour(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}
