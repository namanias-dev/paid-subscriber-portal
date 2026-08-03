/**
 * Promo SMS quiet-hours (IST). Promotional templates may only send inside the
 * configured window; outside it they are deferred to promoDispatchTime.
 * Transactional / service templates are never gated here.
 */
import type { SmsSettings, SmsTemplate } from "./types";

export type SmsCategory = "promo" | "transactional";

export const DEFAULT_PROMO_WINDOW_START = "10:00";
export const DEFAULT_PROMO_WINDOW_END = "21:00";
export const DEFAULT_PROMO_DISPATCH = "10:30";
/** Spread deferred burst across this many minutes after dispatch time. */
export const PROMO_DISPATCH_JITTER_MINUTES = 30;

export function resolveTemplateCategory(t: Pick<SmsTemplate, "category" | "message_type">): SmsCategory {
  if (t.category === "promo" || t.category === "transactional") return t.category;
  if (t.message_type === "promotional") return "promo";
  if (t.message_type === "service") return "transactional";
  // Fail-safe: unclassified → promo (quiet-hours apply).
  return "promo";
}

export function isPromoTemplate(t: Pick<SmsTemplate, "category" | "message_type">): boolean {
  return resolveTemplateCategory(t) === "promo";
}

function hmToMin(hm: string): number {
  const [h, m] = (hm || "0:0").split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

export function promoWindowBounds(settings: Pick<SmsSettings, "promoWindowStart" | "promoWindowEnd" | "windowStart" | "windowEnd">): {
  start: string;
  end: string;
  startMin: number;
  endMin: number;
} {
  const start = settings.promoWindowStart || settings.windowStart || DEFAULT_PROMO_WINDOW_START;
  const end = settings.promoWindowEnd || settings.windowEnd || DEFAULT_PROMO_WINDOW_END;
  return { start, end, startMin: hmToMin(start), endMin: hmToMin(end) };
}

export function promoDispatchHm(settings: Pick<SmsSettings, "promoDispatchTime">): string {
  return settings.promoDispatchTime || DEFAULT_PROMO_DISPATCH;
}

/** Current IST wall-clock parts. */
export function istNowParts(d = new Date()): { y: number; m: number; day: number; hour: number; minute: number; minutesOfDay: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const y = g("year");
  const m = g("month");
  const day = g("day");
  let hour = g("hour");
  // en-CA hour12:false can yield 24 for midnight — normalize.
  if (hour === 24) hour = 0;
  const minute = g("minute");
  const ymd = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { y, m, day, hour, minute, minutesOfDay: hour * 60 + minute, ymd };
}

export function isWithinPromoWindow(
  settings: Pick<SmsSettings, "promoWindowStart" | "promoWindowEnd" | "windowStart" | "windowEnd">,
  d = new Date(),
): boolean {
  const { startMin, endMin } = promoWindowBounds(settings);
  const { minutesOfDay } = istNowParts(d);
  return minutesOfDay >= startMin && minutesOfDay <= endMin;
}

function addIstDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Next promo dispatch instant (UTC Date) for a trigger occurring at `d`.
 * - Inside window → null (send now)
 * - After window end (evening) → next calendar day @ dispatch time (+ optional jitter)
 * - Before window start (morning) → same calendar day @ dispatch time (+ optional jitter)
 */
export function nextPromoDispatchAt(
  settings: Pick<SmsSettings, "promoWindowStart" | "promoWindowEnd" | "promoDispatchTime" | "windowStart" | "windowEnd">,
  d = new Date(),
  opts?: { jitterMinutes?: number; jitterSeed?: string },
): Date | null {
  if (isWithinPromoWindow(settings, d)) return null;
  const { startMin, endMin } = promoWindowBounds(settings);
  const dispatchHm = promoDispatchHm(settings);
  const { ymd, minutesOfDay } = istNowParts(d);
  const targetYmd = minutesOfDay > endMin ? addIstDays(ymd, 1) : ymd;
  // Before start: same day. (minutesOfDay < startMin). After end: next day.
  // Between is handled by isWithinPromoWindow.
  void startMin;
  let jitter = 0;
  const maxJ = opts?.jitterMinutes ?? PROMO_DISPATCH_JITTER_MINUTES;
  if (maxJ > 0 && opts?.jitterSeed) {
    let h = 0;
    for (let i = 0; i < opts.jitterSeed.length; i++) h = (h * 31 + opts.jitterSeed.charCodeAt(i)) >>> 0;
    jitter = h % (maxJ + 1);
  } else if (maxJ > 0) {
    jitter = Math.floor(Math.random() * (maxJ + 1));
  }
  const [dh, dm] = dispatchHm.split(":").map((x) => Number(x) || 0);
  const totalMin = dh * 60 + dm + jitter;
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  const iso = `${targetYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`;
  return new Date(iso);
}

export function promoWindowStatus(
  settings: Pick<SmsSettings, "promoWindowStart" | "promoWindowEnd" | "promoDispatchTime" | "windowStart" | "windowEnd">,
  d = new Date(),
): {
  open: boolean;
  istNow: string;
  windowStart: string;
  windowEnd: string;
  dispatchTime: string;
  nextDispatchAt: string | null;
} {
  const { start, end } = promoWindowBounds(settings);
  const { ymd, hour, minute } = istNowParts(d);
  const next = nextPromoDispatchAt(settings, d, { jitterMinutes: 0 });
  return {
    open: isWithinPromoWindow(settings, d),
    istNow: `${ymd} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} IST`,
    windowStart: start,
    windowEnd: end,
    dispatchTime: promoDispatchHm(settings),
    nextDispatchAt: next ? next.toISOString() : null,
  };
}

const SCHEDULE_GRACE_MS = 2 * 60_000;
const SCHEDULE_MAX_DAYS = 90;

export type IstScheduleParse =
  | { ok: true; at: Date; utcIso: string; istLabel: string; datetimeLocal: string }
  | { ok: false; error: string; code: "empty" | "malformed" | "past" | "too_far" };

/** Format a Date as operator-facing IST label, e.g. "4 Aug, 2:30 PM IST". */
export function formatIstScheduleLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const ap = g("dayPeriod").toUpperCase();
  return `${g("day")} ${g("month")}, ${g("hour")}:${g("minute")} ${ap} IST`;
}

/** datetime-local value (no tz) for the IST wall-clock of `d`. */
export function toDatetimeLocalIst(d: Date): string {
  const { ymd, hour, minute } = istNowParts(d);
  return `${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse Mission Control datetime-local as Asia/Kolkata wall-clock.
 * Bare "YYYY-MM-DDTHH:MM" → IST (+05:30). Rejects past (2m grace) and >90d out.
 */
export function parseIstScheduleInput(input: string | null | undefined): IstScheduleParse {
  if (input == null || String(input).trim() === "") return { ok: false, error: "Schedule time is required.", code: "empty" };
  let s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00+05:30";
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += "+05:30";
  else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return { ok: false, error: "Enter a valid date and time (IST).", code: "malformed" };
  }
  const at = new Date(s);
  if (isNaN(at.getTime())) return { ok: false, error: "Enter a valid date and time (IST).", code: "malformed" };
  if (at.getTime() < Date.now() - SCHEDULE_GRACE_MS) {
    return { ok: false, error: "That time is in the past. Pick a future IST time, or leave blank to send now.", code: "past" };
  }
  if (at.getTime() > Date.now() + SCHEDULE_MAX_DAYS * 86_400_000) {
    return { ok: false, error: `Schedule must be within ${SCHEDULE_MAX_DAYS} days.`, code: "too_far" };
  }
  return {
    ok: true,
    at,
    utcIso: at.toISOString(),
    istLabel: formatIstScheduleLabel(at),
    datetimeLocal: toDatetimeLocalIst(at),
  };
}

/**
 * Next time inside the promo window on/after `d` (window start IST).
 * Used when an operator schedules a promo outside the allowed hours.
 */
export function nextValidPromoSlot(
  settings: Pick<SmsSettings, "promoWindowStart" | "promoWindowEnd" | "windowStart" | "windowEnd">,
  d: Date,
): Date {
  const { startMin, endMin } = promoWindowBounds(settings);
  const { ymd, minutesOfDay } = istNowParts(d);
  const targetYmd = minutesOfDay > endMin ? addIstDays(ymd, 1) : ymd;
  // If before window start same day, or rolled to next day: use window start.
  void startMin;
  const hh = Math.floor(startMin / 60);
  const mm = startMin % 60;
  // When still before start today, targetYmd is today; when after end, tomorrow.
  // When somehow inside window, still return window start of that day (caller shouldn't need it).
  return new Date(`${targetYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
}
