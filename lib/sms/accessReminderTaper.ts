/**
 * §5 Taper cadence + §6 grandfather mid-window helpers.
 *
 * Reminders fire ONLY when today's IST calendar day matches a TAPER_DAY_OFFSET
 * relative to the oldest unpaid installment due date — never "daily until paid".
 */
import { istYMD, istYMDToMs } from "../dates";
import {
  GRANDFATHER_MID_WINDOW,
  TAPER_DAY_OFFSETS,
  TAPER_HARD_CAP,
} from "./accessReminderConstants";
import type { CourseAccessOverride } from "../types";

export { TAPER_HARD_CAP };

/** IST calendar-day offset from due date (negative = before due). */
export function istTaperOffsetFromDue(dueDateIso: string, now = Date.now()): number | null {
  const dueYmd = istYMD(dueDateIso);
  const todayYmd = istYMD(new Date(now));
  if (!dueYmd || !todayYmd) return null;
  const dueMs = istYMDToMs(dueYmd);
  const todayMs = istYMDToMs(todayYmd);
  return Math.round((todayMs - dueMs) / 86_400_000);
}

export function addDaysToYmd(ymd: string, days: number): string {
  return istYMD(new Date(istYMDToMs(ymd) + days * 86_400_000))!;
}

/** True when `now` falls on one of the nine taper offset days for this due date. */
export function isTaperCadenceDay(dueDateIso: string, now = Date.now()): boolean {
  const offset = istTaperOffsetFromDue(dueDateIso, now);
  return offset != null && (TAPER_DAY_OFFSETS as readonly number[]).includes(offset);
}

/** YMD (IST) when a taper offset fires for a given due date. */
export function taperOffsetFireYmd(dueDateIso: string, offset: number): string | null {
  const dueYmd = istYMD(dueDateIso);
  if (!dueYmd) return null;
  return addDaysToYmd(dueYmd, offset);
}

/**
 * §6 — Taper offsets for the 63 grandfather cohort whose grants expire 12 Aug IST.
 * Returns offsets whose fire date is in [fromYmd, windowEndYmd) — i.e. on/after 6 Aug
 * and before enforcement morning 12 Aug. The 5 Aug pilot notice is NOT a taper point.
 */
export function remainingGrandfatherTaperOffsets(
  dueDateIso: string,
  opts?: { fromYmd?: string; windowEndYmd?: string },
): number[] {
  const fromYmd = opts?.fromYmd ?? GRANDFATHER_MID_WINDOW.taperStartYmd;
  const windowEndYmd = opts?.windowEndYmd ?? GRANDFATHER_MID_WINDOW.windowEndYmd;
  const fromMs = istYMDToMs(fromYmd);
  const endMs = istYMDToMs(windowEndYmd);

  return (TAPER_DAY_OFFSETS as readonly number[]).filter((offset) => {
    const fireYmd = taperOffsetFireYmd(dueDateIso, offset);
    if (!fireYmd) return false;
    const fireMs = istYMDToMs(fireYmd);
    return fireMs >= fromMs && fireMs < endMs;
  });
}

/** Whether a grandfather-grant holder is inside the 6 Aug – 11 Aug taper window. */
export function isGrandfatherMidWindowActive(now = Date.now()): boolean {
  const today = istYMD(new Date(now))!;
  return today >= GRANDFATHER_MID_WINDOW.taperStartYmd && today < GRANDFATHER_MID_WINDOW.windowEndYmd;
}

export function isGrandfatherMidWindowGrant(
  grant: CourseAccessOverride | null | undefined,
  now = Date.now(),
): boolean {
  if (!grant?.expires_at) return false;
  const exp = Date.parse(grant.expires_at);
  const target = Date.parse(GRANDFATHER_MID_WINDOW.grantExpiresAt);
  if (!Number.isFinite(exp) || Math.abs(exp - target) > 120_000) return false;
  return isGrandfatherMidWindowActive(now);
}

/** Taper day check for grandfather cohort — only offsets still eligible before 12 Aug. */
export function isGrandfatherMidWindowTaperDay(dueDateIso: string, now = Date.now()): boolean {
  const offset = istTaperOffsetFromDue(dueDateIso, now);
  if (offset == null) return false;
  const remaining = remainingGrandfatherTaperOffsets(dueDateIso);
  return remaining.includes(offset);
}

/** Pick taper gate: standard vs grandfather mid-window filter. */
export function isTaperSendDay(input: {
  dueDateIso: string;
  grant: CourseAccessOverride | null | undefined;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (isGrandfatherMidWindowGrant(input.grant, now)) {
    return isGrandfatherMidWindowTaperDay(input.dueDateIso, now);
  }
  return isTaperCadenceDay(input.dueDateIso, now);
}

/** +10 offset day — SMS point that also escalates to call task. */
export function isTaperCallTaskDay(dueDateIso: string, now = Date.now()): boolean {
  return istTaperOffsetFromDue(dueDateIso, now) === 10;
}
