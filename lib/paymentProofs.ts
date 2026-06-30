import { getSupabaseAdmin } from "./supabase";
import { recordPaymentPaid, recordStaffReview, recordProofUploaded } from "./analytics/server";
import {
  getPaymentById,
  getPaymentByReference,
  getPaymentsByPhone,
  paidCourseIdsForPhone,
  getAllCourses,
  getWebinars,
  getWebinarPaymentStatusMap,
  getWebinarRegistrationIdsByPhone,
  isPaidStatus,
  ensureBuyer,
  bumpBuyerSessionVersion,
  finalizeCoursePaymentByReference,
} from "./dataProvider";
import { formatISTDateTime } from "./dates";
import type {
  Payment,
  PaymentProof,
  PaymentProofFile,
  PaymentProofStatus,
  PaymentProofAudit,
} from "./types";

/**
 * ============================================================================
 *  SELF-SERVICE PAYMENT PROOF — recovery for PENDING / VERIFYING / FAILED
 *  payments where the student has NO access to the item yet.
 *
 *  HARD RULES enforced here:
 *   • Uploading proof NEVER grants access.
 *   • Access is granted ONLY on PAID — via the EXISTING side-effect path
 *     (ensureBuyer + finalizeCoursePaymentByReference), reused by acceptPayment.
 *   • Manual Accept is the ONLY way FAILED -> PAID. PAID is never downgraded;
 *     everything is idempotent.
 *   • Recovery is suppressed per-item the moment the student HAS access (any
 *     PAID payment / valid grant) — so retry-after-failure buyers are untouched.
 * ============================================================================
 */

export const PROOF_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const PROOF_MAX_FILES = 3;
export const PROOF_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file

/** Non-paid payment states eligible for the proof-recovery flow. */
const RECOVERABLE = new Set(["PENDING", "pending", "VERIFYING", "FAILED"]);
const PAID = new Set(["PAID", "captured"]);

function nowISO(): string {
  return new Date().toISOString();
}

function mapProof(row: Record<string, unknown>): PaymentProof {
  return {
    id: row.id as string,
    payment_id: row.payment_id as string,
    reference_no: (row.reference_no as string) ?? null,
    phone: (row.phone as string) ?? "",
    item_type: (row.item_type as string) ?? null,
    item_slug: (row.item_slug as string) ?? null,
    item: (row.item as string) ?? null,
    status: (row.status as PaymentProofStatus) ?? "submitted",
    files: Array.isArray(row.files) ? (row.files as PaymentProofFile[]) : [],
    student_note: (row.student_note as string) ?? null,
    admin_reason: (row.admin_reason as string) ?? null,
    audit: Array.isArray(row.audit) ? (row.audit as PaymentProofAudit[]) : [],
    created_at: (row.created_at as string) || nowISO(),
    updated_at: (row.updated_at as string) || nowISO(),
  };
}

// ----------------------------- Reads -----------------------------

export async function getProofByPaymentId(paymentId: string): Promise<PaymentProof | null> {
  const id = (paymentId || "").trim();
  if (!id) return null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("payment_proofs").select("*").eq("payment_id", id).maybeSingle();
  return data ? mapProof(data as Record<string, unknown>) : null;
}

export async function getAllProofs(): Promise<PaymentProof[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("payment_proofs").select("*").order("updated_at", { ascending: false });
  return ((data as Record<string, unknown>[]) ?? []).map(mapProof);
}

/** Map of payment_id -> proof (admin Payments tab badge/filter/detail). */
export async function getProofsByPaymentIds(paymentIds: string[]): Promise<Record<string, PaymentProof>> {
  const ids = [...new Set(paymentIds.map((s) => (s || "").trim()).filter(Boolean))];
  const out: Record<string, PaymentProof> = {};
  if (!ids.length) return out;
  const db = getSupabaseAdmin();
  if (!db) return out;
  const { data } = await db.from("payment_proofs").select("*").in("payment_id", ids);
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const p = mapProof(row);
    out[p.payment_id] = p;
  }
  return out;
}

// ----------------------------- Per-item access -----------------------------

/**
 * Does this phone CURRENTLY have access to the item (so recovery must be
 * suppressed)? Mirrors the live entitlement logic exactly.
 */
export async function phoneHasAccessToItem(
  phone: string,
  itemType: string | null | undefined,
  itemSlug: string | null | undefined,
): Promise<boolean> {
  const p = (phone || "").trim();
  const slug = (itemSlug || "").trim();
  if (!p) return false;

  if (itemType === "webinar") {
    if (slug) {
      // Access is strictly PER-EVENT: only a PAID for THIS exact slug counts.
      // A duplicated re-run is a separate event and never inherits access.
      const map = await getWebinarPaymentStatusMap(p);
      if (map.get(slug) === "PAID") return true;
      // Free webinar with a registration row counts as access.
      const [webinars, regs] = await Promise.all([getWebinars(), getWebinarRegistrationIdsByPhone(p)]);
      const w = webinars.find((x) => x.slug === slug);
      if (w && (w.price ?? 0) <= 0 && regs.has(w.id)) return true;
    }
    return false;
  }

  if (itemType === "course") {
    const [courses, paidCourseIds] = await Promise.all([getAllCourses(), paidCourseIdsForPhone(p)]);
    const c = courses.find((x) => x.slug === slug);
    if (c && paidCourseIds.includes(c.id)) return true;
    return false;
  }

  return false;
}

// ----------------------------- Recovery items (student) -----------------------------

export interface RecoveryItem {
  paymentId: string;
  referenceNo: string | null;
  item: string;
  /** Formatted webinar date/time (IST) for unambiguous attribution; null for courses. */
  itemWhen: string | null;
  itemType: string;
  itemSlug: string | null;
  paymentStatus: string;
  proofStatus: PaymentProofStatus | "none";
  adminReason: string | null;
  filesCount: number;
  studentNote: string | null;
  createdAt: string;
}

/**
 * Unresolved recovery items for a phone: webinars/courses the student has a
 * PENDING/VERIFYING/FAILED payment for AND currently LACKS access to. Evaluated
 * per item — any PAID payment or valid grant for the item suppresses it.
 */
export async function getRecoveryItemsForPhone(phone: string): Promise<RecoveryItem[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];

  const all = (await getPaymentsByPhone(p)).filter((x) => x.item_type === "webinar" || x.item_type === "course");
  if (!all.length) return [];

  // Group by the item the student tried to buy.
  const groups = new Map<string, Payment[]>();
  for (const pay of all) {
    const key = `${pay.item_type}::${(pay.item_slug || pay.item || "").trim()}`;
    (groups.get(key) || groups.set(key, []).get(key)!).push(pay);
  }

  // Precompute access context once.
  const [courses, webinars, paidCourseIds, webStatus, webRegs] = await Promise.all([
    getAllCourses(),
    getWebinars(),
    paidCourseIdsForPhone(p),
    getWebinarPaymentStatusMap(p),
    getWebinarRegistrationIdsByPhone(p),
  ]);
  const paidCourseIdSet = new Set(paidCourseIds);

  // Live name + date resolution (Problem 4 + correct attribution): prefer the
  // CURRENT webinar/course title so a rename propagates to the banner/popup, and
  // carry the webinar date so the prompt names the SPECIFIC event unambiguously.
  // A re-run/duplicate is a separate event — access and recovery are per-slug.
  const webinarBySlug = new Map(webinars.map((w) => [w.slug, w]));
  const courseTitleBySlug = new Map(courses.map((c) => [c.slug, c.title]));

  const items: RecoveryItem[] = [];
  for (const [, rows] of groups) {
    const sorted = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const sample = sorted[0];
    const itemType = sample.item_type;
    const slug = (sample.item_slug || "").trim() || null;

    // ---- suppress when access already exists (retry-after-failure buyers) ----
    let hasAccess = rows.some((r) => isPaidStatus(r.status));
    if (!hasAccess && itemType === "course") {
      const c = courses.find((x) => x.slug === slug);
      if (c && paidCourseIdSet.has(c.id)) hasAccess = true;
    }
    if (!hasAccess && itemType === "webinar" && slug) {
      // PER-EVENT: only a PAID for THIS exact slug suppresses the popup.
      if (webStatus.get(slug) === "PAID") hasAccess = true;
      const w = webinarBySlug.get(slug);
      if (!hasAccess && w && (w.price ?? 0) <= 0 && webRegs.has(w.id)) hasAccess = true;
    }
    if (hasAccess) continue;

    // Representative = latest payment in a recoverable (PENDING/VERIFYING/FAILED) state.
    const rep = sorted.find((r) => RECOVERABLE.has(r.status));
    if (!rep) continue;

    const proof = await getProofByPaymentId(rep.id);
    if (proof?.status === "accepted") continue; // resolved

    const webinar = itemType === "webinar" ? webinarBySlug.get(slug || "") : undefined;
    const currentName = (itemType === "webinar" ? webinar?.title : courseTitleBySlug.get(slug || "")) || null;
    const itemWhen = webinar?.datetime ? formatISTDateTime(webinar.datetime) : null;

    items.push({
      paymentId: rep.id,
      referenceNo: rep.reference_no ?? null,
      item: currentName || rep.item || (itemType === "webinar" ? "Webinar" : "Course"),
      itemWhen,
      itemType,
      itemSlug: slug,
      paymentStatus: rep.status,
      proofStatus: proof?.status ?? "none",
      adminReason: proof?.admin_reason ?? null,
      filesCount: proof?.files.length ?? 0,
      studentNote: proof?.student_note ?? null,
      createdAt: rep.created_at,
    });
  }

  return items;
}

// ----------------------------- Submit / re-upload (student) -----------------------------

export interface SubmitProofInput {
  paymentId: string;
  phone: string;
  files: PaymentProofFile[];
  note?: string | null;
}

export async function submitPaymentProof(
  input: SubmitProofInput,
): Promise<{ ok: boolean; error?: string; proof?: PaymentProof }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };

  const payment = await getPaymentById(input.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if ((payment.phone || "").trim() !== (input.phone || "").trim()) {
    return { ok: false, error: "This payment doesn't belong to your account." };
  }
  if (isPaidStatus(payment.status)) {
    return { ok: false, error: "This payment is already confirmed — no proof needed." };
  }

  const incoming = (input.files || []).filter((f) => f && f.key);
  if (!incoming.length) return { ok: false, error: "Please attach at least one screenshot or PDF." };

  const existing = await getProofByPaymentId(input.paymentId);
  const mergedFiles = [...(existing?.files ?? []), ...incoming].slice(0, PROOF_MAX_FILES);
  const audit: PaymentProofAudit[] = [
    ...(existing?.audit ?? []),
    { action: existing ? "resubmitted" : "submitted", by: "student", at: nowISO() },
  ];

  const patch = {
    payment_id: input.paymentId,
    reference_no: payment.reference_no ?? null,
    phone: (payment.phone || "").trim(),
    item_type: payment.item_type,
    item_slug: payment.item_slug ?? null,
    item: payment.item ?? null,
    status: "submitted" as PaymentProofStatus,
    files: mergedFiles,
    student_note: (input.note ?? existing?.student_note ?? null) || null,
    admin_reason: null, // resubmitting clears the prior reason
    audit,
    updated_at: nowISO(),
  };

  if (existing) {
    const { data, error } = await db.from("payment_proofs").update(patch).eq("id", existing.id).select().maybeSingle();
    if (error) return { ok: false, error: error.message };
    const proof = data ? mapProof(data as Record<string, unknown>) : undefined;
    if (proof) void recordProofUploaded(payment, proof.id).catch(() => {});
    return { ok: true, proof };
  }
  const { data, error } = await db.from("payment_proofs").insert(patch).select().maybeSingle();
  if (error) return { ok: false, error: error.message };
  const proof = data ? mapProof(data as Record<string, unknown>) : undefined;
  if (proof) void recordProofUploaded(payment, proof.id).catch(() => {});
  return { ok: true, proof };
}

// ----------------------------- Admin actions -----------------------------

async function appendAudit(proof: PaymentProof, entry: PaymentProofAudit): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("payment_proofs")
    .update({ audit: [...proof.audit, entry], updated_at: nowISO() })
    .eq("id", proof.id);
}

export async function adminRequestReupload(
  proofId: string,
  adminId: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const { data } = await db.from("payment_proofs").select("*").eq("id", proofId).maybeSingle();
  if (!data) return { ok: false, error: "Proof not found." };
  const proof = mapProof(data as Record<string, unknown>);
  await db
    .from("payment_proofs")
    .update({
      status: "reupload_requested",
      admin_reason: (reason || "").trim() || null,
      audit: [...proof.audit, { action: "reupload_requested", by: adminId, at: nowISO(), note: reason || null }],
      updated_at: nowISO(),
    })
    .eq("id", proofId);
  return { ok: true };
}

export async function adminRejectProof(
  proofId: string,
  adminId: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const { data } = await db.from("payment_proofs").select("*").eq("id", proofId).maybeSingle();
  if (!data) return { ok: false, error: "Proof not found." };
  const proof = mapProof(data as Record<string, unknown>);
  await db
    .from("payment_proofs")
    .update({
      status: "rejected",
      admin_reason: (reason || "").trim() || null,
      audit: [...proof.audit, { action: "rejected", by: adminId, at: nowISO(), note: reason || null }],
      updated_at: nowISO(),
    })
    .eq("id", proofId);
  const pay = await getPaymentById(proof.payment_id).catch(() => null);
  if (pay) void recordStaffReview(pay, "rejected", adminId, reason ?? null).catch(() => {});
  return { ok: true };
}

export async function adminAddProofNote(
  proofId: string,
  adminId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const { data } = await db.from("payment_proofs").select("*").eq("id", proofId).maybeSingle();
  if (!data) return { ok: false, error: "Proof not found." };
  const proof = mapProof(data as Record<string, unknown>);
  if (!note.trim()) return { ok: false, error: "Note is empty." };
  await appendAudit(proof, { action: "note", by: adminId, at: nowISO(), note: note.trim() });
  return { ok: true };
}

/**
 * Manual "Accept payment" — flips PENDING/VERIFYING/FAILED -> PAID and grants
 * access via the SAME side-effect path ICICI uses (ensureBuyer + course
 * finalize). Idempotent: a PAID row is left untouched; never double-grants.
 * This is the ONLY route from FAILED -> PAID.
 */
export async function acceptPaymentManually(
  opts: { paymentId?: string; referenceNo?: string; adminId: string; note?: string | null },
): Promise<{ ok: boolean; error?: string; alreadyPaid?: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };

  const payment = opts.paymentId
    ? await getPaymentById(opts.paymentId)
    : opts.referenceNo
      ? await getPaymentByReference(opts.referenceNo)
      : null;
  if (!payment) return { ok: false, error: "Payment not found." };

  const markProofAccepted = async () => {
    const proof = await getProofByPaymentId(payment.id);
    if (proof) {
      await db
        .from("payment_proofs")
        .update({
          status: "accepted",
          audit: [...proof.audit, { action: "accepted", by: opts.adminId, at: nowISO(), note: opts.note || null }],
          updated_at: nowISO(),
        })
        .eq("id", proof.id);
    }
  };

  // Idempotent: already paid -> ensure proof reflects it, no re-grant.
  if (isPaidStatus(payment.status)) {
    await markProofAccepted();
    return { ok: true, alreadyPaid: true };
  }

  // Flip to PAID, hard-guarding against ever touching a paid row.
  const { data: upd } = await db
    .from("payments")
    .update({ status: "PAID" })
    .eq("id", payment.id)
    .not("status", "in", `(${[...PAID].join(",")})`)
    .select("id,phone,student_name,reference_no,item_type")
    .maybeSingle();

  // Reuse the EXISTING PAID side-effect path (same as the ICICI verifier).
  const r = (upd as Pick<Payment, "phone" | "student_name" | "reference_no" | "item_type"> | null) || payment;
  await ensureBuyer(r.phone, r.student_name).catch(() => null);
  if (r.item_type === "course" && r.reference_no) {
    await finalizeCoursePaymentByReference(r.reference_no).catch(() => null);
  }
  // This buyer's access just changed — invalidate their sessions on all devices so
  // the new paid access shows up everywhere (not just where the admin clicked).
  await bumpBuyerSessionVersion(r.phone).catch(() => null);

  await markProofAccepted();
  // Analytics (best-effort, idempotent): the manual accept is a PAID milestone +
  // a staff decision. recordPaymentPaid dedupes against any later cron/callback.
  void recordPaymentPaid({ ...payment, status: "PAID" }, "staff").catch(() => {});
  void recordStaffReview(payment, "approved", opts.adminId, opts.note ?? null).catch(() => {});
  return { ok: true };
}
