/**
 * §9 — 12 Aug enforcement dry-run. READ-ONLY — no grants revoked, no SMS sent.
 *
 * Lists who re-locks when grandfather grants expire 2026-08-11T18:30:00.000Z
 * (12 Aug 00:00 IST), what they see, which template would fire, and flags anyone
 * who would NOT receive a taper/grandfather reminder before enforcement.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/dryrun-12aug-enforcement.ts
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { outstandingAmount, nextUnpaidDatedLine } from "../lib/accessAtRisk";
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
/** Simulate access one second after grant expiry (12 Aug 00:00:01 IST). */
const AFTER_ENFORCEMENT_MS = ENFORCEMENT_MS + 1000;

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
  if (input.grandfatherQueueSent) {
    return { ok: true, detail: "grandfather_notice_queue sent" };
  }
  if (input.smsSince.has(input.enrollmentId) || input.smsSince.has(input.phone)) {
    return { ok: true, detail: "prior access/installment SMS in window" };
  }
  if (input.dueDate) {
    const offsets = remainingGrandfatherTaperOffsets(input.dueDate, {
      fromYmd: GRANDFATHER_MID_WINDOW.pilotNoticeYmd,
      windowEndYmd: GRANDFATHER_MID_WINDOW.windowEndYmd,
    });
    const pilot = GRANDFATHER_MID_WINDOW.pilotNoticeYmd;
    const fires = [
      pilot,
      ...offsets.map((o) => taperOffsetFireYmd(input.dueDate!, o)).filter(Boolean),
    ] as string[];
    const eligible = fires.filter(
      (ymd) => ymd >= GRANDFATHER_MID_WINDOW.pilotNoticeYmd && ymd < GRANDFATHER_MID_WINDOW.windowEndYmd,
    );
    if (eligible.length === 0) {
      return { ok: false, detail: "no taper/grandfather fire dates before 12 Aug for this due date" };
    }
    return { ok: true, detail: `taper/grandfather eligible on: ${eligible.join(", ")}` };
  }
  return { ok: false, detail: "no due date — cannot verify pre-lock reminder" };
}

async function main() {
  loadEnv();
  const nowBefore = ENFORCEMENT_MS - 60_000;
  const nowAfter = AFTER_ENFORCEMENT_MS;

  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));

  // Grandfather queue sends (pilot + queued)
  let queueSent = new Set<string>();
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await sb
      .from("grandfather_notice_queue")
      .select("course_enrollment_id, sent_at, cohort")
      .not("sent_at", "is", null);
    queueSent = new Set((data || []).map((r) => String(r.course_enrollment_id)));
  } catch { /* optional */ }

  const since = `${GRANDFATHER_MID_WINDOW.pilotNoticeYmd}T00:00:00+05:30`;
  const logs = await listLogs({ from: since, limit: 10000 });
  const smsSince = new Map<string, number>();
  for (const l of logs) {
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    const at = Date.parse(l.sent_at || l.created_at);
    if (l.course_enrollment_id) smsSince.set(l.course_enrollment_id, at);
    if (l.normalized_mobile) smsSince.set(l.normalized_mobile, at);
  }

  const grandfatherExpiry = Date.parse(GRANDFATHER_MID_WINDOW.grantExpiresAt);
  const grantHolders = overrides.filter((o) => {
    if (o.mode !== "grant" || !o.expires_at) return false;
    const exp = Date.parse(o.expires_at);
    return Number.isFinite(exp) && Math.abs(exp - grandfatherExpiry) <= 120_000;
  });

  type Row = {
    enrollmentId: string;
    studentName: string;
    phone: string;
    cohort: "grandfather_63" | "classic_grace_10" | "other";
    paid: boolean;
    relocks: boolean;
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
  const seen = new Set<string>();

  for (const ovr of grantHolders) {
    const matches = enrollments.filter((e) => e.phone === ovr.phone && e.course_id === ovr.course_id);
    for (const e of matches) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);

      const paid = scheduleClear(e);
      const course = byCourse.get(e.course_id);
      const line = nextUnpaidDatedLine(e.schedule);
      const dueDate = line?.due ? istYMD(line.due) : null;

      const accessBefore = lectureAccessForCourse(course, e, ovr, false, nowBefore);
      const accessAfter = lectureAccessForCourse(course, e, ovr, false, nowAfter);
      const scheduleAfter = lectureAccessForCourse(course, e, undefined, false, nowAfter);

      const grantBefore = activeAccessGrant(ovr, nowBefore);
      const grantAfter = activeAccessGrant(ovr, nowAfter);
      const relocks = !paid && !!grantBefore && !grantAfter && !scheduleAfter.allowed;

      const pick = pickAccessTemplate({
        scheduleAccess: scheduleAfter,
        override: grantAfter,
        totalRemaining: outstandingAmount(e),
        now: nowAfter,
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
        : "grandfather_63";

      rows.push({
        enrollmentId: e.id,
        studentName: e.student_name,
        phone: e.phone,
        cohort,
        paid,
        relocks,
        liveAccessBefore: accessBefore.allowed ? "open (grant)" : accessBefore.status,
        liveAccessAfter: accessAfter.allowed ? "open" : scheduleAfter.status,
        lecturesLockedAfter: relocks || (scheduleAfter.status === "blocked" && !scheduleAfter.allowed),
        templateAfterLock: relocks ? (templateAfterLock || ACCESS_BLOCKED_TEMPLATE_ID) : null,
        reminderBeforeLock: reminder.ok,
        reminderDetail: reminder.detail,
        dueDate,
        amountOwed: outstandingAmount(e),
      });
    }
  }

  const relockRows = rows.filter((r) => r.relocks);
  const noReminder = rows.filter((r) => r.relocks && !r.reminderBeforeLock);
  const paidExcluded = rows.filter((r) => r.paid);

  const summary = {
    dryRun: true,
    enforcementAt: ENFORCEMENT_AT,
    enforcementIst: "2026-08-12 00:00 IST",
    grantHoldersScanned: rows.length,
    wouldRelock: relockRows.length,
    paidExcluded: paidExcluded.length,
    classicGrace10: rows.filter((r) => r.cohort === "classic_grace_10").length,
    grandfather63: rows.filter((r) => r.cohort === "grandfather_63").length,
    noReminderBeforeLock: noReminder.length,
    templateWouldFire: ACCESS_BLOCKED_TEMPLATE_ID,
    whatTheySee: "Hosted lectures gated (blocked/overdue) — portal shows payment due",
  };

  const out = { summary, relock: relockRows, noReminderBeforeLock: noReminder, all: rows };
  writeFileSync("scripts/dryrun-12aug-enforcement.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (noReminder.length) {
    console.error("\n⚠ No pre-lock reminder path for:");
    for (const r of noReminder) {
      console.error(`  ${r.studentName} (${r.enrollmentId}) — ${r.reminderDetail}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
