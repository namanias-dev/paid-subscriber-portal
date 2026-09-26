import type { CourseBatch } from "./types";
import { batchModeLabel, batchModes, batchTimingLabel, batchTimings } from "./installments";

/**
 * Existing checkout default: the second configured count when two or more exist
 * (for [3, 6, 10] that is 6), otherwise the only count, otherwise 6.
 */
export function defaultInstallmentCount(counts: number[]): number {
  if (!counts.length) return 6;
  return counts[Math.min(1, counts.length - 1)] || counts[0] || 6;
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
  /** Omitted when a coupon is applied — coupon preview and server bases can differ by batch. */
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
    expectedAmount: input.couponCode ? undefined : input.expectedAmount,
  };
}
