/**
 * Seed grandfather notice queue: pilot_10 (unarmed) + queued_53.
 * Classic-grace 10 excluded. SENDS NOTHING.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/seed-grandfather-pilot.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";

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

const PILOT_ENROLLMENT_IDS = new Set([
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

function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "Student";
}

function fillExpiring(name: string, days: number, installmentNo: number): string {
  return `Hi ${firstName(name)}, your portal access expires in ${days} days. Pay installment ${installmentNo} to continue access. Naman Sharma IAS Academy.`;
}

function fillInstructions(): string {
  return "To pay your installment, login: https://www.namanias.com/login. Open Course Card > View & Pay > select Installment > Pay. Confirmation will follow. Naman Sharma IAS Academy.";
}

async function main() {
  loadEnv();
  const dry = JSON.parse(readFileSync("scripts/ladder-dry-run-latest.json", "utf8"));
  const all63 = dry.candidates.filter((c: { studentName: string }) => !CLASSIC_GRACE.has(c.studentName));
  if (all63.length !== 63) {
    console.error(`Expected 63 grandfather cohort, got ${all63.length}`);
    process.exit(1);
  }

  const pilot = all63.filter((c: { enrollmentId: string }) => PILOT_ENROLLMENT_IDS.has(c.enrollmentId));
  const queued = all63.filter((c: { enrollmentId: string }) => !PILOT_ENROLLMENT_IDS.has(c.enrollmentId));

  if (pilot.length !== 10) {
    console.error(`Pilot pick mismatch: ${pilot.length}`, pilot.map((p: { studentName: string }) => p.studentName));
    process.exit(1);
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const rows = [
    ...pilot.map((c: {
      enrollmentId: string; studentName: string; phone: string; installmentNo: number;
      amountDue: number; pctPaid: number;
    }) => ({
      course_enrollment_id: c.enrollmentId,
      student_name: c.studentName,
      phone: c.phone,
      installment_no: c.installmentNo,
      amount_due: c.amountDue,
      pct_paid: c.pctPaid,
      cohort: "pilot_10",
      armed: false,
      scheduled_for_ymd: "2026-08-05",
      schedule_time_ist: "11:00",
      meta: {
        days: 7,
        msg1: fillExpiring(c.studentName, 7, c.installmentNo),
        msg3: fillInstructions(),
      },
      updated_at: new Date().toISOString(),
    })),
    ...queued.map((c: {
      enrollmentId: string; studentName: string; phone: string; installmentNo: number;
      amountDue: number; pctPaid: number;
    }) => ({
      course_enrollment_id: c.enrollmentId,
      student_name: c.studentName,
      phone: c.phone,
      installment_no: c.installmentNo,
      amount_due: c.amountDue,
      pct_paid: c.pctPaid,
      cohort: "queued_53",
      armed: false,
      scheduled_for_ymd: "2026-08-06",
      schedule_time_ist: "11:00",
      meta: {},
      updated_at: new Date().toISOString(),
    })),
  ];

  const { error } = await sb.from("grandfather_notice_queue").upsert(rows, { onConflict: "course_enrollment_id" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  const report = {
    armed: false,
    scheduled_for: "2026-08-05T11:00:00+05:30",
    pilot: pilot.map((c: {
      studentName: string; phone: string; pctPaid: number; amountDue: number; installmentNo: number; loginCode: string | null;
    }) => ({
      name: c.studentName,
      pctPaid: c.pctPaid,
      amountDue: c.amountDue,
      phone: c.phone,
      phoneValid: String(c.phone || "").replace(/\D/g, "").length >= 10,
      installmentNo: c.installmentNo,
      loginCode: c.loginCode,
      msg1: fillExpiring(c.studentName, 7, c.installmentNo),
      msg3: fillInstructions(),
    })),
    queued53: queued.length,
    classicGraceExcluded: 10,
    sent: 0,
  };
  writeFileSync("scripts/grandfather-pilot-unarmed.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, pilot: 10, queued: queued.length, armed: false, sent: 0 }, null, 2));
  for (const p of report.pilot) {
    console.log(`${p.name}|${p.pctPaid}%|₹${p.amountDue}|${p.phone}|valid=${p.phoneValid}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
