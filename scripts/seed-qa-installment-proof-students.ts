/**
 * Seed disposable QA students for installment-proof popup (State A / State B).
 *
 * - Not in cohort 73 / grandfather_notice_queue / armed batches
 * - Added to installment_proof_popup meta.qa_phones (+ hardcoded allowlist)
 * - Hard SMS opt-out + access_reminder_caps excluded_from_automation
 *
 * Usage:
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/seed-qa-installment-proof-students.ts
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  QA_INSTALLMENT_PROOF_COURSE_ID,
  QA_INSTALLMENT_PROOF_MARKER,
  QA_INSTALLMENT_PROOF_PHONE_LIST,
  QA_INSTALLMENT_PROOF_STUDENTS,
} from "../lib/qaInstallmentProofStudents";
import { ensureBuyer, addCourseEnrollment, getAllCourses } from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { buildInstallmentProofPrompt } from "../lib/installmentPaymentProofs";
import {
  phoneInInstallmentProofCohort73,
  studentPopupEnabledForPhone,
} from "../lib/installmentProofFlags";
import { addOptOut, isOptedOut } from "../lib/sms/store";
import { setExcluded } from "../lib/sms/accessCapStore";
import { getSupabaseAdmin } from "../lib/supabase";

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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function assertPhoneFree(phone: string) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { count: q } = await sb
    .from("grandfather_notice_queue")
    .select("*", { count: "exact", head: true })
    .or(`phone.eq.${phone},phone.eq.91${phone},phone.eq.+91${phone}`);
  if ((q || 0) > 0) throw new Error(`${phone} is in grandfather_notice_queue — refuse`);
}

async function upsertFlagQaPhones() {
  const db = getSupabaseAdmin()!;
  const { data } = await db
    .from("app_feature_flags")
    .select("meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  const meta = { ...((data?.meta as Record<string, unknown>) || {}) };
  const existing = Array.isArray(meta.qa_phones) ? meta.qa_phones.map(String) : [];
  meta.qa_phones = [...new Set([...existing, ...QA_INSTALLMENT_PROOF_PHONE_LIST])];
  meta.qa_note = `${QA_INSTALLMENT_PROOF_MARKER} — disposable; teardown via scripts/teardown-qa-installment-proof-students.ts`;
  const { error } = await db
    .from("app_feature_flags")
    .update({ meta, updated_at: new Date().toISOString() })
    .eq("key", "installment_proof_popup");
  if (error) throw new Error(`flag meta update failed: ${error.message}`);
}

async function seedOne(spec: (typeof QA_INSTALLMENT_PROOF_STUDENTS)[keyof typeof QA_INSTALLMENT_PROOF_STUDENTS]) {
  await assertPhoneFree(spec.phone);

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === QA_INSTALLMENT_PROOF_COURSE_ID);
  if (!course) throw new Error(`course ${QA_INSTALLMENT_PROOF_COURSE_ID} missing`);

  const buyer = await ensureBuyer(spec.phone, spec.name);
  if (!buyer?.login_code) throw new Error(`ensureBuyer failed for ${spec.phone}`);

  const due =
    spec.state === "expiring"
      ? isoDaysFromNow(5) // State A: due in 5 days, still within grace
      : isoDaysFromNow(-30); // State B: overdue past grace (due+15)

  const seat = 5_000;
  const balance = 20_000;
  const now = new Date().toISOString();
  const schedule = [
    {
      no: 0,
      kind: "seat" as const,
      label: "Book Your Seat",
      amount: seat,
      paid: true,
      due: null,
      grace: null,
      paid_at: now,
      reference_no: `QA-PROOF-${spec.key.toUpperCase()}-SEAT`,
    },
    {
      no: 1,
      kind: "installment" as const,
      label: "Installment 1 of 1",
      amount: balance,
      paid: false,
      due,
      grace: null,
    },
  ];

  // Idempotent: cancel prior QA enrollments for this phone then insert fresh.
  const db = getSupabaseAdmin()!;
  await db
    .from("course_enrollments")
    .update({ status: "cancelled", updated_at: now })
    .eq("phone", spec.phone)
    .neq("status", "cancelled");

  const enrollment = await addCourseEnrollment({
    phone: spec.phone,
    student_name: spec.name,
    email: null,
    course_id: course.id,
    course_slug: course.slug || "safalta-online-foundation",
    course_title: course.title,
    batch_label: "QA · Online",
    plan_type: "emi",
    total_fee: seat + balance,
    amount_paid: seat,
    installment_count: 1,
    status: "seat_booked",
    schedule,
    payment_plan: "EMI",
  });

  // Tag student notes for teardown discovery.
  await db
    .from("students")
    .update({
      notes: `${QA_INSTALLMENT_PROOF_MARKER} key=${spec.key}`,
      name: spec.name,
    })
    .eq("phone", spec.phone);

  await addOptOut(
    spec.phone,
    `${QA_INSTALLMENT_PROOF_MARKER} — never SMS`,
    "qa_installment_proof",
    "seed-qa-installment-proof-students",
  );

  await setExcluded({
    courseEnrollmentId: enrollment.id,
    installmentNo: 1,
    excluded: true,
    reason: `${QA_INSTALLMENT_PROOF_MARKER} — exclude from reminder/taper/automation`,
    by: "seed-qa-installment-proof-students",
    normalizedMobile: spec.phone,
  });

  const live = lectureAccessForCourse(course, enrollment, undefined, false, Date.now());
  const prompt = await buildInstallmentProofPrompt(spec.phone);
  const in73 = await phoneInInstallmentProofCohort73(spec.phone);
  const popupOn = await studentPopupEnabledForPhone(spec.phone);
  const opted = await isOptedOut(spec.phone);

  const { count: queueN } = await db
    .from("grandfather_notice_queue")
    .select("*", { count: "exact", head: true })
    .or(`phone.eq.${spec.phone},phone.eq.91${spec.phone}`);

  return {
    key: spec.key,
    phone: spec.phone,
    name: spec.name,
    login_code: buyer.login_code,
    enrollment_id: enrollment.id,
    due: due.slice(0, 10),
    live: { allowed: live.allowed, reason: live.reason, status: live.status },
    prompt_state: prompt?.state ?? null,
    popup_enabled: popupOn,
    in_cohort_73: in73,
    in_grandfather_queue: (queueN || 0) > 0,
    sms_opted_out: opted,
    expected_state: spec.state === "expiring" ? "expiring" : "blocked",
  };
}

async function main() {
  loadEnv();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env");
  }

  await upsertFlagQaPhones();

  const results = [];
  for (const spec of Object.values(QA_INSTALLMENT_PROOF_STUDENTS)) {
    results.push(await seedOne(spec));
  }

  console.log(JSON.stringify({ ok: true, students: results }, null, 2));

  for (const r of results) {
    if (r.in_cohort_73 || r.in_grandfather_queue) {
      throw new Error(`${r.key} leaked into 73/queue`);
    }
    if (!r.sms_opted_out) throw new Error(`${r.key} not opted out of SMS`);
    if (!r.popup_enabled) throw new Error(`${r.key} popup not enabled for phone`);
    if (r.prompt_state !== r.expected_state) {
      throw new Error(`${r.key} prompt=${r.prompt_state} expected=${r.expected_state} live=${JSON.stringify(r.live)}`);
    }
    if (r.expected_state === "blocked" && r.live.allowed) {
      throw new Error(`${r.key} must be blocked on live playback`);
    }
    if (r.expected_state === "expiring" && !r.live.allowed) {
      throw new Error(`${r.key} must have live access for State A`);
    }
  }

  console.log("\nLogin (phone + code):");
  for (const r of results) {
    console.log(`  ${r.key}: phone=${r.phone}  code=${r.login_code}`);
  }
  console.log(
    "\nTeardown:\n  npx tsx --require ./scripts/react-cache-shim.cjs scripts/teardown-qa-installment-proof-students.ts",
  );
  console.log(
    "\nNote: popup allowlist code must be deployed for production portal to show QA popups (meta.qa_phones alone is not enough on old builds).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
