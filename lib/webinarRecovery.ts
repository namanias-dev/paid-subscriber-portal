/**
 * Public webinar state for historical URLs.
 *
 * Ended events must not 404. The next session is whichever eligible webinar
 * starts soonest — never a hardcoded date or a manually pasted successor.
 * Comparisons are epoch milliseconds, so the result does not depend on the
 * server, browser, or Arizona timezone. Starts are stored as UTC instants
 * (4:00 PM IST = 10:30 UTC).
 */
import { canRegisterForWebinar, isRecordingMode, type LifecycleInput } from "./webinarLifecycle";

export const HANDOFF_DELAY_MS = 5000;

/**
 * Both the explicit CTA and the automatic handoff use history replace.
 * push() would make Back land on this page, which would forward again.
 */
export const HANDOFF_HISTORY_MODE = "replace" as const;

/**
 * Marketing params the existing attribution cookie already captures.
 * Anything else (phones, tokens, emails) is dropped on the handoff URL.
 */
export const HANDOFF_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
  "gclid",
  "wbraid",
  "gbraid",
  "campaign_id",
  "adset_id",
  "ad_id",
  "ad_name",
] as const;

export type PublicWebinarOutcome =
  | "ACTIVE_UPCOMING"
  | "COMPLETED_WITH_NEXT_EVENT"
  | "COMPLETED_NO_NEXT_EVENT"
  | "NOT_FOUND";

/** Fields the resolver needs. Callers may pass a full Webinar. */
export interface RecoveryWebinar extends LifecycleInput {
  id: string;
  slug: string;
  title?: string | null;
  datetime?: string | null;
  status?: string | null;
  active?: boolean | null;
  registration_status?: string | null;
}

export type PublicWebinarResolution<T extends RecoveryWebinar> =
  | { outcome: "ACTIVE_UPCOMING" }
  | { outcome: "COMPLETED_WITH_NEXT_EVENT"; next: T }
  | { outcome: "COMPLETED_NO_NEXT_EVENT" }
  | { outcome: "NOT_FOUND" };

function parse(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function manualStatus(w: RecoveryWebinar): string {
  return (w.registration_status || "OPEN").toUpperCase();
}

export function isDraftWebinar(w: RecoveryWebinar): boolean {
  return manualStatus(w) === "DRAFT";
}

function hasStarted(w: RecoveryWebinar, now: number): boolean {
  const start = parse(w.datetime);
  return start != null && now >= start;
}

/** Same live window the existing badge uses when a row has no end time. */
const DEFAULT_SESSION_MS = 3 * 60 * 60 * 1000;

function sessionIsOver(w: RecoveryWebinar, now: number): boolean {
  const end = parse(w.end_datetime);
  if (end != null) return now >= end;
  const start = parse(w.datetime);
  if (start == null) return w.status === "completed";
  return now >= start + DEFAULT_SESSION_MS;
}

/**
 * A row that was never a public event. Drafts, and sessions deactivated
 * before they started, must not leak onto a public URL.
 */
export function isNeverPublic(w: RecoveryWebinar, now: number): boolean {
  if (isDraftWebinar(w)) return true;
  if (w.active === false && w.status !== "completed" && !hasStarted(w, now)) return true;
  return false;
}

/**
 * The nearest future live session a visitor can still register for.
 * Recording sales of past sessions are not a "next masterclass".
 */
export function selectNextLiveWebinar<T extends RecoveryWebinar>(
  candidates: readonly T[],
  excludeId: string | null,
  now: number,
): T | null {
  const eligible = candidates.filter((w) => {
    if (!w.id || w.id === excludeId) return false;
    if (w.active === false) return false;
    if (isDraftWebinar(w)) return false;
    if (w.status === "completed") return false;
    if (isRecordingMode(w)) return false;
    if (!canRegisterForWebinar(w, now)) return false;
    const start = parse(w.datetime);
    return start != null && start > now;
  });
  eligible.sort((a, b) => (parse(a.datetime) ?? 0) - (parse(b.datetime) ?? 0));
  return eligible[0] ?? null;
}

/**
 * Resolve what a public visitor should see for this webinar row.
 * `null` means the slug does not exist.
 */
export function resolvePublicWebinarState<T extends RecoveryWebinar>(
  webinar: T | null | undefined,
  candidates: readonly T[],
  now: number = Date.now(),
): PublicWebinarResolution<T> {
  if (!webinar) return { outcome: "NOT_FOUND" };
  if (isNeverPublic(webinar, now)) return { outcome: "NOT_FOUND" };

  // A recording that is intentionally still for sale keeps the normal page.
  const openForRegistration = webinar.active !== false && canRegisterForWebinar(webinar, now);
  if (openForRegistration && isRecordingMode(webinar)) return { outcome: "ACTIVE_UPCOMING" };

  // Still the public event: active, not marked completed, and not past its end.
  // Covers upcoming registration, a session that is live right now, and a
  // future date whose registration was closed early.
  if (webinar.active !== false && webinar.status !== "completed" && !sessionIsOver(webinar, now)) {
    return { outcome: "ACTIVE_UPCOMING" };
  }

  const next = selectNextLiveWebinar(candidates, webinar.id, now);
  if (next) return { outcome: "COMPLETED_WITH_NEXT_EVENT", next };
  return { outcome: "COMPLETED_NO_NEXT_EVENT" };
}

/** Keep attribution params; drop everything else. */
export function handoffUrl(pathname: string, search: string | null | undefined): string {
  const bare = (pathname || "/").split("?")[0].split("#")[0];
  const path = bare.startsWith("/") ? bare : `/${bare}`;
  const raw = (search || "").replace(/^\?/, "");
  const incoming = new URLSearchParams(raw);
  const out = new URLSearchParams();
  for (const key of HANDOFF_QUERY_KEYS) {
    const value = incoming.get(key);
    if (!value) continue;
    const trimmed = value.trim().slice(0, 200);
    if (trimmed) out.set(key, trimmed);
  }
  const q = out.toString();
  return q ? `${path}?${q}` : path;
}

const IST_COMPACT_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

function tidy(value: string): string {
  return value.replace(/\u202f|\u00a0/g, " ");
}

const IST_PARTS = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function partMap(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of IST_PARTS.formatToParts(d)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

/** IST wall-clock labels for the next session. Stable on any server timezone. */
export function formatNextSession(iso?: string | null): {
  weekday: string;
  dayMonth: string;
  weekdayDate: string;
  time: string;
  compact: string;
} | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = partMap(d);
  const weekday = tidy(parts.weekday || "");
  const dayMonth = tidy(`${parts.day || ""} ${parts.month || ""}`.trim());
  const clock = tidy(`${parts.hour || ""}:${parts.minute || ""}`);
  const period = tidy(parts.dayPeriod || "").replace(/\./g, "").toUpperCase();
  const time = `${clock} ${period} IST`.replace(/\s+/g, " ").trim();
  const compactDate = tidy(IST_COMPACT_DATE.format(d));
  return {
    weekday,
    dayMonth,
    weekdayDate: `${weekday}, ${dayMonth}`,
    time,
    compact: `${compactDate} · ${time}`,
  };
}

export function recoveryHostName(mentorName?: string | null): string {
  if (!mentorName || /naman/i.test(mentorName)) return "Naman Sir";
  return mentorName.trim() || "Naman Sir";
}
