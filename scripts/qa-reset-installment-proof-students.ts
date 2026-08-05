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
  QA_INSTALLMENT_PROOF_STUDENT_IDS,
  QA_INSTALLMENT_PROOF_STUDENT_ID_LIST,
  QA_INSTALLMENT_PROOF_STUDENTS,
} from "../lib/qaInstallmentProofStudents";
import {
  addCourseEnrollment,
  bumpBuyerSessionVersion,
  createPayment,
  ensureBuyer,
  getAllCourses,
  getCourseEnrollmentsByPhone,
  getPaymentsByPhone,
  isPaidStatus,
} from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { deriveEnrollment } from "../lib/installments";
import { buildInstallmentProofPrompt } from "../lib/installmentPaymentProofs";
import {
  phoneInInstallmentProofCohort73,
  studentPopupEnabledForPhone,
} from "../lib/installmentProofFlags";
import { deleteObject, installmentProofPrefix, listAllObjects } from "../lib/r2";
import { addOptOut, isOptedOut, removeOptOut } from "../lib/sms/store";
import { setExcluded } from "../lib/sms/accessCapStore";
import { getSupabaseAdmin } from "../lib/supabase";
import { listProofPaymentsAwaitingFinance } from "../lib/installmentProofRecordPayment";

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

async function safetyCheck(phone: string, key: QaKey, opts?: { teardown?: boolean }): Promise<void> {
  const allow = QA_INSTALLMENT_PROOF_PHONE_LIST;
  if (!allow.includes(phone)) {
    throw new Error(`REFUSE: phone ${phone} not in QA allowlist (key=${key})`);
  }
  const spec = QA_INSTALLMENT_PROOF_STUDENTS[key];
  if (spec.phone !== phone) {
    throw new Error(`REFUSE: phone/key mismatch ${phone} vs ${key}`);
  }
  const expectedStudentId = QA_INSTALLMENT_PROOF_STUDENT_IDS[key];
  if (!QA_INSTALLMENT_PROOF_STUDENT_ID_LIST.includes(expectedStudentId)) {
    throw new Error(`REFUSE: student id ${expectedStudentId} not in QA student-id allowlist`);
  }

  const db = getSupabaseAdmin()!;
  const { data: stu } = await db.from("students").select("id,phone,notes").eq("phone", phone).maybeSingle();
  if (stu?.id && stu.id !== expectedStudentId) {
    throw new Error(
      `REFUSE: live students.id=${stu.id} ≠ allowlisted ${expectedStudentId} for ${key} — abort`,
    );
  }
  if (stu?.id && !QA_INSTALLMENT_PROOF_STUDENT_ID_LIST.includes(stu.id)) {
    throw new Error(`REFUSE: students.id ${stu.id} not in QA student-id allowlist`);
  }

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

  // Cap / taper: teardown deletes QA caps; refuse only if a non-QA-marked cap exists for this phone.
  try {
    const { data: caps } = await db
      .from("access_reminder_caps")
      .select("course_enrollment_id,excluded,reason")
      .eq("normalized_mobile", phone);
    const foreign = (caps || []).filter((c) => !String(c.reason || "").includes(QA_INSTALLMENT_PROOF_MARKER));
    if (foreign.length) {
      throw new Error(`REFUSE: ${key} has non-QA access_reminder_caps row`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("REFUSE:")) throw e;
  }

  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const enrollmentIds = enrollments.map((e) => e.id);
  if (!opts?.teardown && enrollmentIds.length) {
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
    }
  }

  // Include soft-deleted for gateway refuse
  const { data: allPays } = await db
    .from("payments")
    .select("id,amount,status,gateway,payment_source,reference_no,deleted_at")
    .eq("phone", phone);
  for (const p of allPays || []) {
    const src = String(p.payment_source || "");
    const isProof = src === "student_proof" || src === "student_proof_reversal";
    const isQaSeatRef = String(p.reference_no || "").startsWith("QA-PROOF-");
    const isOffProof =
      String(p.reference_no || "").startsWith("OFF-PROOF-") ||
      String(p.reference_no || "").startsWith("OFF-REV-");
    if (p.gateway && p.gateway !== "offline" && isPaidStatus(String(p.status))) {
      throw new Error(
        `REFUSE: ${key} has gateway payment ${p.id} gateway=${p.gateway} amount=${p.amount}`,
      );
    }
    if (
      !opts?.teardown &&
      isPaidStatus(String(p.status)) &&
      !isProof &&
      !isQaSeatRef &&
      !isOffProof &&
      p.gateway === "offline" &&
      Math.abs(Number(p.amount)) > 0
    ) {
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
      student_id_allowlist: expectedStudentId,
      live_student_id: stu?.id ?? null,
      teardown: !!opts?.teardown,
      env: process.env.NODE_ENV || "development",
      live_supabase: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
      note: "QA student-id allowlist passed; proceeding only with --confirm",
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
  // Also list by phone + student_id prefixes under installment-proofs/
  try {
    const listed = await listAllObjects(`installment-proofs/${phone}`);
    for (const o of listed) if (o.key) r2Keys.push(o.key);
  } catch {
    /* optional */
  }
  const { data: stu } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
  if (stu?.id) {
    try {
      const listed = await listAllObjects(`installment-proofs/${stu.id}`);
      for (const o of listed) if (o.key) r2Keys.push(o.key);
    } catch {
      /* optional */
    }
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
  if (!QA_INSTALLMENT_PROOF_PHONE_LIST.includes(phone)) {
    throw new Error(`REFUSE wipe: ${phone} not QA allowlist`);
  }
  let r2Deleted = 0;
  for (const key of [...new Set(r2Keys)]) {
    if (await deleteObject(key)) r2Deleted += 1;
  }

  // Delete student_proof + student_proof_reversal (+ OFF-PROOF/OFF-REV) together.
  // Also clear prior QA-PROOF seat baselines so reseed leaves exactly one ₹5k row.
  // Includes soft-deleted rows — getPaymentsByPhone hides deleted_at (prior wipe hole).
  const { data: wipedPays, error: payErr } = await db
    .from("payments")
    .delete()
    .eq("phone", phone)
    .or(
      [
        "payment_source.eq.student_proof",
        "payment_source.eq.student_proof_reversal",
        "reference_no.like.OFF-PROOF-%",
        "reference_no.like.OFF-REV-%",
        "reference_no.like.QA-PROOF-%",
      ].join(","),
    )
    .select("id,amount,payment_source,reference_no,status");
  if (payErr) throw new Error(`payment wipe failed: ${payErr.message}`);

  // Belt-and-suspenders: any remaining payments for this allowlisted phone (should be none).
  const { data: leftover, error: leftErr } = await db
    .from("payments")
    .delete()
    .eq("phone", phone)
    .select("id,amount,payment_source,reference_no,status");
  if (leftErr) throw new Error(`payment full wipe failed: ${leftErr.message}`);

  if (enrollmentIds.length) {
    await db.from("installment_payment_proofs").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("student_access_events").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("access_reminder_caps").delete().in("course_enrollment_id", enrollmentIds);
    try {
      await db.from("installment_allocation_audit").delete().in("enrollment_id", enrollmentIds);
    } catch {
      /* optional */
    }
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

  return {
    r2Deleted,
    wipedPayments: [...(wipedPays || []), ...(leftover || [])],
  };
}

async function assertCleanEndState(input: {
  key: QaKey;
  phone: string;
  enrollmentId: string;
  expectedState: "blocked" | "expiring";
  expectedPaid: number;
  expectedOutstanding: number;
}) {
  const db = getSupabaseAdmin()!;
  const enrollments = await getCourseEnrollmentsByPhone(input.phone);
  const active = enrollments.filter((e) => e.status !== "cancelled" && e.status !== "transferred_out");
  if (active.length !== 1) {
    throw new Error(`ASSERT FAIL ${input.key}: expected 1 active enrollment, got ${active.length}`);
  }
  const e = active[0]!;
  if (e.id !== input.enrollmentId) {
    throw new Error(`ASSERT FAIL ${input.key}: enrollment id mismatch`);
  }
  const derived = deriveEnrollment(e);
  if (Math.round(derived.paid) !== input.expectedPaid) {
    throw new Error(
      `ASSERT FAIL ${input.key}: net paid=${derived.paid} expected=${input.expectedPaid} (fully-paid drift)`,
    );
  }
  if (Math.round(derived.remaining) !== input.expectedOutstanding) {
    throw new Error(
      `ASSERT FAIL ${input.key}: outstanding=${derived.remaining} expected=${input.expectedOutstanding}`,
    );
  }
  const inst1 = (e.schedule || []).find((s) => s.kind === "installment" && s.no === 1);
  if (!inst1 || inst1.paid) {
    throw new Error(`ASSERT FAIL ${input.key}: Instalment 1 must be unpaid`);
  }

  const { data: pays } = await db
    .from("payments")
    .select("id,amount,status,payment_source,reference_no,deleted_at")
    .eq("phone", input.phone);
  const livePays = (pays || []).filter((p) => !p.deleted_at);
  const proofPays = livePays.filter(
    (p) =>
      p.payment_source === "student_proof" ||
      p.payment_source === "student_proof_reversal" ||
      String(p.reference_no || "").startsWith("OFF-PROOF-") ||
      String(p.reference_no || "").startsWith("OFF-REV-"),
  );
  if (proofPays.length) {
    throw new Error(
      `ASSERT FAIL ${input.key}: ${proofPays.length} proof/reversal payment(s) survived: ${JSON.stringify(proofPays)}`,
    );
  }
  const paidSum = livePays
    .filter((p) => isPaidStatus(String(p.status)))
    .reduce((a, p) => a + Number(p.amount || 0), 0);
  if (Math.round(paidSum) !== input.expectedPaid) {
    throw new Error(
      `ASSERT FAIL ${input.key}: payments PAID sum=${paidSum} expected baseline ${input.expectedPaid}`,
    );
  }
  if (livePays.length !== 1) {
    throw new Error(
      `ASSERT FAIL ${input.key}: expected exactly 1 baseline payment row, got ${livePays.length}: ${JSON.stringify(livePays)}`,
    );
  }

  const { count: proofN } = await db
    .from("installment_payment_proofs")
    .select("*", { count: "exact", head: true })
    .eq("course_enrollment_id", e.id);
  if ((proofN || 0) > 0) throw new Error(`ASSERT FAIL ${input.key}: ${proofN} proof rows remain`);

  const { data: ovrs } = await db.from("course_access_overrides").select("id").eq("phone", input.phone);
  if ((ovrs || []).length) throw new Error(`ASSERT FAIL ${input.key}: access override remains`);

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === e.course_id);
  const live = lectureAccessForCourse(course, e, undefined, false, Date.now());
  const prompt = await buildInstallmentProofPrompt(input.phone);
  if (input.expectedState === "blocked") {
    if (live.allowed) throw new Error(`ASSERT FAIL ${input.key}: live.allowed must be false`);
    if (prompt?.state !== "blocked") {
      throw new Error(`ASSERT FAIL ${input.key}: prompt=${prompt?.state} expected blocked`);
    }
  } else {
    if (!live.allowed) throw new Error(`ASSERT FAIL ${input.key}: live.allowed must be true`);
    if (prompt?.state !== "expiring") {
      throw new Error(`ASSERT FAIL ${input.key}: prompt=${prompt?.state} expected expiring`);
    }
  }

  // R2 prefix empty
  const r2Keys: string[] = [];
  try {
    for (const prefix of [`installment-proofs/${input.phone}`, `installment-proofs/`]) {
      /* phone + student id checked below */
    }
    const listed = await listAllObjects(`installment-proofs/${input.phone}`);
    r2Keys.push(...listed.map((o) => o.key).filter(Boolean) as string[]);
  } catch {
    /* */
  }
  const { data: stu } = await db.from("students").select("id").eq("phone", input.phone).maybeSingle();
  if (stu?.id) {
    try {
      const listed = await listAllObjects(`installment-proofs/${stu.id}`);
      r2Keys.push(...listed.map((o) => o.key).filter(Boolean) as string[]);
    } catch {
      /* */
    }
  }
  if (r2Keys.length) {
    throw new Error(`ASSERT FAIL ${input.key}: R2 residue ${JSON.stringify(r2Keys)}`);
  }

  return {
    paid: derived.paid,
    outstanding: derived.remaining,
    prompt_state: prompt?.state,
    live_allowed: live.allowed,
    payments: livePays,
    proofs: 0,
    r2: 0,
  };
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

  // Hard-delete prior enrollments (cancel leaves ghost rows that confuse portal UIs).
  if (enrollmentIds.length) {
    const { error: enrDelErr } = await db.from("course_enrollments").delete().in("id", enrollmentIds);
    if (enrDelErr) throw new Error(`enrollment delete failed: ${enrDelErr.message}`);
  }

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === QA_INSTALLMENT_PROOF_COURSE_ID);
  if (!course) throw new Error(`course ${QA_INSTALLMENT_PROOF_COURSE_ID} missing`);

  const buyer = await ensureBuyer(phone, spec.name);
  if (!buyer?.login_code) throw new Error(`ensureBuyer failed for ${phone}`);

  const due = spec.state === "expiring" ? isoDaysFromNow(5) : isoDaysFromNow(-30);
  const seat = 5_000;
  const balance = 20_000;
  const seatRef = `QA-PROOF-${spec.key.toUpperCase()}-SEAT-${Date.now().toString(36).toUpperCase()}`;
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
      reference_no: seatRef,
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

  // Genuine ₹5,000 baseline payment row (not student_proof).
  process.env.ALLOW_TEST_DB_WRITES = "1";
  await createPayment({
    student_name: spec.name,
    phone,
    email: null,
    item: `${course.title} — Book Your Seat`,
    item_type: "course",
    item_slug: course.slug || "safalta-online-foundation",
    amount: seat,
    status: "PAID",
    gateway: "offline",
    reference_no: seatRef,
    gateway_ref: "QA baseline seat",
    payment_mode: "QA baseline",
    mode: "QA baseline",
    transaction_amount: seat,
    transaction_date: now,
    created_at: now,
    razorpay_payment_id: null,
    enrollment_id: enrollment.id,
    payment_kind: "seat",
    installment_no: 0,
    payment_source: null,
    finance_verified: true,
    recorded_by: "qa-reset",
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

  const expectedState = spec.state === "expiring" ? ("expiring" as const) : ("blocked" as const);
  const asserted = await assertCleanEndState({
    key,
    phone,
    enrollmentId: enrollment.id,
    expectedState,
    expectedPaid: seat,
    expectedOutstanding: balance,
  });

  return {
    key,
    phone,
    login_code: buyer.login_code,
    enrollment_id: enrollment.id,
    wiped,
    asserted,
    popup_enabled: await studentPopupEnabledForPhone(phone),
    in73: await phoneInInstallmentProofCohort73(phone),
    sms_opted_out: await isOptedOut(phone),
    snooze_key: "ipp_bar_snooze_v6_*",
  };
}

async function teardownAll() {
  const db = getSupabaseAdmin()!;
  const phones = QA_INSTALLMENT_PROOF_PHONE_LIST;
  const runId = `qa-teardown-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  for (const key of Object.keys(QA_INSTALLMENT_PROOF_STUDENTS) as QaKey[]) {
    await safetyCheck(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key, { teardown: true });
  }

  type TeardownPlan = {
    key: QaKey;
    phone: string;
    student_id: string;
    enrollment_ids: string[];
    payments: unknown[];
    proofs: unknown[];
    overrides: unknown[];
    audits: number;
    events: number;
    call_tasks: number;
    caps: number;
    receipts: number;
    buyers: unknown[];
    students: unknown[];
    r2_keys: string[];
    r2_prefixes: string[];
  };

  const plans: TeardownPlan[] = [];
  for (const key of Object.keys(QA_INSTALLMENT_PROOF_STUDENTS) as QaKey[]) {
    const phone = QA_INSTALLMENT_PROOF_STUDENTS[key].phone;
    const studentId = QA_INSTALLMENT_PROOF_STUDENT_IDS[key];
    const { data: enrollments } = await db.from("course_enrollments").select("id,status").eq("phone", phone);
    const enrollmentIds = (enrollments || []).map((e) => e.id);
    const { data: payments } = await db
      .from("payments")
      .select("id,amount,status,payment_source,reference_no,gateway,deleted_at")
      .eq("phone", phone);
    const { data: proofsByEnr } = enrollmentIds.length
      ? await db
          .from("installment_payment_proofs")
          .select("id,status,files,student_id,course_enrollment_id")
          .in("course_enrollment_id", enrollmentIds)
      : { data: [] as unknown[] };
    const { data: proofsByStu } = await db
      .from("installment_payment_proofs")
      .select("id,status,files,student_id,course_enrollment_id")
      .eq("student_id", studentId);
    const proofsMap = new Map<string, (typeof proofsByEnr extends (infer T)[] | null ? T : never)>();
    for (const p of [...(proofsByEnr || []), ...(proofsByStu || [])] as { id: string }[]) {
      proofsMap.set(p.id, p as never);
    }
    const proofs = [...proofsMap.values()] as {
      id: string;
      status: string;
      files: unknown;
      student_id: string | null;
    }[];

    const { data: overrides } = await db.from("course_access_overrides").select("id,note").eq("phone", phone);
    const { count: audits } = enrollmentIds.length
      ? await db
          .from("installment_allocation_audit")
          .select("*", { count: "exact", head: true })
          .in("enrollment_id", enrollmentIds)
      : { count: 0 };
    const { count: events } = enrollmentIds.length
      ? await db
          .from("student_access_events")
          .select("*", { count: "exact", head: true })
          .or(
            [
              `course_enrollment_id.in.(${enrollmentIds.join(",")})`,
              `student_id.eq.${studentId}`,
              `phone.eq.${phone}`,
            ].join(","),
          )
      : await db
          .from("student_access_events")
          .select("*", { count: "exact", head: true })
          .or(`student_id.eq.${studentId},phone.eq.${phone}`);
    let callTasks = 0;
    if (enrollmentIds.length) {
      try {
        const { count } = await db
          .from("access_call_tasks")
          .select("*", { count: "exact", head: true })
          .in("course_enrollment_id", enrollmentIds);
        callTasks = count || 0;
      } catch {
        /* optional */
      }
    }
    let caps = 0;
    try {
      const { count } = await db
        .from("access_reminder_caps")
        .select("*", { count: "exact", head: true })
        .or(
          enrollmentIds.length
            ? `course_enrollment_id.in.(${enrollmentIds.join(",")}),normalized_mobile.eq.${phone}`
            : `normalized_mobile.eq.${phone}`,
        );
      caps = count || 0;
    } catch {
      /* optional */
    }
    let receipts = 0;
    if (enrollmentIds.length) {
      try {
        const { count } = await db
          .from("payment_receipts")
          .select("*", { count: "exact", head: true })
          .in("enrollment_id", enrollmentIds);
        receipts = count || 0;
      } catch {
        /* optional */
      }
    }
    const { data: buyers } = await db
      .from("buyers")
      .select("id,phone,login_code,session_version")
      .eq("phone", phone);
    const { data: students } = await db.from("students").select("id,phone,name").eq("phone", phone);

    const r2Keys: string[] = [];
    for (const p of proofs) {
      for (const f of Array.isArray(p.files) ? p.files : []) {
        const keyPath = String((f as { path?: string; key?: string }).path || (f as { key?: string }).key || "");
        if (keyPath) r2Keys.push(keyPath);
      }
    }
    // Canonical prefix = student_id; also wipe legacy phone prefix once.
    const prefixes = [
      installmentProofPrefix(studentId),
      `installment-proofs/${phone}/`, // legacy only — never written going forward
    ];
    for (const prefix of prefixes) {
      try {
        for (const o of await listAllObjects(prefix)) if (o.key) r2Keys.push(o.key);
      } catch {
        /* optional */
      }
    }

    plans.push({
      key,
      phone,
      student_id: studentId,
      enrollment_ids: enrollmentIds,
      payments: payments || [],
      proofs,
      overrides: overrides || [],
      audits: audits || 0,
      events: events || 0,
      call_tasks: callTasks,
      caps,
      receipts,
      buyers: buyers || [],
      students: students || [],
      r2_keys: [...new Set(r2Keys)],
      r2_prefixes: prefixes,
    });
  }

  console.log(JSON.stringify({ run_id: runId, started_at: startedAt, will_delete: plans }, null, 2));

  // Execute deletes — only allowlisted phones / student ids.
  for (const plan of plans) {
    if (!QA_INSTALLMENT_PROOF_PHONE_LIST.includes(plan.phone)) {
      throw new Error(`REFUSE teardown wipe: phone ${plan.phone}`);
    }
    if (!QA_INSTALLMENT_PROOF_STUDENT_ID_LIST.includes(plan.student_id)) {
      throw new Error(`REFUSE teardown wipe: student_id ${plan.student_id}`);
    }

    for (const key of plan.r2_keys) {
      await deleteObject(key);
    }

    // Payments as a set (baseline + proof + reversal) for this phone only.
    const { error: payErr } = await db.from("payments").delete().eq("phone", plan.phone);
    if (payErr) throw new Error(`payments delete failed: ${payErr.message}`);

    if (plan.enrollment_ids.length) {
      await db.from("installment_payment_proofs").delete().in("course_enrollment_id", plan.enrollment_ids);
      await db.from("installment_allocation_audit").delete().in("enrollment_id", plan.enrollment_ids);
      await db.from("student_access_events").delete().in("course_enrollment_id", plan.enrollment_ids);
      try {
        await db.from("access_reminder_caps").delete().in("course_enrollment_id", plan.enrollment_ids);
      } catch {
        /* optional */
      }
      try {
        await db.from("access_call_tasks").delete().in("course_enrollment_id", plan.enrollment_ids);
      } catch {
        /* optional */
      }
      try {
        await db.from("payment_receipts").delete().in("enrollment_id", plan.enrollment_ids);
      } catch {
        /* optional */
      }
    }
    // Also by student_id / phone for any orphaned rows
    await db.from("installment_payment_proofs").delete().eq("student_id", plan.student_id);
    await db
      .from("student_access_events")
      .delete()
      .or(`student_id.eq.${plan.student_id},phone.eq.${plan.phone}`);
    await db.from("course_access_overrides").delete().eq("phone", plan.phone);
    try {
      await db.from("access_reminder_caps").delete().eq("normalized_mobile", plan.phone);
    } catch {
      /* optional */
    }
    try {
      await db.from("payment_action_log").delete().eq("phone", plan.phone);
    } catch {
      /* optional */
    }

    const { error: enrErr } = await db.from("course_enrollments").delete().eq("phone", plan.phone);
    if (enrErr) throw new Error(`enrollments delete failed: ${enrErr.message}`);

    // Revoke login: bump then delete buyer
    await bumpBuyerSessionVersion(plan.phone).catch(() => null);
    await db.from("buyers").delete().eq("phone", plan.phone);
    await db.from("students").delete().eq("id", plan.student_id);
    await db.from("students").delete().eq("phone", plan.phone);
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

  const asserted = await assertTeardownZero();
  console.log(
    JSON.stringify({
      run_id: runId,
      finished_at: new Date().toISOString(),
      log: "qa_teardown_complete",
      asserted,
    }, null, 2),
  );
  return { phones, student_ids: QA_INSTALLMENT_PROOF_STUDENT_ID_LIST, run_id: runId, asserted, ok: true };
}

async function countEq(
  table: string,
  filter: { col: string; val: string } | { col: string; vals: string[] },
): Promise<number> {
  const db = getSupabaseAdmin()!;
  try {
    let q = db.from(table).select("*", { count: "exact", head: true });
    if ("vals" in filter) q = q.in(filter.col, filter.vals);
    else q = q.eq(filter.col, filter.val);
    const { count, error } = await q;
    if (error) return -1; // table missing / column missing → surface as non-zero fail only if unexpected
    return count || 0;
  } catch {
    return -1;
  }
}

async function assertTeardownZero() {
  const db = getSupabaseAdmin()!;
  const phones = QA_INSTALLMENT_PROOF_PHONE_LIST;
  const studentIds = QA_INSTALLMENT_PROOF_STUDENT_ID_LIST;
  const counts: Record<string, number> = {};

  for (const phone of phones) {
    counts[`payments:phone:${phone}`] = await countEq("payments", { col: "phone", val: phone });
    counts[`course_enrollments:phone:${phone}`] = await countEq("course_enrollments", {
      col: "phone",
      val: phone,
    });
    counts[`course_access_overrides:phone:${phone}`] = await countEq("course_access_overrides", {
      col: "phone",
      val: phone,
    });
    counts[`buyers:phone:${phone}`] = await countEq("buyers", { col: "phone", val: phone });
    counts[`students:phone:${phone}`] = await countEq("students", { col: "phone", val: phone });
    counts[`student_access_events:phone:${phone}`] = await countEq("student_access_events", {
      col: "phone",
      val: phone,
    });
    counts[`installment_payment_proofs:phone:${phone}`] = await countEq("installment_payment_proofs", {
      col: "phone",
      val: phone,
    });
    counts[`grandfather_notice_queue:phone:${phone}`] = await countEq("grandfather_notice_queue", {
      col: "phone",
      val: phone,
    });
    counts[`payment_action_log:phone:${phone}`] = await countEq("payment_action_log", {
      col: "phone",
      val: phone,
    });
    counts[`payment_receipts:phone:${phone}`] = await countEq("payment_receipts", {
      col: "phone",
      val: phone,
    });
  }
  for (const sid of studentIds) {
    counts[`students:id:${sid}`] = await countEq("students", { col: "id", val: sid });
    counts[`installment_payment_proofs:student_id:${sid}`] = await countEq("installment_payment_proofs", {
      col: "student_id",
      val: sid,
    });
    counts[`student_access_events:student_id:${sid}`] = await countEq("student_access_events", {
      col: "student_id",
      val: sid,
    });
  }

  // Audits / caps / call tasks / receipts via enrollment_id — enrollments already 0 so these should be 0;
  // also scan audit by phone if column exists.
  for (const phone of phones) {
    try {
      const { count } = await db
        .from("installment_allocation_audit")
        .select("*", { count: "exact", head: true })
        .eq("phone", phone);
      counts[`installment_allocation_audit:phone:${phone}`] = count || 0;
    } catch {
      counts[`installment_allocation_audit:phone:${phone}`] = 0;
    }
    try {
      const { count } = await db
        .from("access_reminder_caps")
        .select("*", { count: "exact", head: true })
        .eq("normalized_mobile", phone);
      counts[`access_reminder_caps:phone:${phone}`] = count || 0;
    } catch {
      counts[`access_reminder_caps:phone:${phone}`] = 0;
    }
  }

  const r2: Record<string, number> = {};
  for (const sid of studentIds) {
    const prefix = installmentProofPrefix(sid);
    try {
      r2[prefix] = (await listAllObjects(prefix)).length;
    } catch {
      r2[prefix] = -1;
    }
  }
  for (const phone of phones) {
    const legacy = `installment-proofs/${phone}/`;
    try {
      r2[legacy] = (await listAllObjects(legacy)).length;
    } catch {
      r2[legacy] = -1;
    }
  }

  let finance_queue_qa = 0;
  try {
    const q = await listProofPaymentsAwaitingFinance();
    finance_queue_qa = (q || []).filter((r) =>
      phones.includes(String(r.payment?.phone || "").replace(/\D/g, "").slice(-10)),
    ).length;
  } catch {
    finance_queue_qa = -1;
  }
  counts["finance_queue_qa"] = finance_queue_qa;

  // Flag scope
  const { data: flag } = await db
    .from("app_feature_flags")
    .select("meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  const qaPhones = Array.isArray((flag?.meta as { qa_phones?: unknown })?.qa_phones)
    ? ((flag!.meta as { qa_phones: unknown[] }).qa_phones as unknown[]).map(String)
    : [];
  const flag_residue = qaPhones.filter((p) => phones.includes(p.replace(/\D/g, "").slice(-10))).length;
  counts["flag_qa_phones_residue"] = flag_residue;

  for (const phone of phones) {
    if (await studentPopupEnabledForPhone(phone)) {
      throw new Error(`ASSERT FAIL ${phone} still in installment_proof_popup scope`);
    }
  }

  const nonzero = Object.entries({ ...counts, ...Object.fromEntries(Object.entries(r2).map(([k, v]) => [`r2:${k}`, v])) }).filter(
    ([, n]) => n !== 0,
  );
  if (nonzero.length) {
    throw new Error(
      `ASSERT FAIL teardown residue: ${JSON.stringify(Object.fromEntries(nonzero), null, 2)}`,
    );
  }

  // Phones absent from armed / queue
  for (const phone of phones) {
    if (await phoneInInstallmentProofCohort73(phone)) {
      throw new Error(`ASSERT FAIL ${phone} still in cohort 73`);
    }
  }

  return { counts, r2, flag_qa_phones: qaPhones, ok: true };
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
        await safetyCheck(QA_INSTALLMENT_PROOF_STUDENTS[key].phone, key, { teardown: true });
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
    if (Math.round(r.asserted.paid) !== 5000) {
      throw new Error(`${r.key} asserted paid=${r.asserted.paid} (want 5000)`);
    }
    if (Math.round(r.asserted.outstanding) !== 20000) {
      throw new Error(`${r.key} asserted outstanding=${r.asserted.outstanding} (want 20000)`);
    }
    if (r.asserted.proofs !== 0 || r.asserted.r2 !== 0) {
      throw new Error(`${r.key} proofs/r2 not zero`);
    }
    const want = r.key === "qa_blocked" ? "blocked" : "expiring";
    if (r.asserted.prompt_state !== want) {
      throw new Error(`${r.key} prompt=${r.asserted.prompt_state} expected=${want}`);
    }
    if (want === "blocked" && r.asserted.live_allowed) {
      throw new Error(`${r.key} must be blocked on live playback`);
    }
    if (want === "expiring" && !r.asserted.live_allowed) {
      throw new Error(`${r.key} must have live access`);
    }
  }

  console.log(JSON.stringify({ ok: true, mode: "reset", students: results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
