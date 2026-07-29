/**
 * Shared silencers for Access At Risk bulk (manual) sends.
 * Mirrors automation gates without changing automation cadence/settings.
 */
import { listLogs } from "./store";
import {
  getAccessReminderSettings,
  logAutomationRun,
  listCapsForEnrollments,
} from "./accessCapStore";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_DAILY_VOLUME_CEILING,
  ACCESS_QUIET_HOURS_IST,
} from "./accessReminderConstants";
import { istHour } from "./accessDays";
import { istYMD } from "../dates";

export function accessInQuietHours(now = Date.now()): boolean {
  const h = istHour(now);
  return h < ACCESS_QUIET_HOURS_IST.startHour || h >= ACCESS_QUIET_HOURS_IST.endHour;
}

/** Successful access-reminder SMS count today (IST) — ADMIN + SYSTEM. */
export async function countAccessSmsSentToday(now = Date.now()): Promise<number> {
  const today = istYMD(new Date(now));
  if (!today) return 0;
  const since = `${today}T00:00:00+05:30`;
  const [a, b] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
  ]);
  let n = 0;
  for (const l of [...a, ...b]) {
    if (["SENT", "DELIVERED", "QUEUED"].includes(l.status)) n++;
  }
  return n;
}

/** Phones that already received an access reminder today (IST). */
export async function accessPhonesSentToday(now = Date.now()): Promise<Set<string>> {
  const today = istYMD(new Date(now));
  if (!today) return new Set();
  const since = `${today}T00:00:00+05:30`;
  const [a, b] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
  ]);
  const hit = new Set<string>();
  for (const l of [...a, ...b]) {
    if (["SENT", "DELIVERED", "QUEUED"].includes(l.status) && l.normalized_mobile) {
      hit.add(l.normalized_mobile);
    }
  }
  return hit;
}

export async function enrollmentNeedsCallSet(enrollmentIds: string[]): Promise<Set<string>> {
  const caps = await listCapsForEnrollments(enrollmentIds);
  const out = new Set<string>();
  for (const c of caps) {
    if (c.needs_call) out.add(c.course_enrollment_id);
  }
  return out;
}

export async function remainingAccessDailyBudget(now = Date.now()): Promise<{
  ceiling: number;
  sentToday: number;
  remaining: number;
  killSwitch: boolean;
  quiet: boolean;
}> {
  const settings = await getAccessReminderSettings();
  const ceiling = settings.dailyCeiling || ACCESS_DAILY_VOLUME_CEILING;
  const sentToday = await countAccessSmsSentToday(now);
  return {
    ceiling,
    sentToday,
    remaining: Math.max(0, ceiling - sentToday),
    killSwitch: settings.killSwitch,
    quiet: accessInQuietHours(now),
  };
}

/** Record a manual bulk wave so volume accounting stays honest next to automation. */
export async function logManualAccessBulkRun(input: {
  requested: number;
  sent: number;
  excluded: number;
  haltedReason: string | null;
  detail: unknown;
}): Promise<void> {
  await logAutomationRun({
    dryRun: false,
    killSwitch: false,
    enabled: true,
    wouldSend: input.requested,
    excluded: input.excluded,
    sent: input.sent,
    haltedReason: input.haltedReason ?? "manual_bulk",
    detail: { source: "manual_bulk", ...(input.detail as object) },
  });
}

export function templateBreakdown(
  previews: { sendable: boolean; templateId?: string | null }[],
): { expiring: number; blocked: number } {
  let expiring = 0;
  let blocked = 0;
  for (const p of previews) {
    if (!p.sendable || !p.templateId) continue;
    if (p.templateId === ACCESS_EXPIRING_TEMPLATE_ID) expiring++;
    else if (p.templateId === ACCESS_BLOCKED_TEMPLATE_ID) blocked++;
  }
  return { expiring, blocked };
}
