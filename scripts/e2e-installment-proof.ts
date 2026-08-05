/**
 * Safe E2E for installment proof approve/reject/supersede on a NON-73 student.
 * Does NOT write to payments. Cleans up proofs + test grant at end (restores prior override).
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  submitInstallmentProof,
  uploadInstallmentProofFile,
  approveInstallmentProof,
  rejectInstallmentProof,
  supersedeProofsOnPaid,
  getProofById,
  listProofsForEnrollment,
} from "../lib/installmentPaymentProofs";
import { getCourseEnrollmentById, getAllCourses, getAccessOverridesByPhone } from "../lib/dataProvider";
import { lectureAccessForCourse } from "../lib/entitlements";
import { phoneInInstallmentProofCohort73 } from "../lib/installmentProofFlags";
import { extendCourseAccess } from "../lib/accessActions";
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

/** Minimal valid 1×1 PNG */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const TEST_ENROLLMENT = "114f0104-8ad8-4281-9ff5-139d11e37427"; // Amey — non-73, blocked

async function paymentSnapshot(phone: string) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const digits = phone.replace(/\D/g, "").slice(-10);
  const { data, count } = await sb
    .from("payments")
    .select("id,amount,status,reference_no", { count: "exact" })
    .or(`phone.eq.${digits},phone.eq.91${digits}`);
  const rows = data || [];
  return {
    count: count ?? rows.length,
    sum: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    statuses: rows.map((r) => `${r.id}:${r.status}:${r.amount}`).sort(),
  };
}

async function main() {
  loadEnv();
  const e = await getCourseEnrollmentById(TEST_ENROLLMENT);
  if (!e) throw new Error("test enrollment missing");
  if (await phoneInInstallmentProofCohort73(e.phone)) throw new Error("REFUSE: student is in cohort 73");

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === e.course_id);
  const priorOvr = (await getAccessOverridesByPhone(e.phone)).find((o) => o.course_id === e.course_id) || null;
  const liveBefore = lectureAccessForCourse(course, e, priorOvr || undefined, false, Date.now());
  const payBefore = await paymentSnapshot(e.phone);

  const instNo = 3;
  const up = await uploadInstallmentProofFile({
    phone: e.phone,
    studentId: null,
    installmentNo: instNo,
    originalName: "e2e.png",
    buffer: PNG,
  });
  if (!up.ok) throw new Error(up.error);

  const sub = await submitInstallmentProof({
    phone: e.phone,
    enrollmentId: e.id,
    installmentNo: instNo,
    files: [up.file],
    claimedAmount: 1000,
    studentComment: "e2e proof approve test — safe delete after",
  });
  if (!sub.ok) throw new Error(sub.error);
  const proofA = sub.proof;

  const appr = await approveInstallmentProof({
    proofId: proofA.id,
    actor: { id: "e2e", name: "e2e_system" },
  });
  if (!appr.ok) throw new Error(appr.error);

  const ovrAfter = (await getAccessOverridesByPhone(e.phone)).find((o) => o.course_id === e.course_id);
  const liveAfter = lectureAccessForCourse(course, e, ovrAfter, false, Date.now());
  const payAfter = await paymentSnapshot(e.phone);

  const db = getSupabaseAdmin()!;
  const { data: events } = await db
    .from("student_access_events")
    .select("event_type,actor,created_at,reason,installment_no")
    .eq("course_enrollment_id", e.id)
    .in("event_type", ["proof_uploaded", "proof_approved", "provisional_access_granted", "extension_granted", "proof_rejected", "proof_superseded"])
    .order("created_at", { ascending: false })
    .limit(20);

  // Loosen-only check: set far grant then approve shorter — must keep far
  const far = "2026-12-01T00:00:00.000Z";
  await extendCourseAccess({
    phone: e.phone,
    courseId: e.course_id,
    expiresAt: far,
    reason: "e2e loosen-only baseline",
    actor: { id: "e2e", name: "e2e_system" },
    enrollmentId: e.id,
    elevated: true,
  });
  const short = new Date(Date.now() + 2 * 86400000).toISOString();
  const loose = await extendCourseAccess({
    phone: e.phone,
    courseId: e.course_id,
    expiresAt: short,
    reason: "payment proof approved — pending finance reconciliation",
    actor: { id: "e2e", name: "e2e_system" },
    enrollmentId: e.id,
  });
  const ovrLoose = (await getAccessOverridesByPhone(e.phone)).find((o) => o.course_id === e.course_id);

  // Reject + re-upload path
  const up2 = await uploadInstallmentProofFile({
    phone: e.phone,
    studentId: null,
    installmentNo: instNo + 100, // distinct key so pending unique allows parallel claim path
    originalName: "e2e-reject.png",
    buffer: PNG,
  });
  if (!up2.ok) throw new Error(up2.error);
  // Use same installment after clearing — create pending on instNo via new submit after we supersede/reject cycle
  // First supersede approved A so we can use instNo again for reject flow? Approved doesn't block pending unique.
  // Unique is only on pending — so we can create another pending for same inst only if no pending exists.
  // proof A is approved → can submit new pending for same installment.
  const subB = await submitInstallmentProof({
    phone: e.phone,
    enrollmentId: e.id,
    installmentNo: instNo,
    files: [up2.file],
    studentComment: "e2e reject then reupload",
  });
  if (!subB.ok) throw new Error(subB.error);
  const rej = await rejectInstallmentProof({
    proofId: subB.proof.id,
    actor: { id: "e2e", name: "e2e_system" },
    reason: "e2e: unclear screenshot — please re-upload",
  });
  if (!rej.ok) throw new Error(rej.error);

  const up3 = await uploadInstallmentProofFile({
    phone: e.phone,
    studentId: null,
    installmentNo: instNo,
    originalName: "e2e-reupload.png",
    buffer: PNG,
  });
  if (!up3.ok) throw new Error(up3.error);
  const reup = await submitInstallmentProof({
    phone: e.phone,
    enrollmentId: e.id,
    installmentNo: instNo,
    files: [up3.file],
    studentComment: "e2e reupload after reject",
  });
  if (!reup.ok) throw new Error(reup.error);

  // Supersede (simulates runPaidTerminalSideEffects hook — no payments write)
  const nSup = await supersedeProofsOnPaid({
    phone: e.phone,
    enrollmentId: e.id,
    installmentNo: instNo,
  });
  const afterSup = await listProofsForEnrollment(e.id);
  const pendingLeft = afterSup.filter((p) => p.status === "pending" && p.installment_no === instNo);

  // Cleanup: delete e2e proofs, restore prior override
  await db.from("installment_payment_proofs").delete().eq("course_enrollment_id", e.id).ilike("student_comment", "%e2e%");
  if (priorOvr) {
    await db.from("course_access_overrides").upsert({
      phone: priorOvr.phone,
      course_id: priorOvr.course_id,
      mode: priorOvr.mode,
      expires_at: priorOvr.expires_at,
      note: priorOvr.note,
      created_by: priorOvr.created_by,
      updated_at: new Date().toISOString(),
    }, { onConflict: "phone,course_id" });
  } else {
    await db.from("course_access_overrides").delete().eq("phone", e.phone).eq("course_id", e.course_id);
  }

  const report = {
    student: e.student_name,
    enrollmentId: e.id,
    in73: false,
    liveBefore: { allowed: liveBefore.allowed, status: liveBefore.status },
    liveAfterApprove: { allowed: liveAfter.allowed, status: liveAfter.status, grantUntil: ovrAfter?.expires_at },
    paymentsUnchanged:
      payBefore.count === payAfter.count &&
      payBefore.sum === payAfter.sum &&
      JSON.stringify(payBefore.statuses) === JSON.stringify(payAfter.statuses),
    payBefore,
    payAfter,
    timeline: (events || []).slice(0, 8),
    loosenOnly: {
      requestedShort: short,
      keptFar: ovrLoose?.expires_at,
      ok:
        loose.ok &&
        !!ovrLoose?.expires_at &&
        Date.parse(ovrLoose.expires_at) === Date.parse(far) &&
        Date.parse(loose.ok ? loose.expiresAt : "") === Date.parse(far),
      handlerExpiresAt: loose.ok ? loose.expiresAt : null,
    },
    rejectReupload: { rejected: rej.ok, reuploaded: reup.ok, reuploadStatus: reup.ok ? reup.proof.status : null },
    supersede: { marked: nSup, pendingLeft: pendingLeft.length },
    cleanedUp: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!liveAfter.allowed) process.exit(2);
  if (!report.paymentsUnchanged) process.exit(3);
  if (!report.loosenOnly.ok) process.exit(4);
  if (pendingLeft.length > 0) process.exit(5);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
