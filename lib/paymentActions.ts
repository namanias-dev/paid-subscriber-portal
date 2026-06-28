import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "./supabase";
import {
  getPaymentById,
  getPaymentByReference,
  isPaidStatus,
  getCourseEnrollmentById,
  updateCourseEnrollment,
  updatePaymentByReference,
  getReceiptByReference,
  bumpBuyerSessionVersion,
} from "./dataProvider";
import { deriveEnrollment, enrollmentStatusFromSchedule } from "./installments";
import {
  getProofByPaymentId,
  acceptPaymentManually,
  PROOF_ALLOWED_TYPES,
  PROOF_MAX_FILES,
  PROOF_MAX_BYTES,
} from "./paymentProofs";
import type {
  Payment,
  PaymentActionLog,
  PaymentActionType,
  PaymentProof,
  PaymentProofAudit,
  PaymentProofFile,
  StaffAccountabilityRow,
} from "./types";

/**
 * ============================================================================
 *  PAYMENT ACTION LEDGER — staff proof upload + approval, super-admin reversal,
 *  accountability and per-payment lifecycle history.
 *
 *  Design rules (mirrors the rest of the codebase):
 *   • Append-only: we only INSERT into payment_action_log, never UPDATE/DELETE.
 *   • Approving reuses the EXISTING PAID side-effect path (acceptPaymentManually
 *     -> ensureBuyer + finalizeCoursePaymentByReference + session bump), so a
 *     staff approval is identical to an ICICI/cron verification. Idempotent.
 *   • Reversal is the careful inverse: revert payment status, un-mark the schedule
 *     line(s) this payment settled, drop the (now-invalid) receipt, and bump the
 *     buyer session so access re-evaluates. The payment row and proof files are
 *     NEVER deleted. Login code / buyer is preserved (never stranded).
 *   • Storage reuses the existing private R2 payment-proofs bucket.
 * ============================================================================
 */

export interface ActionActor {
  id: string;
  name: string | null;
  role: string | null;
  isSuper: boolean;
}

function nowISO(): string {
  return new Date().toISOString();
}

function mapLog(row: Record<string, unknown>): PaymentActionLog {
  return {
    id: row.id as string,
    action: row.action as PaymentActionType,
    payment_id: (row.payment_id as string) ?? null,
    reference_no: (row.reference_no as string) ?? null,
    enrollment_id: (row.enrollment_id as string) ?? null,
    student_id: (row.student_id as string) ?? null,
    phone: (row.phone as string) ?? null,
    actor_id: (row.actor_id as string) ?? null,
    actor_name: (row.actor_name as string) ?? null,
    actor_role: (row.actor_role as string) ?? null,
    actor_is_super: row.actor_is_super === true,
    old_status: (row.old_status as string) ?? null,
    new_status: (row.new_status as string) ?? null,
    reason: (row.reason as string) ?? null,
    files: Array.isArray(row.files) ? (row.files as PaymentProofFile[]) : [],
    file_count: typeof row.file_count === "number" ? (row.file_count as number) : 0,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: (row.created_at as string) || nowISO(),
  };
}

interface LogInput {
  action: PaymentActionType;
  payment: Pick<Payment, "id" | "reference_no" | "enrollment_id" | "phone"> | null;
  actor: ActionActor;
  oldStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  files?: PaymentProofFile[];
  metadata?: Record<string, unknown>;
}

/** Append one immutable row to the action ledger (best-effort; never throws). */
export async function logPaymentAction(input: LogInput): Promise<PaymentActionLog | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  let studentId: string | null = null;
  if (input.payment?.phone) {
    try {
      const { data } = await db.from("students").select("id").eq("phone", input.payment.phone.trim()).limit(1);
      studentId = ((data as { id: string }[]) ?? [])[0]?.id ?? null;
    } catch {
      studentId = null;
    }
  }
  const row = {
    id: randomUUID(),
    action: input.action,
    payment_id: input.payment?.id ?? null,
    reference_no: input.payment?.reference_no ?? null,
    enrollment_id: input.payment?.enrollment_id ?? null,
    student_id: studentId,
    phone: input.payment?.phone ?? null,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    actor_role: input.actor.role,
    actor_is_super: input.actor.isSuper,
    old_status: input.oldStatus ?? null,
    new_status: input.newStatus ?? null,
    reason: (input.reason || "").trim() || null,
    files: input.files ?? [],
    file_count: input.files?.length ?? 0,
    metadata: input.metadata ?? {},
    created_at: nowISO(),
  };
  try {
    const { data, error } = await db.from("payment_action_log").insert(row).select().maybeSingle();
    if (error) return null;
    return data ? mapLog(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ----------------------------- File validation -----------------------------

export function validateProofFiles(files: PaymentProofFile[]): string | null {
  const valid = (files || []).filter((f) => f && f.key);
  if (!valid.length) return "Attach at least one screenshot or PDF.";
  if (valid.length > PROOF_MAX_FILES) return `Up to ${PROOF_MAX_FILES} files only.`;
  for (const f of valid) {
    if (!PROOF_ALLOWED_TYPES.includes(f.content_type)) return "Only images and PDF are allowed.";
    if ((f.size || 0) > PROOF_MAX_BYTES) return "Each file must be 8 MB or smaller.";
  }
  return null;
}

// ----------------------------- Staff proof upload -----------------------------

/**
 * Staff/admin uploads payment proof on a student's behalf (e.g. screenshot the
 * student sent over WhatsApp). Writes into the SAME payment_proofs row the student
 * flow uses (merges files), and records an immutable ledger entry attributing the
 * upload to the staff member. Uploading proof NEVER grants access.
 */
export async function staffUploadProof(input: {
  paymentId: string;
  files: PaymentProofFile[];
  note?: string | null;
  actor: ActionActor;
}): Promise<{ ok: boolean; error?: string; proof?: PaymentProof }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };

  const fileError = validateProofFiles(input.files);
  if (fileError) return { ok: false, error: fileError };

  const payment = await getPaymentById(input.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (isPaidStatus(payment.status)) {
    return { ok: false, error: "This payment is already confirmed — no proof needed." };
  }

  const incoming = (input.files || []).filter((f) => f && f.key);
  const existing = await getProofByPaymentId(input.paymentId);
  const mergedFiles = [...(existing?.files ?? []), ...incoming].slice(0, PROOF_MAX_FILES);
  const auditEntry: PaymentProofAudit = {
    action: "staff_uploaded",
    by: input.actor.id,
    at: nowISO(),
    note: (input.note || "").trim() || null,
  };
  const audit: PaymentProofAudit[] = [...(existing?.audit ?? []), auditEntry];

  const patch = {
    payment_id: input.paymentId,
    reference_no: payment.reference_no ?? null,
    phone: (payment.phone || "").trim(),
    item_type: payment.item_type,
    item_slug: payment.item_slug ?? null,
    item: payment.item ?? null,
    status: "submitted" as const,
    files: mergedFiles,
    student_note: input.note?.trim() || existing?.student_note || null,
    admin_reason: null,
    audit,
    updated_at: nowISO(),
  };

  let proof: PaymentProof | undefined;
  if (existing) {
    const { data, error } = await db
      .from("payment_proofs")
      .update(patch)
      .eq("id", existing.id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    proof = data ? mapProofLite(data as Record<string, unknown>) : undefined;
  } else {
    const { data, error } = await db.from("payment_proofs").insert(patch).select().maybeSingle();
    if (error) return { ok: false, error: error.message };
    proof = data ? mapProofLite(data as Record<string, unknown>) : undefined;
  }

  await logPaymentAction({
    action: "proof_upload",
    payment,
    actor: input.actor,
    oldStatus: payment.status,
    newStatus: payment.status,
    reason: input.note ?? null,
    files: incoming,
    metadata: { item: payment.item, item_type: payment.item_type },
  });

  return { ok: true, proof };
}

function mapProofLite(row: Record<string, unknown>): PaymentProof {
  return {
    id: row.id as string,
    payment_id: row.payment_id as string,
    reference_no: (row.reference_no as string) ?? null,
    phone: (row.phone as string) ?? "",
    item_type: (row.item_type as string) ?? null,
    item_slug: (row.item_slug as string) ?? null,
    item: (row.item as string) ?? null,
    status: (row.status as PaymentProof["status"]) ?? "submitted",
    files: Array.isArray(row.files) ? (row.files as PaymentProofFile[]) : [],
    student_note: (row.student_note as string) ?? null,
    admin_reason: (row.admin_reason as string) ?? null,
    audit: Array.isArray(row.audit) ? (row.audit as PaymentProofAudit[]) : [],
    created_at: (row.created_at as string) || nowISO(),
    updated_at: (row.updated_at as string) || nowISO(),
  };
}

// ----------------------------- Approve (staff) -----------------------------

/**
 * Approve a payment (staff). Captures the prior status, then runs the SAME PAID
 * side-effect path ICICI/cron uses (acceptPaymentManually). Idempotent — already
 * paid is a no-op grant. Logs an immutable "approve" ledger entry.
 */
export async function approvePaymentAction(input: {
  paymentId?: string;
  referenceNo?: string;
  note?: string | null;
  actor: ActionActor;
}): Promise<{ ok: boolean; error?: string; alreadyPaid?: boolean }> {
  const payment = input.paymentId
    ? await getPaymentById(input.paymentId)
    : input.referenceNo
      ? await getPaymentByReference(input.referenceNo)
      : null;
  if (!payment) return { ok: false, error: "Payment not found." };

  const oldStatus = payment.status;
  const r = await acceptPaymentManually({
    paymentId: payment.id,
    referenceNo: payment.reference_no ?? undefined,
    adminId: input.actor.id,
    note: input.note ?? null,
  });
  if (!r.ok) return r;

  await logPaymentAction({
    action: "approve",
    payment,
    actor: input.actor,
    oldStatus,
    newStatus: "PAID",
    reason: input.note ?? null,
    metadata: { alreadyPaid: !!r.alreadyPaid, item: payment.item, item_type: payment.item_type },
  });
  return r;
}

// ----------------------------- Reverse (super-admin) -----------------------------

/** Prior (pre-approval) status for a payment, from the latest approve ledger row. */
async function priorStatusFor(paymentId: string): Promise<Payment["status"]> {
  const db = getSupabaseAdmin();
  if (!db) return "VERIFYING";
  const { data } = await db
    .from("payment_action_log")
    .select("old_status")
    .eq("payment_id", paymentId)
    .eq("action", "approve")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prior = (data as { old_status?: string | null } | null)?.old_status;
  // Never revert to another PAID-ish state; default to a non-terminal recoverable one.
  if (!prior || isPaidStatus(prior)) return "VERIFYING";
  return prior as Payment["status"];
}

/**
 * Reverse a previously-approved payment (SUPER ADMIN ONLY — enforced at the route).
 * Safely undoes the approval's downstream effects:
 *   • payment.status -> prior non-paid status (never deletes the payment row)
 *   • course: un-marks the schedule line(s) this reference settled, recomputes
 *     amount_paid + status, and drops the now-invalid receipt (logged in metadata
 *     so the receipt no. is preserved in the audit trail). This re-locks access
 *     exactly per the existing entitlement rules.
 *   • bumps the buyer session so every device re-evaluates access. The buyer row /
 *     login code is preserved (never stranded).
 *   • the proof (if any) is set back to "submitted" so it can be re-reviewed.
 * Requires a reason. Append-only ledger entry records the full transition.
 */
export async function reversePaymentAction(input: {
  paymentId: string;
  reason: string;
  actor: ActionActor;
}): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };

  const reason = (input.reason || "").trim();
  if (!reason) return { ok: false, error: "A reason is required to reverse an approval." };

  const payment = await getPaymentById(input.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!isPaidStatus(payment.status)) {
    return { ok: false, error: "Only a PAID payment can be reversed." };
  }

  const prior = await priorStatusFor(payment.id);
  const metadata: Record<string, unknown> = { item: payment.item, item_type: payment.item_type };

  // ---- Course: undo schedule settlement + drop the receipt for this reference ----
  if (payment.item_type === "course" && payment.enrollment_id && payment.reference_no) {
    const enrollment = await getCourseEnrollmentById(payment.enrollment_id);
    if (enrollment) {
      const schedule = (enrollment.schedule || []).map((s) =>
        s.reference_no === payment.reference_no
          ? { ...s, paid: false, paid_at: null, reference_no: null, gateway_ref: null, payment_id: null, status: undefined }
          : s,
      );
      const revertedLines = (enrollment.schedule || []).filter((s) => s.reference_no === payment.reference_no).length;
      const derived = deriveEnrollment({ total_fee: enrollment.total_fee, schedule });
      const status = enrollmentStatusFromSchedule({ total_fee: enrollment.total_fee, schedule, plan_type: enrollment.plan_type });
      await updateCourseEnrollment(enrollment.id, { schedule, amount_paid: derived.paid, status }).catch(() => null);
      metadata.reverted_schedule_lines = revertedLines;
      metadata.enrollment_status_after = status;

      // Drop the now-invalid receipt so the ledger stays consistent AND a future
      // re-approval can re-finalize (finalize is idempotent on receipt-by-reference).
      const receipt = await getReceiptByReference(payment.reference_no).catch(() => null);
      if (receipt) {
        try {
          await db.from("payment_receipts").delete().eq("id", receipt.id);
        } catch {
          /* best-effort */
        }
        metadata.deleted_receipt_no = receipt.receipt_no;
      }
    }
  }

  // ---- Revert the payment status (never delete the payment row) ----
  await updatePaymentByReference(payment.reference_no || "", { status: prior, receipt_no: null }).catch(() => null);
  // updatePaymentByReference only handles rows with a reference_no; offline/edge
  // rows are reverted directly by id as a fallback.
  if (!payment.reference_no) {
    try {
      await db.from("payments").update({ status: prior, receipt_no: null }).eq("id", payment.id);
    } catch {
      /* best-effort */
    }
  }

  // ---- Re-lock access everywhere; keep the buyer / login code intact ----
  if (payment.phone) await bumpBuyerSessionVersion(payment.phone).catch(() => null);

  // ---- Re-open the proof for review (preserve files + history) ----
  const proof = await getProofByPaymentId(payment.id).catch(() => null);
  if (proof && proof.status === "accepted") {
    try {
      await db
        .from("payment_proofs")
        .update({
          status: "submitted",
          audit: [...proof.audit, { action: "reversed", by: input.actor.id, at: nowISO(), note: reason }],
          updated_at: nowISO(),
        })
        .eq("id", proof.id);
    } catch {
      /* best-effort */
    }
  }

  await logPaymentAction({
    action: "reverse",
    payment,
    actor: input.actor,
    oldStatus: payment.status,
    newStatus: prior,
    reason,
    metadata,
  });

  return { ok: true };
}

// ----------------------------- Reads (super-admin) -----------------------------

/** Full lifecycle history for one payment (oldest first). */
export async function getPaymentActionHistory(paymentId: string): Promise<PaymentActionLog[]> {
  const id = (paymentId || "").trim();
  if (!id) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("payment_action_log")
    .select("*")
    .eq("payment_id", id)
    .order("created_at", { ascending: true });
  return ((data as Record<string, unknown>[]) ?? []).map(mapLog);
}

/** Map of payment_id -> latest action (for Payments-tab badges). */
export async function getLatestActionByPayment(paymentIds: string[]): Promise<Record<string, PaymentActionLog>> {
  const ids = [...new Set(paymentIds.map((s) => (s || "").trim()).filter(Boolean))];
  const out: Record<string, PaymentActionLog> = {};
  if (!ids.length) return out;
  const db = getSupabaseAdmin();
  if (!db) return out;
  const { data } = await db
    .from("payment_action_log")
    .select("*")
    .in("payment_id", ids)
    .order("created_at", { ascending: true });
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const log = mapLog(row);
    if (log.payment_id) out[log.payment_id] = log; // ascending => last write wins = latest
  }
  return out;
}

export interface AccountabilityReport {
  rows: StaffAccountabilityRow[];
  recent: PaymentActionLog[];
  totals: { uploads: number; approvals: number; reversals: number; rejections: number };
}

/** Per-staff accountability rollup + recent activity (SUPER ADMIN ONLY at route). */
export async function getStaffAccountability(limit = 2000): Promise<AccountabilityReport> {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], recent: [], totals: { uploads: 0, approvals: 0, reversals: 0, rejections: 0 } };

  const { data } = await db
    .from("payment_action_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  const logs = ((data as Record<string, unknown>[]) ?? []).map(mapLog);

  const byActor = new Map<string, StaffAccountabilityRow>();
  const totals = { uploads: 0, approvals: 0, reversals: 0, rejections: 0 };
  for (const l of logs) {
    const key = l.actor_id || "unknown";
    const row =
      byActor.get(key) ||
      byActor.set(key, {
        actor_id: key,
        actor_name: l.actor_name,
        actor_role: l.actor_role,
        uploads: 0,
        approvals: 0,
        reversals: 0,
        rejections: 0,
        last_action_at: null,
      }).get(key)!;
    if (!row.last_action_at || l.created_at > row.last_action_at) row.last_action_at = l.created_at;
    if (!row.actor_name && l.actor_name) row.actor_name = l.actor_name;
    if (!row.actor_role && l.actor_role) row.actor_role = l.actor_role;
    if (l.action === "proof_upload") { row.uploads += 1; totals.uploads += 1; }
    else if (l.action === "approve") { row.approvals += 1; totals.approvals += 1; }
    else if (l.action === "reverse") { row.reversals += 1; totals.reversals += 1; }
    else if (l.action === "reject") { row.rejections += 1; totals.rejections += 1; }
  }

  const rows = [...byActor.values()].sort(
    (a, b) => b.uploads + b.approvals - (a.uploads + a.approvals),
  );
  return { rows, recent: logs.slice(0, 100), totals };
}
