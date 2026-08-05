/**
 * §9 — 12 Aug enforcement dry-run. READ-ONLY.
 *
 * Recomputes live access at enforcement time from current overrides —
 * NOT a frozen 63 list. A provisional grant past 12 Aug keeps lectures open.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/dryrun-12aug-enforcement.ts
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { outstandingAmount, nextUnpaidDatedLine, isAccessAtRiskEnrollment } from "../lib/accessAtRisk";
import { activeAccessGrant, pickAccessTemplate } from "../lib/sms/accessReminderService";
import {
  GRANDFATHER_MID_WINDOW,
  ACCESS_BLOCKED_TEMPLATE_ID,
} from "../lib/sms/accessReminderConstants";
import {
  remainingGrandfatherTaperOffsets,
  taperOffsetFireYmd,
} from "../lib/sms/accessReminderTaper";
import { istYMD } from "../lib/dates";
import { listLogs } from "../lib/sms/store";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const ENFORCEMENT_AT = GRANDFATHER_MID_WINDOW.grantExpiresAt;
const ENFORCEMENT_MS = Date.parse(ENFORCEMENT_AT);
const AFTER_ENFORCEMENT_MS = ENFORCEMENT_MS + 1000;
const BEFORE_MS = ENFORCEMENT_MS - 60_000;

const CLASSIC_GRACE = new Set([
  "Srushti", "Prakriti", "Aman Sharma", "Ramneek Kaur", "Amar Sharma",
  "Simran Chaudhary", "Shubham Mishra", "Vidhi", "Rahul Kumar", "Devanshi",
]);

function scheduleClear(e: { total_fee: number; amount_paid: number; schedule: unknown[] | null }): boolean {
  return outstandingAmount(e) <= 0;
}

function hadReminderBeforeEnforcement(input: {
  enrollmentId: string;
  phone: string;
  dueDate: string | null;
  grandfatherQueueSent: boolean;
  smsSince: Map<string, number>;
}): { ok: boolean; detail: string } {
  if (input.grandfatherQueueSent) return { ok: true, detail: "grandfather_notice_queue sent" };
  if (input.smsSince.has(input.enrollmentId) || input.smsSince.has(input.phone)) {
    return { ok: true, detail: "prior access/installment SMS in window" };
  }
  if (input.dueDate) {
    const offsets = remainingGrandfatherTaperOffsets(input.dueDate, {
      fromYmd: GRANDFATHER_MID_WINDOW.pilotNoticeYmd,
      windowEndYmd: GRANDFATHER_MID_WINDOW.windowEndYmd,
    });
    const fires = [
      GRANDFATHER_MID_WINDOW.pilotNoticeYmd,
      ...offsets.map((o) => taperOffsetFireYmd(input.dueDate!, o)).filter(Boolean),
    ] as string[];
    const eligible = fires.filter(
      (ymd) => ymd >= GRANDFATHER_MID_WINDOW.pilotNoticeYmd && ymd < GRANDFATHER_MID_WINDOW.windowEndYmd,
    );
    if (!eligible.length) return { ok: false, detail: "no taper/grandfather fire dates before 12 Aug" };
    return { ok: true, detail: `taper/grandfather eligible on: ${eligible.join(", ")}` };
  }
  return { ok: false, detail: "no due date — cannot verify pre-lock reminder" };
}

async function main() {
  loadEnv();
  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const ovrKey = (phone: string, courseId: string) => `${phone}|${courseId}`;
  const ovrBy = new Map(overrides.map((o) => [ovrKey(o.phone, o.course_id), o]));

  let queueSent = new Set<string>();
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await sb
      .from("grandfather_notice_queue")
      .select("course_enrollment_id, sent_at")
      .not("sent_at", "is", null);
    queueSent = new Set((data || []).map((r) => String(r.course_enrollment_id)));
  } catch { /* optional */ }

  const since = `${GRANDFATHER_MID_WINDOW.pilotNoticeYmd}T00:00:00+05:30`;
  const logs = await listLogs({ from: since, limit: 10000 });
  const smsSince = new Map<string, number>();
  for (const l of logs) {
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    if (l.course_enrollment_id) smsSince.set(l.course_enrollment_id, Date.parse(l.sent_at || l.created_at));
    if (l.normalized_mobile) smsSince.set(l.normalized_mobile, Date.parse(l.sent_at || l.created_at));
  }

  type Row = {
    enrollmentId: string;
    studentName: string;
    phone: string;
    cohort: string;
    paid: boolean;
    relocks: boolean;
    grantExpiresAt: string | null;
    grantActiveAfterEnforcement: boolean;
    liveAccessBefore: string;
    liveAccessAfter: string;
    lecturesLockedAfter: boolean;
    templateAfterLock: string | null;
    reminderBeforeLock: boolean;
    reminderDetail: string;
    dueDate: string | null;
    amountOwed: number;
  };

  const rows: Row[] = [];

  for (const e of enrollments) {
    if (e.status === "cancelled") continue;
    const ovr = ovrBy.get(ovrKey(e.phone, e.course_id));
    const course = byCourse.get(e.course_id);
    const scheduleBefore = lectureAccessForCourse(course, e, undefined, false, BEFORE_MS);
    const grantBefore = activeAccessGrant(ovr, BEFORE_MS);

    // Candidates: money risk before enforcement OR held open only by a grant that expires at/before enforcement.
    const atRiskBefore = isAccessAtRiskEnrollment({
      enrollment: e,
      scheduleAccess: scheduleBefore,
      override: ovr,
      now: BEFORE_MS,
    });
    if (!atRiskBefore && !grantBefore) continue;

    const paid = scheduleClear(e);
    const line = nextUnpaidDatedLine(e.schedule);
    const dueDate = line?.due ? istYMD(line.due) : null;

    const accessBefore = lectureAccessForCourse(course, e, ovr, false, BEFORE_MS);
    const accessAfter = lectureAccessForCourse(course, e, ovr, false, AFTER_ENFORCEMENT_MS);
    const scheduleAfter = lectureAccessForCourse(course, e, undefined, false, AFTER_ENFORCEMENT_MS);
    const grantAfter = activeAccessGrant(ovr, AFTER_ENFORCEMENT_MS);

    // Relock = was open via grant before, grant no longer active after, schedule still blocks, unpaid.
    // Provisional grants past 12 Aug → grantAfter stays → relocks=false.
    const relocks =
      !paid &&
      !!grantBefore &&
      !grantAfter &&
      !scheduleAfter.allowed &&
      accessBefore.allowed &&
      !accessAfter.allowed;

    const pick = pickAccessTemplate({
      scheduleAccess: scheduleAfter,
      override: grantAfter,
      totalRemaining: outstandingAmount(e),
      now: AFTER_ENFORCEMENT_MS,
    });
    const templateAfterLock = "block" in pick ? null : pick.templateId;

    const reminder = hadReminderBeforeEnforcement({
      enrollmentId: e.id,
      phone: e.phone,
      dueDate: line?.due ?? null,
      grandfatherQueueSent: queueSent.has(e.id),
      smsSince,
    });

    const cohort = CLASSIC_GRACE.has(e.student_name)
      ? "classic_grace_10"
      : grantBefore
        ? "had_grant_before_enforcement"
        : "other_at_risk";

    // Only emit rows that had a grant before enforcement (the 12 Aug cohort + any provisional).
    if (!grantBefore) continue;

    rows.push({
      enrollmentId: e.id,
      studentName: e.student_name,
      phone: e.phone,
      cohort,
      paid,
      relocks,
      grantExpiresAt: ovr?.expires_at ?? null,
      grantActiveAfterEnforcement: !!grantAfter,
      liveAccessBefore: accessBefore.allowed ? "open (grant)" : accessBefore.status,
      liveAccessAfter: accessAfter.allowed ? "open (grant still active)" : scheduleAfter.status,
      lecturesLockedAfter: relocks,
      templateAfterLock: relocks ? (templateAfterLock || ACCESS_BLOCKED_TEMPLATE_ID) : null,
      reminderBeforeLock: reminder.ok,
      reminderDetail: reminder.detail,
      dueDate,
      amountOwed: outstandingAmount(e),
    });
  }

  const relockRows = rows.filter((r) => r.relocks);
  const keptByLongerGrant = rows.filter((r) => !r.relocks && r.grantActiveAfterEnforcement && !r.paid);
  const noReminder = rows.filter((r) => r.relocks && !r.reminderBeforeLock);
  const paidExcluded = rows.filter((r) => r.paid);

  const summary = {
    dryRun: true,
    recomputesAtRuntime: true,
    enforcementAt: ENFORCEMENT_AT,
    enforcementIst: "2026-08-12 00:00 IST",
    grantHoldersScanned: rows.length,
    wouldRelock: relockRows.length,
    keptOpenByLongerGrant: keptByLongerGrant.length,
    paidExcluded: paidExcluded.length,
    noReminderBeforeLock: noReminder.length,
    templateWouldFire: ACCESS_BLOCKED_TEMPLATE_ID,
    note: "Relock only when activeAccessGrant is null after enforcement AND schedule still blocks. Provisional grants past 12 Aug stay open.",
  };

  const out = { summary, relock: relockRows, keptByLongerGrant, noReminderBeforeLock: noReminder, all: rows };
  writeFileSync("scripts/dryrun-12aug-enforcement.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
