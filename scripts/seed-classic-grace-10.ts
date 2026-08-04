/**
 * §8 — Seed classic_grace_10 cohort (unarmed). No grandfather grant — stay locked.
 * Scheduled: 2026-08-06 11:00 IST → portal_access_blocked + call task on drain.
 * SENDS NOTHING until grandfather_notice_queue.armed=true.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/seed-classic-grace-10.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/seed-classic-grace-10.ts --arm
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { armGrandfatherCohort } from "../lib/sms/grandfatherNoticeSend";

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

/** Known classic-grace cohort — excluded from grandfather 63. */
const CLASSIC_GRACE_NAMES = new Set([
  "Srushti", "Prakriti", "Aman Sharma", "Ramneek Kaur", "Amar Sharma",
  "Simran Chaudhary", "Shubham Mishra", "Vidhi", "Rahul Kumar", "Devanshi",
]);

const SCHEDULED_YMD = "2026-08-06";
const SCHEDULE_TIME = "11:00";

async function main() {
  loadEnv();
  const arm = process.argv.includes("--arm");
  const dry = JSON.parse(readFileSync("scripts/ladder-dry-run-latest.json", "utf8"));
  const classic = dry.candidates.filter((c: { studentName: string }) => CLASSIC_GRACE_NAMES.has(c.studentName));

  if (classic.length !== 10) {
    console.error(`Expected 10 classic_grace_10 rows, got ${classic.length}`);
    console.error("Found:", classic.map((c: { studentName: string }) => c.studentName));
    process.exit(1);
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const rows = classic.map((c: {
    enrollmentId: string; studentName: string; phone: string;
    installmentNo: number; amountDue: number; pctPaid: number;
  }) => ({
    course_enrollment_id: c.enrollmentId,
    student_name: c.studentName,
    phone: c.phone,
    installment_no: c.installmentNo,
    amount_due: c.amountDue,
    pct_paid: c.pctPaid,
    cohort: "classic_grace_10",
    armed: false,
    scheduled_for_ymd: SCHEDULED_YMD,
    schedule_time_ist: SCHEDULE_TIME,
    meta: {
      template_id: "portal_access_blocked",
      create_call_task: true,
      stay_locked: true,
      no_grandfather_grant: true,
    },
    updated_at: new Date().toISOString(),
  }));

  const { error } = await sb.from("grandfather_notice_queue").upsert(rows, { onConflict: "course_enrollment_id" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  let armedCount = 0;
  if (arm) {
    armedCount = await armGrandfatherCohort({
      cohort: "classic_grace_10",
      scheduledForYmd: SCHEDULED_YMD,
      scheduleTimeIst: SCHEDULE_TIME,
    });
  }

  const report = {
    cohort: "classic_grace_10",
    count: classic.length,
    armed: arm,
    armedCount,
    scheduled_for: `${SCHEDULED_YMD}T${SCHEDULE_TIME}:00+05:30`,
    template: "portal_access_blocked",
    sent: 0,
    students: classic.map((c: { studentName: string; enrollmentId: string; phone: string }) => ({
      name: c.studentName,
      enrollmentId: c.enrollmentId,
      phone: c.phone,
    })),
  };
  writeFileSync("scripts/classic-grace-10-seed.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, ...report, students: report.students.length }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
