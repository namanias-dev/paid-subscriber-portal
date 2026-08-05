/**
 * Hard-guarded QA reset / teardown for installment-proof disposable students.
 *
 * Commands (package.json):
 *   npm run qa:reset -- --student=qa_blocked|qa_expiring|both --confirm
 *   npm run qa:teardown -- --confirm
 *
 * Only touches phones in QA_INSTALLMENT_PROOF_STUDENTS. Refuses cohort-73,
 * armed batches, call tasks, and non-student_proof gateway payments.
 */
import { readFileSync, existsSync } from "fs";
import {
  QA_INSTALLMENT_PROOF_COURSE_ID,
  QA_INSTALLMENT_PROOF_MARKER,
  QA_INSTALLMENT_PROOF_PHONE_LIST,
  QA_INSTALLMENT_PROOF_STUDENTS,
} from "../lib/qaInstallmentProofStudents";
import {
  addCourseEnrollment,
  bumpBuyerSessionVersion,
  ensureBuyer,
  getAllCourses,
  getCourseEnrollmentsByPhone,
  getPaymentsByPhone,
  isPaidStatus,
} from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { buildInstallmentProofPrompt } from "../lib/installmentPaymentProofs";
import {
  phoneInInstallmentProofCohort73,
  studentPopupEnabledForPhone,
} from "../lib/installmentProofFlags";
import { deleteObject, listAllObjects } from "../lib/r2";
import { addOptOut, isOptedOut, removeOptOut } from "../lib/sms/store";
import { setExcluded } from "../lib/sms/accessCapStore";
import { getSupabaseAdmin } from "../lib/supabase";

type QaKey = keyof typeof QA_INSTALLMENT_PROOF_STUDENTS;

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

function parseArgs(argv: string[]) {
  const out: { mode: "reset" | "teardown"; student: "both" | QaKey; confirm: boolean } = {
    mode: "reset",
    student: "both",
    confirm: false,
  };
  for (const a of argv) {
    if (a === "--confirm") out.confirm = true;
    else if (a === "--teardown" || a.startsWith("--mode=teardown")) out.mode = "teardown";
    else if (a.startsWith("--student=")) {
      const v = a.slice("--student=".length);
      if (v === "both" || v === "qa_blocked" || v === "qa_expiring") out.student = v;
      else throw new Error(`REFUSE: unknown --student=${v} (allowlist: qa_blocked|qa_expiring|both)`);
    }
  }
  // Detect npm run qa:teardown via env or script name in argv[1]
  const script = argv.join(" ");
  if (/teardown-qa|qa:teardown|--teardown/.test(script)) out.mode = "teardown";
  return out;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function safetyCheck(phone: string, key: QaKey): Promise<void> {
  const allow = QA_INSTALLMENT_PROOF_PHONE_LIST;
  if (!allow.includes(phone)) {
    throw new Error(`REFUSE: phone ${phone} not in QA allowlist (key=${key})`);
  }
  const spec = QA_INSTALLMENT_PROOF_STUDENTS[key];
  if (spec.phone !== phone) {
    throw new Error(`REFUSE: phone/key mismatch ${phone} vs ${key}`);
  }

  const db = getSupabaseAdmin()!;
  if (await phoneInInstallmentProofCohort73(phone)) {
    throw new Error(`REFUSE: ${key} appears in cohort 73 / grandfather path`);
  }
  const { count: queueN } = await db
    .from("grandfather_notice_queue")
    .select("*", { count: "exact", head: true })
    .or(`phone.eq.${phone},phone.eq.91${phone},phone.eq.+91${phone}`);
  if ((queueN || 0) > 0) {
    throw new Error(`REFUSE: ${key} is in grandfather_notice_queue`);
  }
  const { data: armed } = await db
    .from("grandfather_notice_queue")
    .select("id,armed,cohort")
    .eq("armed", true)
    .or(`phone.eq.${phone},phone.eq.91${phone}`);
  if ((armed || []).length) {
    throw new Error(`REFUSE: ${key} matches an armed batch row`);
  }

  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const enrollmentIds = enrollments.map((e) => e.id);
  if (enrollmentIds.length) {
    try {
      const { count: tasks } = await db
        .from("access_call_tasks")
        .select("*", { count: "exact", head: true })
        .in("course_enrollment_id", enrollmentIds)
        .neq("status", "done");
      if ((tasks || 0) > 0) {
        throw new Error(`REFUSE: ${key} has open call tasks`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("REFUSE:")) throw e;
      /* table may not exist */
    }
  }

  const payments = await getPaymentsByPhone(phone);
  for (const p of payments) {
    const src = String(p.payment_source || "");
    const isProof = src === "student_proof" || src === "student_proof_reversal";
    const isQaSeatRef = String(p.reference_no || "").startsWith("QA-PROOF-");
    if (isPaidStatus(p.status) && !isProof && !isQaSeatRef && p.gateway && p.gateway !== "offline") {
      throw new Error(
        `REFUSE: ${key} has non-student_proof gateway payment ${p.id} gateway=${p.gateway} amount=${p.amount}`,
      );
    }
    // Any non-proof, non-QA offline paid row that's not the seat baseline pattern
    if (
      isPaidStatus(p.status) &&
      !isProof &&
      !isQaSeatRef &&
      p.gateway === "offline" &&
      Math.abs(p.amount) > 0 &&
      !String(p.reference_no || "").startsWith("QA-PROOF-")
    ) {
      // Seat baseline may not exist as a payment row; refuse unknown offline money.
      throw new Error(
        `REFUSE: ${key} has unexpected offline payment ${p.id} amount=${p.amount} ref=${p.reference_no}`,
      );
    }
  }

  console.log(
    JSON.stringify({
      safety: "ok",
      key,
      phone,
      env: process.env.NODE_ENV || "development",
      live_supabase: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
      note: "QA allowlist passed; proceeding only with --confirm",
    }),
  );
}

async function planDeletes(phone: string, key: QaKey) {
  const db = getSupabaseAdmin()!;
  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const enrollmentIds = enrollments.map((e) => e.id);
  const payments = await getPaymentsByPhone(phone);
  const proofPays = payments.filter(
    (p) => p.payment_source === "student_proof" || p.payment_source === "student_proof_reversal",
  );
  const { data: proofs } = enrollmentIds.length
    ? await db.from("installment_payment_proofs").select("id,status,files").in("course_enrollment_id", enrollmentIds)
    : { data: [] as { id: string; status: string; files: unknown }[] };
  const { data: overrides } = await db.from("course_access_overrides").select("id,note").eq("phone", phone);
  const { data: events } = enrollmentIds.length
    ? await db
        .from("student_access_events")
        .select("id,event_type")
        .in("course_enrollment_id", enrollmentIds)
    : { data: [] as { id: string; event_type: string }[] };

  const r2Keys: string[] = [];
  for (const p of proofs || []) {
    for (const f of Array.isArray(p.files) ? p.files : []) {
      const keyPath = String((f as { path?: string; key?: string }).path || (f as { key?: string }).key || "");
      if (keyPath) r2Keys.push(keyPath);
    }
  }
  // Also list by phone prefix under installment-proofs/
  try {
    const listed = await listAllObjects(`installment-proofs/${phone}`);
    for (const o of listed) if (o.key) r2Keys.push(o.key);
  } catch {
    /* optional */
  }

  return {
    key,
    phone,
    enrollmentIds,
    delete_payments: proofPays.map((p) => ({
      id: p.id,
      amount: p.amount,
      source: p.payment_source,
      ref: p.reference_no,
    })),
    delete_proofs: (proofs || []).map((p) => ({ id: p.id, status: p.status })),
    delete_overrides: overrides || [],
    delete_events: (events || []).length,
    delete_r2_keys: [...new Set(r2Keys)],
  };
}

async function wipeProofResidue(phone: string, enrollmentIds: string[], r2Keys: string[]) {
  const db = getSupabaseAdmin()!;
  let r2Deleted = 0;
  for (const key of r2Keys) {
    if (await deleteObject(key)) r2Deleted += 1;
  }
  if (enrollmentIds.length) {
    await db.from("installment_payment_proofs").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("student_access_events").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("access_reminder_caps").delete().in("course_enrollment_id", enrollmentIds);
    try {
      await db.from("access_call_tasks").delete().in("course_enrollment_id", enrollmentIds);
    } catch {
      /* optional */
    }
    try {
      await db.from("payment_receipts").delete().in("enrollment_id", enrollmentIds);
    } catch {
      /* optional */
    }
  }
  await db.from("course_access_overrides").delete().eq("phone", phone);

  const payments = await getPaymentsByPhone(phone);
  for (const p of payments) {
    if (p.payment_source === "student_proof" || p.payment_source === "student_proof_reversal") {
      await db.from("payments").delete().eq("id", p.id);
    }
  }
  return { r2Deleted };
}

async function reseedOne(key: QaKey) {
  const spec = QA_INSTALLMENT_PROOF_STUDENTS[key];
  const phone = spec.phone;
  await safetyCheck(phone, key);
  const plan = await planDeletes(phone, key);
  console.log(JSON.stringify({ will_delete: plan }, null, 2));

  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const enrollmentIds = enrollments.map((e) => e.id);
  const wiped = await wipeProofResidue(phone, enrollmentIds, plan.delete_r2_keys);

  const db = getSupabaseAdmin()!;
  const now = new Date().toISOString();
  await db
    .from("course_enrollments")
    .update({ status: "cancelled", updated_at: now })
    .eq("phone", phone)
    .neq("status", "cancelled");

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === QA_INSTALLMENT_PROOF_COURSE_ID);
  if (!course) throw new Error(`course ${QA_INSTALLMENT_PROOF_COURSE_ID} missing`);

  const buyer = await ensureBuyer(phone, spec.name);
  if (!buyer?.login_code) throw new Error(`ensureBuyer failed for ${phone}`);

  const due =
    spec.state === "expiring" ? isoDaysFromNow(5) : isoDaysFromNow(-30);
  const seat = 5_000;
  const balance = 20_000;
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

  const enrollment = await addCourseEnrollment({
    phone,
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

  await db
    .from("students")
    .update({ notes: `${QA_INSTALLMENT_PROOF_MARKER} key=${spec.key}`, name: spec.name })
    .eq("phone", phone);

  await addOptOut(phone, `${QA_INSTALLMENT_PROOF_MARKER} — never SMS`, "qa_installment_proof", "qa-reset");
  await setExcluded({
    courseEnrollmentId: enrollment.id,
    installmentNo: 1,
    excluded: true,
    reason: `${QA_INSTALLMENT_PROOF_MARKER} — exclude from reminder/taper/automation`,
    by: "qa-reset",
    normalizedMobile: phone,
  });

  // Ensure flag allowlist still contains this phone
  const { data: flag } = await db
    .from("app_feature_flags")
    .select("meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  if (flag) {
    const meta = { ...((flag.meta as Record<string, unknown>) || {}) };
    const qa = Array.isArray(meta.qa_phones) ? meta.qa_phones.map(String) : [];
    meta.qa_phones = [...new Set([...qa, ...QA_INSTALLMENT_PROOF_PHONE_LIST])];
    meta.qa_note = `${QA_INSTALLMENT_PROOF_MARKER} — disposable; npm run qa:teardown -- --confirm`;
    await db
      .from("app_feature_flags")
      .update({ meta, updated_at: now })
      .eq("key", "installment_proof_popup");
  }

  await bumpBuyerSessionVersion(phone).catch(() => null);

  const live = lectureAccessForCourse(course, enrollment, undefined, false, Date.now());
  const prompt = await buildInstallmentProofPrompt(phone);
  const paymentsLeft = await getPaymentsByPhone(phone);
  const proofPaysLeft = paymentsLeft.filter(
    (p) => p.payment_source === "student_proof" || p.payment_source === "student_proof_reversal",
  );

  return {
    key,
    phone,
    login_code: buyer.login_code,
    enrollment_id: enrollment.id,
    outstanding: balance,
    wiped,
    live: { allowed: live.allowed, status: live.status, reason: live.reason },
    prompt_state: prompt?.state ?? null,
    expected_state: spec.state === "expiring" ? "expiring" : "blocked",
    popup_enabled: await studentPopupEnabledForPhone(phone),
    in73: await phoneInInstallmentProofCohort73(phone),
    sms_opted_out: await isOptedOut(phone),
    proof_payments_left: proofPaysLeft.length,
    snooze_key: "ipp_bar_snooze_v5_* (client localStorage bumped)",
  };
}

async function teardownAll() {
  const db = getSupabaseAdmin()!;
  const phones = QA_INSTALLMENT_PROOF_PHONE_LIST;
  for (const key of Object.keys(QA_INSTALLMENT_PROOF_STUDENTS) as QaKey[]) {
    await safetyCheck(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key);
  }
  const plans = [];
  for (const key of Object.keys(QA_INSTALLMENT_PROOF_STUDENTS) as QaKey[]) {
    plans.push(await planDeletes(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key));
  }
  console.log(JSON.stringify({ will_delete: plans }, null, 2));

  for (const plan of plans) {
    await wipeProofResidue(plan.phone, plan.enrollmentIds, plan.delete_r2_keys);
    await db.from("course_enrollments").delete().eq("phone", plan.phone);
    await db.from("students").delete().eq("phone", plan.phone);
    await db.from("buyers").delete().eq("phone", plan.phone);
    await removeOptOut(plan.phone);
  }

  await db.from("grandfather_notice_queue").delete().or(
    phones.map((p) => `phone.eq.${p},phone.eq.91${p},phone.eq.+91${p}`).join(","),
  );

  const { data: flag } = await db
    .from("app_feature_flags")
    .select("meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  if (flag) {
    const meta = { ...((flag.meta as Record<string, unknown>) || {}) };
    const qa = Array.isArray(meta.qa_phones) ? meta.qa_phones.map(String) : [];
    meta.qa_phones = qa.filter((p) => !phones.includes(p.replace(/\D/g, "").slice(-10)));
    if (String(meta.qa_note || "").includes(QA_INSTALLMENT_PROOF_MARKER)) delete meta.qa_note;
    await db
      .from("app_feature_flags")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("key", "installment_proof_popup");
  }

  return { phones, ok: true };
}

async function main() {
  loadEnv();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env");
  }
  // npm passes args after -- ; also support npm_lifecycle_event
  const life = process.env.npm_lifecycle_event || "";
  const args = parseArgs(process.argv.slice(2));
  if (life === "qa:teardown") args.mode = "teardown";

  if (!args.confirm) {
    console.error("REFUSE: missing --confirm. Print-only dry plan:");
    if (args.mode === "teardown") {
      for (const key of Object.keys(QA_INSTALLMENT_PROOF_STUDENTS) as QaKey[]) {
        await safetyCheck(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key);
        console.log(JSON.stringify(await planDeletes(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key), null, 2));
      }
    } else {
      const keys: QaKey[] =
        args.student === "both" ? (["qa_expiring", "qa_blocked"] as QaKey[]) : [args.student];
      for (const key of keys) {
        await safetyCheck(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key);
        console.log(JSON.stringify(await planDeletes(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key), null, 2));
      }
    }
    process.exit(2);
  }

  if (args.mode === "teardown") {
    const r = await teardownAll();
    console.log(JSON.stringify({ ok: true, mode: "teardown", ...r }, null, 2));
    return;
  }

  const keys: QaKey[] =
    args.student === "both" ? (["qa_expiring", "qa_blocked"] as QaKey[]) : [args.student];
  const results = [];
  for (const key of keys) {
    results.push(await reseedOne(key));
  }

  for (const r of results) {
    if (r.in73) throw new Error(`${r.key} leaked into 73`);
    if (!r.sms_opted_out) throw new Error(`${r.key} not opted out`);
    if (!r.popup_enabled) throw new Error(`${r.key} popup not enabled`);
    if (r.proof_payments_left !== 0) throw new Error(`${r.key} still has proof payments`);
    if (r.prompt_state !== r.expected_state) {
      throw new Error(`${r.key} prompt=${r.prompt_state} expected=${r.expected_state} live=${JSON.stringify(r.live)}`);
    }
    if (r.expected_state === "blocked" && r.live.allowed) {
      throw new Error(`${r.key} must be blocked on live playback`);
    }
  }

  console.log(JSON.stringify({ ok: true, mode: "reset", students: results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
