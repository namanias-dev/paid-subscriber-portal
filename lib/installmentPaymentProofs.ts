/**
 * Installment payment proofs — CLAIMS only.
 * Never writes to `payments`. Approve → unified extendCourseAccess (7d provisional).
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "./supabase";
import {
  getCourseEnrollmentById,
  getCourseEnrollmentsByPhone,
  getAllCourses,
  getAccessOverridesByPhone,
  findStudentByPhone,
} from "./dataProvider";
import { lectureAccessForCourse } from "./entitlements";
import { nextUnpaidDatedLine, unpaidDatedLines } from "./accessAtRisk";
import { activeAccessGrant } from "./sms/accessReminderService";
import { istWholeDaysUntil } from "./sms/accessDays";
import { extendCourseAccess } from "./accessActions";
import { appendStudentAccessEvent } from "./studentAccessEvents";
import { putObject, signGetUrl, installmentProofKey, r2Configured, isInstallmentProofStudentId } from "./r2";
import {
  detectInstallmentProofMime,
  stripExifIfJpeg,
  extForMime,
  INSTALLMENT_PROOF_MAX_BYTES,
  INSTALLMENT_PROOF_MAX_FILES,
  INSTALLMENT_PROOF_RATE_LIMIT,
} from "./installmentProofMime";
import type {
  InstallmentProofFileMeta,
  InstallmentProofPromptProps,
  InstallmentProofStatus,
} from "./installmentProofTypes";

export type { InstallmentProofFileMeta, InstallmentProofPromptProps, InstallmentProofStatus };

const PROVISIONAL_DAYS = 7;
const PROVISIONAL_REASON = "payment proof approved — pending finance reconciliation";
const SIGNED_URL_TTL = 300; // 5 min

export interface InstallmentProofRow {
  id: string;
  student_id: string | null;
  phone: string;
  course_id: string;
  course_enrollment_id: string;
  installment_no: number;
  claimed_amount: number | null;
  claimed_paid_date: string | null;
  reference_utr: string | null;
  student_comment: string | null;
  files: InstallmentProofFileMeta[];
  status: InstallmentProofStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  provisional_grant_event_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): InstallmentProofRow {
  return {
    id: String(r.id),
    student_id: r.student_id ? String(r.student_id) : null,
    phone: String(r.phone),
    course_id: String(r.course_id),
    course_enrollment_id: String(r.course_enrollment_id),
    installment_no: Number(r.installment_no),
    claimed_amount: r.claimed_amount != null ? Number(r.claimed_amount) : null,
    claimed_paid_date: r.claimed_paid_date ? String(r.claimed_paid_date).slice(0, 10) : null,
    reference_utr: r.reference_utr ? String(r.reference_utr) : null,
    student_comment: r.student_comment ? String(r.student_comment) : null,
    files: Array.isArray(r.files) ? (r.files as InstallmentProofFileMeta[]) : [],
    status: String(r.status) as InstallmentProofStatus,
    submitted_at: String(r.submitted_at),
    reviewed_by: r.reviewed_by ? String(r.reviewed_by) : null,
    reviewed_at: r.reviewed_at ? String(r.reviewed_at) : null,
    review_reason: r.review_reason ? String(r.review_reason) : null,
    provisional_grant_event_id: r.provisional_grant_event_id ? String(r.provisional_grant_event_id) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function getPendingProofForEnrollment(
  enrollmentId: string,
  installmentNo: number,
): Promise<InstallmentProofRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("installment_payment_proofs")
    .select("*")
    .eq("course_enrollment_id", enrollmentId)
    .eq("installment_no", installmentNo)
    .eq("status", "pending")
    .maybeSingle();
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function listProofsForEnrollment(enrollmentId: string): Promise<InstallmentProofRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("installment_payment_proofs")
    .select("*")
    .eq("course_enrollment_id", enrollmentId)
    .order("submitted_at", { ascending: false });
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function listProofsForPhone(phone: string): Promise<InstallmentProofRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const digits = phone.replace(/\D/g, "").slice(-10);
  const { data } = await db
    .from("installment_payment_proofs")
    .select("*")
    .or(`phone.eq.${digits},phone.eq.91${digits}`)
    .order("submitted_at", { ascending: false })
    .limit(100);
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function listPendingProofs(limit = 200): Promise<InstallmentProofRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("installment_payment_proofs")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(limit);
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function getProofById(id: string): Promise<InstallmentProofRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("installment_payment_proofs").select("*").eq("id", id).maybeSingle();
  return data ? mapRow(data as Record<string, unknown>) : null;
}

async function countUploadsLast24h(phone: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const digits = phone.replace(/\D/g, "").slice(-10);
  const { count } = await db
    .from("installment_payment_proofs")
    .select("*", { count: "exact", head: true })
    .or(`phone.eq.${digits},phone.eq.91${digits}`)
    .gte("submitted_at", since);
  // Also count file appends via updated_at on pending — approximate with submitted + updates
  return count || 0;
}

/**
 * Build popup props from the REAL playback path.
 *
 * IMPORTANT: State B ("blocked") is keyed ONLY off lectureAccessForCourse with
 * the override applied (live playback). Schedule/collections risk is never used
 * here — a student who can watch lectures must never be told access is blocked.
 */
export async function buildInstallmentProofPrompt(
  phone: string,
): Promise<InstallmentProofPromptProps | null> {
  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const active = enrollments.filter((e) => e.status !== "cancelled" && (e.total_fee || 0) > 0);
  if (!active.length) return null;

  const [courses, overrides] = await Promise.all([
    getAllCourses(),
    getAccessOverridesByPhone(phone),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  type Cand = InstallmentProofPromptProps & { rank: number };
  const cands: Cand[] = [];

  for (const e of active) {
    const course = byCourse.get(e.course_id);
    const ovr = overrides.find((o) => o.course_id === e.course_id);
    // LIVE playback path — grant wins.
    const live = lectureAccessForCourse(course, e, ovr, false, now);
    const unpaidLines = unpaidDatedLines(e.schedule);
    const unpaid = unpaidLines[0] ?? nextUnpaidDatedLine(e.schedule);
    if (!unpaid || !(unpaid.amount > 0)) continue;
    const unpaidInstallments = unpaidLines.map((l) => ({
      no: l.no,
      amount: l.amount,
      due: l.due ? String(l.due).slice(0, 10) : null,
    }));

    const pending = await getPendingProofForEnrollment(e.id, unpaid.no);
    const grant = activeAccessGrant(ovr, now);
    const daysLeft =
      grant?.expires_at != null
        ? istWholeDaysUntil(grant.expires_at, now)
        : live.status === "grace"
          ? live.daysLeft ?? null
          : live.allowed
            ? null
            : null;

    const payHref = `/portal/course/${e.id}?installment=${unpaid.no}`;
    const pctPaid =
      e.total_fee > 0 ? Math.min(100, Math.max(0, Math.round(((e.amount_paid || 0) / e.total_fee) * 100))) : null;

    if (pending) {
      cands.push({
        rank: 0,
        state: "pending_review",
        enrollmentId: e.id,
        courseId: e.course_id,
        courseTitle: e.course_title || course?.title || "Course",
        installmentNo: unpaid.no,
        amountDue: unpaid.amount,
        dueDate: unpaid.due ? String(unpaid.due).slice(0, 10) : null,
        unpaidInstallments,
        daysLeft,
        liveAccessAllowed: live.allowed,
        payHref,
        pctPaid,
        pendingProof: {
          id: pending.id,
          submittedAt: pending.submitted_at,
          filesCount: pending.files.length,
          reviewReason: pending.review_reason,
        },
      });
      continue;
    }

    // Blocked ONLY when live playback is locked.
    if (!live.allowed) {
      cands.push({
        rank: 1,
        state: "blocked",
        enrollmentId: e.id,
        courseId: e.course_id,
        courseTitle: e.course_title || course?.title || "Course",
        installmentNo: unpaid.no,
        amountDue: unpaid.amount,
        dueDate: unpaid.due ? String(unpaid.due).slice(0, 10) : null,
        unpaidInstallments,
        daysLeft: null,
        liveAccessAllowed: false,
        payHref,
        pctPaid,
        pendingProof: null,
      });
      continue;
    }

    // Expiring: instalment due within 7d OR grant daysLeft within 7.
    const dueMs = unpaid.due ? Date.parse(String(unpaid.due)) : NaN;
    const daysToDue = Number.isFinite(dueMs) ? Math.ceil((dueMs - now) / 86_400_000) : null;
    const grantNear = daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
    const dueNear = daysToDue != null && daysToDue >= 0 && daysToDue <= 7;
    if (grantNear || dueNear) {
      cands.push({
        rank: 2,
        state: "expiring",
        enrollmentId: e.id,
        courseId: e.course_id,
        courseTitle: e.course_title || course?.title || "Course",
        installmentNo: unpaid.no,
        amountDue: unpaid.amount,
        dueDate: unpaid.due ? String(unpaid.due).slice(0, 10) : null,
        unpaidInstallments,
        daysLeft: daysLeft ?? daysToDue,
        liveAccessAllowed: true,
        payHref,
        pctPaid,
        pendingProof: null,
      });
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => a.rank - b.rank || b.amountDue - a.amountDue);
  const top = cands[0]!;
  // Safety assert: never emit blocked when live allowed.
  if (top.state === "blocked" && top.liveAccessAllowed) {
    top.state = "expiring";
  }
  const { rank: _r, ...props } = top;
  return props;
}

export async function uploadInstallmentProofFile(input: {
  phone: string;
  studentId: string | null;
  installmentNo: number;
  originalName: string;
  buffer: Buffer;
}): Promise<{ ok: true; file: InstallmentProofFileMeta } | { ok: false; error: string }> {
  if (!r2Configured()) return { ok: false, error: "Uploads temporarily unavailable." };
  if (input.buffer.length > INSTALLMENT_PROOF_MAX_BYTES) {
    return { ok: false, error: "Each file must be 10 MB or smaller." };
  }
  // Canonical storage path is installment-proofs/{students.id}/… — never phone.
  let studentId = (input.studentId || "").trim();
  if (!studentId) {
    const db = getSupabaseAdmin();
    const digits = input.phone.replace(/\D/g, "").slice(-10);
    if (db && digits) {
      const { data: stu } = await db.from("students").select("id").eq("phone", digits).maybeSingle();
      studentId = stu?.id ? String(stu.id) : "";
    }
  }
  if (!studentId) {
    return { ok: false, error: "Student record required before uploading proof." };
  }
  const mime = detectInstallmentProofMime(input.buffer);
  if (!mime) return { ok: false, error: "Only PDF, JPG, PNG, WEBP, or HEIC are accepted." };
  const cleaned = stripExifIfJpeg(input.buffer, mime);
  const fileId = randomUUID().slice(0, 12);
  let path: string;
  try {
    path = installmentProofKey(studentId, input.installmentNo, fileId, extForMime(mime));
  } catch {
    return { ok: false, error: "Student record required before uploading proof." };
  }
  await putObject(path, cleaned, mime);
  return {
    ok: true,
    file: {
      path,
      mime,
      size: cleaned.length,
      original_name: (input.originalName || "file").slice(0, 180),
    },
  };
}

export async function submitInstallmentProof(input: {
  phone: string;
  enrollmentId: string;
  installmentNo: number;
  files: InstallmentProofFileMeta[];
  claimedAmount?: number | null;
  claimedPaidDate?: string | null;
  referenceUtr?: string | null;
  studentComment?: string | null;
}): Promise<{ ok: true; proof: InstallmentProofRow } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };

  const e = await getCourseEnrollmentById(input.enrollmentId);
  if (!e || e.phone.replace(/\D/g, "").slice(-10) !== input.phone.replace(/\D/g, "").slice(-10)) {
    return { ok: false, error: "Enrollment not found." };
  }
  if (!input.files.length) return { ok: false, error: "Please attach at least one file." };
  if (input.files.length > INSTALLMENT_PROOF_MAX_FILES) {
    return { ok: false, error: `At most ${INSTALLMENT_PROOF_MAX_FILES} files.` };
  }

  const uploads24h = await countUploadsLast24h(input.phone);
  if (uploads24h >= INSTALLMENT_PROOF_RATE_LIMIT) {
    return { ok: false, error: "Upload limit reached for today. Try again tomorrow." };
  }

  const student = await findStudentByPhone(input.phone);
  const comment = input.studentComment?.trim() ? input.studentComment.trim().slice(0, 500) : null;
  const existing = await getPendingProofForEnrollment(input.enrollmentId, input.installmentNo);
  const scheduleLine = (e.schedule || []).find((s) => s.no === input.installmentNo) || null;
  const expectedAmount = scheduleLine?.amount ?? null;

  if (existing) {
    const merged = [...existing.files, ...input.files].slice(0, INSTALLMENT_PROOF_MAX_FILES);
    const { data, error } = await db
      .from("installment_payment_proofs")
      .update({
        files: merged,
        claimed_amount: input.claimedAmount ?? existing.claimed_amount,
        claimed_paid_date: input.claimedPaidDate ?? existing.claimed_paid_date,
        reference_utr: input.referenceUtr ?? existing.reference_utr,
        student_comment: comment ?? existing.student_comment,
        expected_amount: expectedAmount,
        expected_installment_no: input.installmentNo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message || "Could not update proof." };
    const proof = mapRow(data as Record<string, unknown>);
    await appendStudentAccessEvent({
      studentId: student?.id ?? null,
      phone: e.phone,
      courseId: e.course_id,
      courseEnrollmentId: e.id,
      eventType: "proof_uploaded",
      actor: "student",
      channel: "installment_proof",
      installmentNo: input.installmentNo,
      amount: input.claimedAmount ?? null,
      reason: `Added files (${input.files.length}); total ${merged.length}`,
      meta: { proofId: proof.id, filesCount: merged.length },
    });
    void import("./telegram/sales")
      .then((m) =>
        m.fireSalesAlert(async () => {
          await m.salesAlertInstallmentProof({
            name: e.student_name || "Student",
            phone: e.phone,
            installmentNo: input.installmentNo,
            amount: input.claimedAmount ?? expectedAmount,
            studentId: student?.id ?? null,
            enrollmentId: e.id,
            proofId: proof.id,
          });
        }),
      )
      .catch(() => {});
    return { ok: true, proof };
  }

  const { data, error } = await db
    .from("installment_payment_proofs")
    .insert({
      student_id: student?.id ?? null,
      phone: e.phone.replace(/\D/g, "").slice(-10),
      course_id: e.course_id,
      course_enrollment_id: e.id,
      installment_no: input.installmentNo,
      claimed_amount: input.claimedAmount ?? null,
      claimed_paid_date: input.claimedPaidDate || null,
      reference_utr: input.referenceUtr?.trim() || null,
      student_comment: comment,
      expected_amount: expectedAmount,
      expected_installment_no: input.installmentNo,
      files: input.files,
      status: "pending",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    if (error?.message?.includes("installment_payment_proofs_one_pending")) {
      return { ok: false, error: "A proof is already pending for this instalment." };
    }
    return { ok: false, error: error?.message || "Could not save proof." };
  }
  const proof = mapRow(data as Record<string, unknown>);
  await appendStudentAccessEvent({
    studentId: student?.id ?? null,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "proof_uploaded",
    actor: "student",
    channel: "installment_proof",
    installmentNo: input.installmentNo,
    amount: input.claimedAmount ?? null,
    reason: `Proof uploaded (${input.files.length} file${input.files.length === 1 ? "" : "s"})`,
    meta: { proofId: proof.id, filesCount: input.files.length },
  });
  void import("./telegram/sales")
    .then((m) =>
      m.fireSalesAlert(async () => {
        await m.salesAlertInstallmentProof({
          name: e.student_name || "Student",
          phone: e.phone,
          installmentNo: input.installmentNo,
          amount: input.claimedAmount ?? expectedAmount,
          studentId: student?.id ?? null,
          enrollmentId: e.id,
          proofId: proof.id,
        });
      }),
    )
    .catch(() => {});
  return { ok: true, proof };
}

export async function approveInstallmentProof(input: {
  proofId: string;
  actor: { id: string | null; name: string };
}): Promise<{ ok: true; proof: InstallmentProofRow } | { ok: false; error: string }> {
  const proof = await getProofById(input.proofId);
  if (!proof) return { ok: false, error: "Proof not found." };
  if (proof.status !== "pending") return { ok: false, error: "Proof is not pending." };

  const e = await getCourseEnrollmentById(proof.course_enrollment_id);
  if (!e) return { ok: false, error: "Enrollment not found." };

  const expiresAt = new Date(Date.now() + PROVISIONAL_DAYS * 86_400_000).toISOString();
  // Unified extend handler — NEVER touches payments.
  const grant = await extendCourseAccess({
    phone: e.phone,
    courseId: e.course_id,
    expiresAt,
    reason: PROVISIONAL_REASON,
    actor: input.actor,
    enrollmentId: e.id,
  });
  if (!grant.ok) return { ok: false, error: grant.error };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };

  const eventId = `proof_approve:${proof.id}:${Date.now()}`;
  const { data, error } = await db
    .from("installment_payment_proofs")
    .update({
      status: "approved",
      reviewed_by: input.actor.name || input.actor.id || "admin",
      reviewed_at: new Date().toISOString(),
      review_reason: PROVISIONAL_REASON,
      provisional_grant_event_id: eventId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proof.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Could not approve." };

  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "proof_approved",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason: PROVISIONAL_REASON,
    relatedEventId: eventId,
    meta: { proofId: proof.id, provisionalDays: PROVISIONAL_DAYS },
  });
  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "provisional_access_granted",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason: PROVISIONAL_REASON,
    relatedEventId: eventId,
    meta: { proofId: proof.id, days: PROVISIONAL_DAYS, expiresAt },
  });

  return { ok: true, proof: mapRow(data as Record<string, unknown>) };
}

export async function rejectInstallmentProof(input: {
  proofId: string;
  actor: { id: string | null; name: string };
  reason: string;
}): Promise<{ ok: true; proof: InstallmentProofRow } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Rejection reason is required." };
  const proof = await getProofById(input.proofId);
  if (!proof) return { ok: false, error: "Proof not found." };
  if (proof.status !== "pending") return { ok: false, error: "Proof is not pending." };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };
  const { data, error } = await db
    .from("installment_payment_proofs")
    .update({
      status: "rejected",
      reviewed_by: input.actor.name || input.actor.id || "admin",
      reviewed_at: new Date().toISOString(),
      review_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", proof.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Could not reject." };

  const e = await getCourseEnrollmentById(proof.course_enrollment_id);
  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: proof.phone,
    courseId: proof.course_id,
    courseEnrollmentId: proof.course_enrollment_id,
    eventType: "proof_rejected",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason,
    meta: { proofId: proof.id },
  });
  void e;
  return { ok: true, proof: mapRow(data as Record<string, unknown>) };
}

/** When real payment lands — mark pending/approved proofs superseded. Additive only. */
export async function supersedeProofsOnPaid(input: {
  phone: string;
  enrollmentId?: string | null;
  installmentNo?: number | null;
}): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const digits = input.phone.replace(/\D/g, "").slice(-10);
  let q = db
    .from("installment_payment_proofs")
    .update({
      status: "superseded",
      updated_at: new Date().toISOString(),
      review_reason: "Superseded by confirmed payment",
    })
    .or(`phone.eq.${digits},phone.eq.91${digits}`)
    .in("status", ["pending", "approved"]);
  if (input.enrollmentId) q = q.eq("course_enrollment_id", input.enrollmentId);
  if (input.installmentNo != null) q = q.eq("installment_no", input.installmentNo);
  const { data } = await q.select("id,course_enrollment_id,course_id,installment_no,student_id");
  const rows = data || [];
  for (const r of rows) {
    await appendStudentAccessEvent({
      studentId: r.student_id ? String(r.student_id) : null,
      phone: input.phone,
      courseId: r.course_id ? String(r.course_id) : null,
      courseEnrollmentId: r.course_enrollment_id ? String(r.course_enrollment_id) : null,
      eventType: "proof_superseded",
      actor: "system",
      channel: "installment_proof",
      installmentNo: r.installment_no != null ? Number(r.installment_no) : null,
      reason: "Superseded by confirmed payment",
      meta: { proofId: r.id },
    });
  }
  return rows.length;
}

export async function signedProofFileUrl(path: string): Promise<string | null> {
  if (!path.startsWith("installment-proofs/")) return null;
  // Reject legacy phone-shaped prefixes; canonical is installment-proofs/{students.id}/…
  const segment = path.slice("installment-proofs/".length).split("/")[0] || "";
  if (!isInstallmentProofStudentId(segment)) return null;
  if (!r2Configured()) return null;
  return signGetUrl(path, SIGNED_URL_TTL);
}

export { PROVISIONAL_DAYS, PROVISIONAL_REASON, INSTALLMENT_PROOF_MAX_FILES, INSTALLMENT_PROOF_MAX_BYTES };
