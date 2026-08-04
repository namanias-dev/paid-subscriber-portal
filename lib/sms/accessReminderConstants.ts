/**
 * Access At Risk reminder + automation constants.
 * ONE place for every tunable. Changing cadence / caps / quiet hours means
 * editing this file only.
 */

/** Portal Access Blocked — DLT 1777178527476051073 */
export const ACCESS_BLOCKED_TEMPLATE_ID = "portal_access_blocked";
/** Portal Access Expiring — DLT 1777178527489267737 — genuine dated notice only */
export const ACCESS_EXPIRING_TEMPLATE_ID = "portal_access_expiring";
/**
 * Installment Reminder — DLT 1777178513223214410.
 * Primary for −7d / grandfather notice (amount + login code).
 */
export const ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID = "installment_reminder";

/** Legacy +30m follow-up. Dropped for installment_reminder primary path. */
export const ACCESS_FOLLOW_UP_TEMPLATE_ID = "installment_instructions";
export const ACCESS_FOLLOW_UP_DELAY_MINUTES = 30;

/** Max automated sequences (step1+step2) per student per installment, lifetime. */
export const ACCESS_AUTO_CAP_PER_INSTALLMENT = 5;

/**
 * §5 Taper cadence — IST day offsets relative to installment due date.
 * Fires ONLY on these days (not daily). Nine SMS points; +10 also triggers call task.
 * Hard cap 10 total reminders per installment (see TAPER_HARD_CAP).
 */
export const TAPER_DAY_OFFSETS = [-7, -3, -1, 0, 1, 3, 5, 7, 10] as const;

/** Max taper reminders per installment before call-task escalation. */
export const TAPER_HARD_CAP = 10;

/** @deprecated Replaced by TAPER_DAY_OFFSETS — kept for legacy tests only. */
export const ACCESS_BLOCKED_REPEAT_DAYS = 2;

/** @deprecated Replaced by TAPER_DAY_OFFSETS — kept for legacy tests only. */
export const ACCESS_GRACE_WEEKDAYS_IST = [1, 4] as const;

/**
 * §6 — 63 grandfather cohort mid-window (5–12 Aug 2026 IST).
 * Pilot/queued notice on 5 Aug is separate (grandfather_notice_queue).
 * From 6 Aug only taper points landing before 12 Aug apply; max one msg/day.
 */
export const GRANDFATHER_MID_WINDOW = {
  pilotNoticeYmd: "2026-08-05",
  taperStartYmd: "2026-08-06",
  windowEndYmd: "2026-08-12",
  grantExpiresAt: "2026-08-11T18:30:00.000Z",
} as const;

/** Quiet hours in IST (inclusive start, exclusive end). Outside → queue. */
export const ACCESS_QUIET_HOURS_IST = { startHour: 9, endHour: 20 } as const;

/** Never more than one automated access SMS per phone per calendar day (IST). */
export const ACCESS_MAX_AUTO_PER_PHONE_PER_DAY = 1;

/** Circuit breaker: if a run would exceed this, send NOTHING and alert. */
export const ACCESS_DAILY_VOLUME_CEILING = 200;

/** First real enablement ramp — small so a mistake is visible. */
export const ACCESS_RAMP_FIRST_RUN = 10;

/** Skip automation if staff messaged the student within this window. */
export const ACCESS_MANUAL_DEDUP_HOURS = 24;

/** Skip for N hours after a same-day offline/manual payment. */
export const ACCESS_UNRECONCILED_PAYMENT_HOURS = 24;

/** Skip if transferred within this window (due dates just moved). */
export const ACCESS_POST_TRANSFER_SKIP_HOURS = 48;

/** Hard ceiling on one manual bulk job. */
export const ACCESS_MAX_BULK = 500;

/**
 * Automation master switches. Defaults are the SAFE ship state:
 * kill switch OFF (feature present but not running), dry-run ON (log only).
 * Persisted overrides live in `access_reminder_settings` and win when present.
 */
export const ACCESS_AUTOMATION_DEFAULTS = {
  killSwitch: false,
  dryRun: true,
  enabled: false,
  rampLimit: ACCESS_RAMP_FIRST_RUN,
  dailyCeiling: ACCESS_DAILY_VOLUME_CEILING,
} as const;
