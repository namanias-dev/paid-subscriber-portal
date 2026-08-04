/**
 * Apply 7-day grandfather grant to the 63 silent-lock cohort.
 * Expiry: 2026-08-12 00:00 IST (start of 12 Aug) so that day's cron sees blocked+no grant.
 * Classic-grace 10 excluded. SENDS NOTHING.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/apply-grandfather-grants.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { extendCourseAccess } from "../lib/accessActions";
import { getCourseEnrollmentById, getAllCourses } from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { activeAccessGrant } from "../lib/sms/accessReminderService";
import { buildInstallmentReminder } from "../lib/sms/installmentReminderService";
import { resolveInstallmentForEnrollment, formatFeeInRs } from "../lib/sms/installmentReminder";
import { firstNamesMatch, resolveBuyersByPhones } from "../lib/sms/store";
import { normalizeIndianMobile } from "../lib/phone";

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

const CLASSIC_GRACE = new Set([
  "Srushti", "Prakriti", "Aman Sharma", "Ramneek Kaur", "Amar Sharma",
  "Simran Chaudhary", "Shubham Mishra", "Vidhi", "Rahul Kumar", "Devanshi",
]);

const PILOT_IDS = new Set([
  "838fb641-5bef-4a6a-9bc2-56161e332dca",
  "88853448-ed4d-44d7-b5f7-5a789f72d24c",
  "14bbc324-0351-45ff-8412-029c96f48a3d",
  "332f0473-6673-4872-85b1-ff2b670ae3e5",
  "386f17a9-6a2c-4aac-af45-4b04c40a124f",
  "b7565b1a-7270-4aca-a113-5a758e2f8e13",
  "7a48493c-422c-45a1-be82-3acea1f32ac6",
  "12755ad2-dfef-41cf-9bf2-267e15bd22ec",
  "78088310-1121-4362-a4f1-8d314f115daa",
  "32a11079-0822-4130-bb23-f08ee74faf94",
]);

/** Start of 12 Aug 2026 IST = enforcement day. */
const EXPIRES_AT = "2026-08-11T18:30:00.000Z";
const REASON = "grandfathered notice — silent lock from batch-start resolution";

function fillMsg(name: string, instNo: number, fee: number, code: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "Student";
  return `Hi ${first}, your course fee installment no. ${instNo} of Rs.${formatFeeInRs(fee)} is due. Login: https://www.namanias.com/login Code: ${code} to complete payment. Naman Sharma IAS Academy.`;
}

async function main() {
  loadEnv();
  const dry = JSON.parse(readFileSync("scripts/ladder-dry-run-latest.json", "utf8"));
  const all63 = dry.candidates.filter((c: { studentName: string }) => !CLASSIC_GRACE.has(c.studentName));
  if (all63.length !== 63) {
    console.error(`Expected 63, got ${all63.length}`);
    process.exit(1);
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Snapshot overrides BEFORE (tighten detection)
  const phones = [...new Set(all63.map((c: { phone: string }) => c.phone))];
  const { data: beforeOvr } = await sb.from("course_access_overrides").select("*").in("phone", phones);
  const beforeMap = new Map((beforeOvr || []).map((o: { phone: string; course_id: string; expires_at: string | null; mode: string }) =>
    [`${o.phone}::${o.course_id}`, o]));

  let granted = 0;
  let failed: { name: string; error: string }[] = [];
  for (const c of all63 as { enrollmentId: string; studentName: string; phone: string; courseId?: string }[]) {
    const e = await getCourseEnrollmentById(c.enrollmentId);
    if (!e) { failed.push({ name: c.studentName, error: "enrollment_missing" }); continue; }
    const r = await extendCourseAccess({
      phone: e.phone,
      courseId: e.course_id,
      expiresAt: EXPIRES_AT,
      reason: REASON,
      actor: { id: null, name: "system" },
      elevated: true, // 7+ days from now to 12 Aug may exceed 7d depending on run date
      enrollmentId: e.id,
    });
    if (!r.ok) failed.push({ name: c.studentName, error: r.error });
    else granted++;
  }

  // Tighten check: no grant shorter than before, no revoke of longer grant into shorter without reason
  const { data: afterOvr } = await sb.from("course_access_overrides").select("*").in("phone", phones);
  let tightened = 0;
  for (const o of afterOvr || []) {
    const key = `${o.phone}::${o.course_id}`;
    const prev = beforeMap.get(key);
    if (!prev) continue;
    if (prev.mode === "grant" && prev.expires_at && o.expires_at) {
      if (Date.parse(o.expires_at) < Date.parse(prev.expires_at)) tightened++;
    }
  }

  // Login code audit for all 63
  const digits = all63.map((c: { phone: string }) => normalizeIndianMobile(c.phone).digits10!).filter(Boolean);
  const buyers = await resolveBuyersByPhones(digits);
  const missingCode: { name: string; phone: string; enrollmentId: string; reason: string }[] = [];
  const withCode: { name: string; enrollmentId: string; code: string; fee: number; inst: number; body: string }[] = [];

  for (const c of all63 as { enrollmentId: string; studentName: string; phone: string }[]) {
    const e = await getCourseEnrollmentById(c.enrollmentId);
    if (!e) continue;
    const d = normalizeIndianMobile(e.phone).digits10!;
    const b = buyers.get(d);
    const code = b && b.status === "ok" && b.login_code && firstNamesMatch(e.student_name, b.name) ? b.login_code : "";
    const resolved = resolveInstallmentForEnrollment(e);
    const fee = resolved.ok ? resolved.resolved.amountDue : 0;
    const inst = resolved.ok ? resolved.resolved.installmentNo : 0;
    if (!code) {
      missingCode.push({
        name: e.student_name,
        phone: e.phone,
        enrollmentId: e.id,
        reason: !b ? "no_buyer" : b.status === "ambiguous" ? "ambiguous_buyer" : !b.login_code ? "blank_code" : "name_mismatch",
      });
    } else {
      withCode.push({
        name: e.student_name,
        enrollmentId: e.id,
        code,
        fee,
        inst,
        body: fillMsg(e.student_name, inst, fee, code),
      });
    }
  }

  // Spot-check lectures reopen
  const courses = await getAllCourses();
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const spotNames = ["Krishna Gupta", "Amandeep Kaur", "Harshita"];
  const spots: { name: string; liveAllowed: boolean; grantExp: string | null; scheduleStatus: string }[] = [];
  for (const name of spotNames) {
    const c = all63.find((x: { studentName: string }) => x.studentName === name);
    if (!c) continue;
    const e = await getCourseEnrollmentById(c.enrollmentId);
    if (!e) continue;
    const { data: ovrs } = await sb.from("course_access_overrides").select("*").eq("phone", e.phone).eq("course_id", e.course_id);
    const ovr = (ovrs || [])[0] || null;
    const schedule = lectureAccessForCourse(byCourse.get(e.course_id), e, undefined, false);
    const live = lectureAccessForCourse(byCourse.get(e.course_id), e, ovr, false);
    const grant = activeAccessGrant(ovr);
    spots.push({
      name,
      liveAllowed: live.allowed,
      grantExp: grant?.expires_at ?? null,
      scheduleStatus: schedule.status,
    });
  }

  // Update pilot queue messages
  const pilotBodies = withCode.filter((w) => PILOT_IDS.has(w.enrollmentId));
  const excludeFromPilot = [...PILOT_IDS].filter((id) => missingCode.some((m) => m.enrollmentId === id));

  for (const row of all63 as { enrollmentId: string; studentName: string; phone: string; installmentNo: number; amountDue: number; pctPaid: number }[]) {
    const body = withCode.find((w) => w.enrollmentId === row.enrollmentId);
    const missing = missingCode.find((m) => m.enrollmentId === row.enrollmentId);
    const isPilot = PILOT_IDS.has(row.enrollmentId);
    await sb.from("grandfather_notice_queue").upsert({
      course_enrollment_id: row.enrollmentId,
      student_name: row.studentName,
      phone: row.phone,
      installment_no: row.installmentNo,
      amount_due: row.amountDue,
      pct_paid: row.pctPaid,
      cohort: isPilot ? "pilot_10" : "queued_53",
      armed: false,
      scheduled_for_ymd: isPilot ? "2026-08-05" : "2026-08-06",
      schedule_time_ist: "11:00",
      meta: {
        template_id: "installment_reminder",
        excluded_missing_login_code: !!missing,
        exclude_reason: missing?.reason ?? null,
        msg: body?.body ?? null,
        login_code: body?.code ?? null,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "course_enrollment_id" });
  }

  // Heal MC rule template_id if row exists
  await sb.from("sms_auto_rules").update({
    template_id: "installment_reminder",
    schedule_time: "11:00",
    enabled: false,
    updated_at: new Date().toISOString(),
  }).eq("trigger", "installment_access_reminder");

  const report = {
    granted,
    failed,
    tightened,
    missingCode,
    spots,
    pilotSendable: pilotBodies.map((p) => ({
      name: p.name,
      enrollmentId: p.enrollmentId,
      msg: p.body,
      fee: p.fee,
      inst: p.inst,
      code: p.code,
    })),
    pilotExcludedMissingCode: excludeFromPilot,
    expiresAt: EXPIRES_AT,
    armed: false,
    sent: 0,
  };
  writeFileSync("scripts/grandfather-grant-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    granted,
    failed: failed.length,
    tightened,
    missingCode: missingCode.length,
    missingNames: missingCode.map((m) => m.name),
    spots,
    pilotSendable: pilotBodies.length,
    pilotExcluded: excludeFromPilot.length,
    armed: false,
    sent: 0,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
