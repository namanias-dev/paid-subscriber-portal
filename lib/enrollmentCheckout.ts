import type { CourseBatch } from "./types";
import { batchModeLabel, batchModes, batchTimingLabel, batchTimings } from "./installments";

/**
 * Existing checkout default. There is no separate "preferred count" field.
 * `resolveEmiConfig` sorts `installment_counts`, and this helper picks the
 * second sorted value when two or more exist (configured [3, 6, 10] → 6).
 * A course that configures a single count uses that count. An empty list
 * falls back to 6, matching the historical EMI default.
 *
 * Technical debt: the position is implicit. Do not scatter `counts[1]`
 * through the UI — call this helper. A named admin default would replace it
 * without a migration only if it can be derived from data that already exists.
 */
export function defaultInstallmentCount(counts: number[]): number {
  if (!counts.length) return 6;
  return counts[Math.min(1, counts.length - 1)] || counts[0] || 6;
}

export type PublicPaymentMethod = "installments" | "full";

/**
 * The public checkout offers two journeys. Installments reserves the seat
 * when the course is configured for it. Pay in Full charges the discounted
 * full amount now (`bookSeat: false`).
 *
 * The planner can still build a seat plus one later full-payment balance.
 * Other callers may use that. This page does not.
 */
export function publicPaymentIntent(input: {
  method: PublicPaymentMethod;
  seatConfigured: boolean;
  allowCustomSeat: boolean;
  reservationAmount: number;
}): { plan: "emi" | "full"; bookSeat: boolean; seatAmount?: number } {
  if (input.method === "full") return { plan: "full", bookSeat: false };
  const intent: { plan: "emi" | "full"; bookSeat: boolean; seatAmount?: number } = {
    plan: "emi",
    bookSeat: input.seatConfigured,
  };
  if (input.seatConfigured && input.allowCustomSeat) intent.seatAmount = input.reservationAmount;
  return intent;
}

export interface BatchMatrix {
  kind: "matrix";
  modes: string[];
  timings: string[];
  /** `${mode}\0${timing}` → batch id. Pairs are unique. */
  pairToId: Map<string, string>;
}

export interface BatchList {
  kind: "list";
}

export type BatchSelectionModel = BatchMatrix | BatchList;

export function batchPairKey(mode: string, timing: string): string {
  return `${mode}\0${timing}`;
}

/**
 * Mode + timing segmented controls are safe only when every batch is exactly
 * one mode and one timing and no two batches share that pair. Anything else
 * (legacy multi-value batches, duplicates, missing axes) stays a compact list
 * of the real batch records so we never invent or merge offerings.
 */
export function analyzeBatches(batches: CourseBatch[]): BatchSelectionModel {
  if (batches.length < 2) return { kind: "list" };
  const pairToId = new Map<string, string>();
  const modes: string[] = [];
  const timings: string[] = [];
  for (const batch of batches) {
    const modesOf = batchModes(batch);
    const timingsOf = batchTimings(batch);
    if (modesOf.length !== 1 || timingsOf.length !== 1) return { kind: "list" };
    const mode = modesOf[0];
    const timing = timingsOf[0];
    const key = batchPairKey(mode, timing);
    if (pairToId.has(key)) return { kind: "list" };
    pairToId.set(key, batch.id);
    if (!modes.includes(mode)) modes.push(mode);
    if (!timings.includes(timing)) timings.push(timing);
  }
  if (!modes.length || !timings.length) return { kind: "list" };
  return { kind: "matrix", modes, timings, pairToId };
}

export function batchAxis(batch: CourseBatch): { mode: string; timing: string } | null {
  const modesOf = batchModes(batch);
  const timingsOf = batchTimings(batch);
  if (modesOf.length !== 1 || timingsOf.length !== 1) return null;
  return { mode: modesOf[0], timing: timingsOf[0] };
}

export function timingsForMode(model: BatchMatrix, mode: string): string[] {
  return model.timings.filter((timing) => model.pairToId.has(batchPairKey(mode, timing)));
}

/** Resolve a real batch id. If the timing is not offered for that mode, use the first timing that is. */
export function resolveBatchId(model: BatchMatrix, mode: string, timing: string): string | null {
  const direct = model.pairToId.get(batchPairKey(mode, timing));
  if (direct) return direct;
  const available = timingsForMode(model, mode);
  if (!available.length) return null;
  return model.pairToId.get(batchPairKey(mode, available[0])) ?? null;
}

export function batchChoiceLabel(batch: CourseBatch): string {
  const mode = batchModeLabel(batch);
  const timing = batchTimingLabel(batch);
  const pair = [mode, timing].filter(Boolean).join(" · ");
  return batch.label || pair || "Batch";
}

/**
 * Batch labels often restate mode, timing, and the start date already shown
 * in the selected-batch summary. Only surface the stored label when it adds
 * a detail those lines do not already cover.
 */
export function batchLabelAddsDetail(label: string | null | undefined, title: string, startLabel: string | null): boolean {
  const raw = (label || "").trim();
  if (!raw) return false;
  const known = new Set(
    [title, startLabel || "", ...title.split(/\s*[·•|/]\s*/)]
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  return raw
    .split(/\s*[·•|/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => !known.has(part.toLowerCase()));
}

/**
 * True when the browser sent an expected charge that does not match the
 * server-computed amount. A missing expected amount is not a conflict — older
 * clients omit it and keep the previous behaviour.
 */
export function checkoutAmountsDiffer(expected: unknown, authoritativeRupees: number): boolean {
  if (expected == null || expected === "") return false;
  const n = typeof expected === "number" ? expected : Number(String(expected));
  if (!Number.isFinite(n)) return true;
  return Math.round(n) !== Math.round(authoritativeRupees);
}

/**
 * Public create-payment plan guard. Pay in full never carries a seat amount.
 * Unknown plan names are rejected rather than charged as a full payment.
 */
export function normalizePublicPaymentRequest(body: {
  plan?: unknown;
  mode?: unknown;
  bookSeat?: unknown;
  seatAmount?: unknown;
}): { ok: true; plan: "full" | "emi"; bookSeat: boolean } | { ok: false; error: string } {
  const raw = String(body.plan || body.mode || "full");
  if (raw !== "full" && raw !== "emi") return { ok: false, error: "Invalid payment plan." };
  const requestedSeat = body.bookSeat === true || body.bookSeat === "true";
  const sentSeatAmount = body.seatAmount != null && String(body.seatAmount).trim() !== "";
  if (raw === "full" && (requestedSeat || sentSeatAmount)) {
    return { ok: false, error: "Seat amount does not apply to pay in full." };
  }
  return { ok: true, plan: raw, bookSeat: raw === "emi" && requestedSeat };
}

/**
 * A multi-batch course must name a real batch. A single-batch course may omit
 * the id (course-level pricing is that batch) but cannot name an unknown one.
 */
export function checkoutBatchError(
  batches: { id: string }[] | null | undefined,
  batchId: string | null,
): string | null {
  const list = batches || [];
  if (list.length >= 2) {
    if (!batchId || !list.some((b) => b.id === batchId)) return "Please choose a batch.";
    return null;
  }
  if (batchId && list.length > 0 && !list.some((b) => b.id === batchId)) return "Please choose a batch.";
  return null;
}

export interface EnrollmentPaymentBodyInput {
  courseSlug: string;
  name: string;
  email: string;
  mobile: string;
  plan: "full" | "emi";
  bookSeat: boolean;
  installmentCount?: number;
  seatAmount?: number;
  allowCustomSeat: boolean;
  multiBatch: boolean;
  batchId: string | null;
  couponCode?: string;
  gaClientId?: string | null;
  /**
   * The amount the page is showing as due today. The server recomputes and
   * refuses the charge when this disagrees. Coupon checkouts send it too,
   * after the coupon preview has been planned on the same selected total.
   */
  expectedAmount?: number;
}

/**
 * The create-payment JSON body. Undefined fields are dropped by JSON.stringify,
 * matching the previous checkout payload (no nulls for optional keys).
 */
export function buildEnrollmentPaymentBody(input: EnrollmentPaymentBodyInput): Record<string, unknown> {
  return {
    courseSlug: input.courseSlug,
    name: input.name.trim(),
    email: input.email.trim(),
    mobile: input.mobile,
    plan: input.plan,
    bookSeat: input.bookSeat,
    installmentCount: input.plan === "emi" ? input.installmentCount : undefined,
    seatAmount: input.bookSeat && input.allowCustomSeat ? input.seatAmount : undefined,
    batchId: input.multiBatch ? input.batchId : undefined,
    couponCode: input.couponCode || undefined,
    gaClientId: input.gaClientId || undefined,
    expectedAmount: input.expectedAmount,
  };
}
