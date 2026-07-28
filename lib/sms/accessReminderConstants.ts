/**
 * Access At Risk reminder + automation constants.
 * ONE place for every tunable. Changing cadence / caps / quiet hours means
 * editing this file only.
 */

/** Portal Access Blocked — DLT 1777178527476051073 */
export const ACCESS_BLOCKED_TEMPLATE_ID = "portal_access_blocked";
/** Portal Access Expiring — DLT 1777178527489267737 */
export const ACCESS_EXPIRING_TEMPLATE_ID = "portal_access_expiring";

/** Reuse the existing Installment Instructions follow-up. */
export const ACCESS_FOLLOW_UP_TEMPLATE_ID = "installment_instructions";
export const ACCESS_FOLLOW_UP_DELAY_MINUTES = 30;

/** Max automated sequences (step1+step2) per student per installment, lifetime. */
export const ACCESS_AUTO_CAP_PER_INSTALLMENT = 5;

/** Blocked cadence: re-send every N days while still blocked (after the first). */
export const ACCESS_BLOCKED_REPEAT_DAYS = 2;

/** Grace cadence: IST weekdays (0=Sun … 6=Sat). Mon + Thu. */
export const ACCESS_GRACE_WEEKDAYS_IST = [1, 4] as const;

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
