/**
 * Webinar registration lifecycle — computed ON-READ (no cron needed).
 *
 * TIMEZONE: every comparison here is epoch-vs-epoch. `datetime` /
 * `registration_closes_at` are stored as UTC ISO instants and `now` is
 * `Date.now()` (also an absolute instant). Because both sides are absolute
 * epoch milliseconds, the result is identical regardless of the server's local
 * timezone. An 11:00 AM IST start is stored as 05:30 UTC; at 11:01 AM IST
 * (05:31 UTC) `now >= closesAt` is true on any server. See
 * scripts/test-webinar-lifecycle.mjs for the proving tests.
 *
 * This module is intentionally dependency-free (pure functions) so it can run
 * on the server, the client, and in a plain-node test harness.
 */
import type { Webinar } from "./types";

/** Effective, derived registration state. */
export type EffectiveRegStatus = "OPEN" | "CLOSED" | "ENDED" | "DISABLED" | "DRAFT";

/** Subset of Webinar fields this module needs (keeps callers flexible). */
export interface LifecycleInput {
  datetime?: string | null;
  end_datetime?: string | null;
  registration_closes_at?: string | null;
  registration_status?: string | null;
  auto_close_registration?: boolean | null;
  active?: boolean | null;
  session_type?: string | null;
  status?: string | null;
  recording_link?: string | null;
  next_webinar_id?: string | null;
}

function parse(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** The instant after which registration closes (custom cutoff, else start). */
export function registrationCutoffMs(w: LifecycleInput): number | null {
  return parse(w.registration_closes_at) ?? parse(w.datetime);
}

/**
 * A webinar is in "recording mode" when it's explicitly a recorded session, or
 * a completed live session that still has a recording to sell. These keep
 * registration OPEN past the start time so existing recording-sale revenue is
 * never broken by auto-close.
 */
export function isRecordingMode(w: LifecycleInput): boolean {
  if (w.session_type === "recorded") return true;
  if (w.status === "completed" && !!(w.recording_link && w.recording_link.trim())) return true;
  return false;
}

/** Effective registration status, derived on-read. */
export function effectiveRegStatus(w: LifecycleInput, now: number = Date.now()): EffectiveRegStatus {
  const manual = (w.registration_status || "OPEN").toUpperCase();
  if (w.active === false || manual === "DISABLED") return "DISABLED";
  if (manual === "DRAFT") return "DRAFT";
  if (manual === "CLOSED") return "CLOSED";
  // Recording sales stay open regardless of start time.
  if (isRecordingMode(w)) return "OPEN";
  const cutoff = registrationCutoffMs(w);
  const autoClose = w.auto_close_registration !== false; // default true
  if (autoClose && cutoff != null && now >= cutoff) return "ENDED";
  return "OPEN";
}

/** Can a new registration / payment be created right now? */
export function canRegisterForWebinar(w: LifecycleInput, now: number = Date.now()): boolean {
  return effectiveRegStatus(w, now) === "OPEN";
}

/** Has the session itself ended (for "Ended" badges / portal phase)? */
export function hasWebinarEnded(w: LifecycleInput, now: number = Date.now()): boolean {
  const end = parse(w.end_datetime) ?? parse(w.datetime);
  return end != null && now >= end;
}

export interface WebinarBadge {
  label: string;
  /** Tailwind pill class used across the admin UI. */
  cls: string;
}

/** Accurate admin/public badge — a past-start webinar never shows "Upcoming". */
export function webinarBadge(w: LifecycleInput, now: number = Date.now()): WebinarBadge {
  const s = effectiveRegStatus(w, now);
  if (s === "DISABLED") return { label: "Disabled", cls: "pill-gray" };
  if (s === "DRAFT") return { label: "Draft", cls: "pill-gray" };
  if (s === "ENDED") return { label: "Ended", cls: "pill-gray" };
  if (s === "CLOSED") return { label: "Registration Closed", cls: "pill-amber" };
  // OPEN
  if (isRecordingMode(w)) return { label: "Recording", cls: "pill-blue" };
  const start = parse(w.datetime);
  const end = parse(w.end_datetime) ?? (start != null ? start + 3 * 60 * 60 * 1000 : null);
  if (start != null && now >= start && (end == null || now <= end)) return { label: "Live", cls: "pill-green" };
  return { label: "Upcoming", cls: "pill-green" };
}

/**
 * Honest public registration-count display (Problem 1).
 *
 * The number passed in MUST be the REAL count (see getWebinarRegisteredCount in
 * dataProvider) — never the seeded `webinars.registrations` column. Below this
 * threshold we never show "0 registered"; we show encouraging copy (or nothing
 * on a past/completed session). At/above it we show the real count as social
 * proof. A per-webinar admin toggle can hide the count entirely.
 */
export const WEBINAR_MIN_PUBLIC_REGISTRATIONS = 10;
export const WEBINAR_REGCOUNT_ENCOURAGE = "Be among the first to register";

export interface RegCountDisplay {
  /** "count" → show "<n> registered"; "encourage" → first-mover copy; "hidden" → render nothing. */
  mode: "count" | "encourage" | "hidden";
  count: number;
}

export function webinarRegCountDisplay(opts: {
  count: number;
  showToggle?: boolean | null;
  completed?: boolean;
}): RegCountDisplay {
  // Admin explicitly turned the public count OFF.
  if (opts.showToggle === false) return { mode: "hidden", count: 0 };
  const count = Math.max(0, Math.floor(opts.count || 0));
  if (count >= WEBINAR_MIN_PUBLIC_REGISTRATIONS) return { mode: "count", count };
  // Low/zero real count: encourage on live/upcoming, stay silent on past events
  // (no "be the first" on something that already happened).
  return { mode: opts.completed ? "hidden" : "encourage", count };
}

/** Expired public-page copy (FEATURE 1). CTA target depends on lineage. */
export const EXPIRED_COPY = {
  title: "This webinar has ended",
  body:
    "Registration for this session is now closed. Please check the next available live session by Naman IAS Academy.",
  ctaUpcoming: "View upcoming webinars",
  ctaNext: "Register for the next live session",
} as const;

/**
 * Build the registration-closed error payload returned by payment-init APIs
 * (FEATURE 6). `nextWebinarUrl` is included when a successor session is linked.
 */
export function buildClosedError(w: { next_webinar_id?: string | null }, nextSlug?: string | null) {
  return {
    ok: false as const,
    error: "Registration for this webinar has closed.",
    closed: true as const,
    nextWebinarId: w.next_webinar_id ?? null,
    nextWebinarUrl: nextSlug ? `/webinars/${nextSlug}` : null,
  };
}

/**
 * Generate a clean, unique-ish slug for a duplicated webinar, e.g.
 * "upsc-strategy-28062026". Caller ensures global uniqueness.
 */
export function buildDuplicateSlug(title: string, startISO: string | null | undefined): string {
  const base = (title || "webinar")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "webinar";
  let stamp = "";
  const t = parse(startISO);
  if (t != null) {
    // IST calendar day (UTC+5:30) as ddmmyyyy.
    const ist = new Date(t + 330 * 60000);
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = ist.getUTCFullYear();
    stamp = `${dd}${mm}${yyyy}`;
  }
  return stamp ? `${base}-${stamp}` : base;
}

/** Fields that must NOT be copied when duplicating (identity / counters / lineage). */
export const NON_DUPLICABLE_WEBINAR_FIELDS: (keyof Webinar)[] = [
  "id",
  "slug",
  "created_at",
  "registrations",
  "next_webinar_id",
  "previous_webinar_id",
  "ended_at",
];
