import { istYMD, istTodayYMD } from "./dates";
import { isPaidStatus as isPaid, itemKey, distinctRegistrations } from "./paymentsAgg";
import type { Payment } from "./types";

/** Timeframe presets shared by every registrations view. */
export type Frame = "7d" | "30d" | "month" | "year";

/**
 * Canonical paid webinar registration definition (digest ≡ alerts ≡ Overview ≡ detail).
 *
 * Counts ONLY when payment status is PAID/captured (real money in).
 * Explicitly excludes: INITIATED, PENDING, VERIFYING, FAILED, ABANDONED, REFUNDED,
 * refunded, cancelled, expired, soft-deleted, and non-webinar rows.
 * Distinct seats: one per (phone, webinar slug/item).
 */
export function isCountablePaidWebinarPayment(
  p: Pick<Payment, "status" | "item_type" | "deleted_at">,
): boolean {
  if (p.deleted_at) return false;
  if (p.item_type !== "webinar") return false;
  const st = String(p.status || "").toUpperCase();
  if (st === "REFUNDED" || st === "CANCELLED" || st === "EXPIRED" || st === "ABANDONED") return false;
  return isPaid(p.status);
}

/** Incomplete checkout — never counted as a registration. */
export function isPendingWebinarCheckout(
  p: Pick<Payment, "status" | "item_type" | "deleted_at">,
): boolean {
  if (p.deleted_at) return false;
  if (p.item_type !== "webinar") return false;
  const st = String(p.status || "").toUpperCase();
  return (
    st === "INITIATED" ||
    st === "PENDING" ||
    st === "VERIFYING" ||
    st === "PROCESSING" ||
    st === "ABANDONED" ||
    st === "FAILED" ||
    st === "CANCELLED" ||
    st === "EXPIRED"
  );
}

export function filterPaidWebinarForSlug(payments: readonly Payment[], slugOrKey: string): Payment[] {
  const key = (slugOrKey || "").trim().toLowerCase();
  if (!key) return [];
  return payments.filter((p) => isCountablePaidWebinarPayment(p) && itemKey(p) === key);
}

/** Distinct paid seats for one webinar — THE shared count. */
export function paidWebinarRegistrationCount(payments: readonly Payment[], slugOrKey: string): number {
  return distinctRegistrations(filterPaidWebinarForSlug(payments, slugOrKey));
}

/**
 * Distinct phones with an open checkout and no paid seat for the same webinar.
 * Shown separately so it can never be mistaken for a registration.
 */
export function pendingWebinarCheckoutCount(payments: readonly Payment[], slugOrKey: string): number {
  const key = (slugOrKey || "").trim().toLowerCase();
  if (!key) return 0;
  const paidPhones = new Set(
    filterPaidWebinarForSlug(payments, key)
      .map((p) => (p.phone || "").trim())
      .filter(Boolean),
  );
  const pending = new Set<string>();
  for (const p of payments) {
    if (!isPendingWebinarCheckout(p) || itemKey(p) !== key) continue;
    const phone = (p.phone || "").trim();
    if (!phone || paidPhones.has(phone)) continue;
    pending.add(phone);
  }
  return pending.size;
}

/** IST YMD for `daysAgo` days before today. */
export function ymdDaysAgo(daysAgo: number): string {
  return istYMD(new Date(Date.now() - daysAgo * 86400000)) || "";
}

/**
 * Canonical paid webinar filter for one IST calendar day.
 * Soft-deleted / refunded excluded via {@link isCountablePaidWebinarPayment}.
 */
export function filterPaidWebinarOnYmd(payments: readonly Payment[], ymd: string): Payment[] {
  if (!ymd) return [];
  return payments.filter((p) => isCountablePaidWebinarPayment(p) && istYMD(p.created_at) === ymd);
}

/** Distinct paid webinar seats for one IST day — Overview ↔ Payments must agree. */
export function paidWebinarRegsOnYmd(payments: readonly Payment[], ymd: string): number {
  return distinctRegistrations(filterPaidWebinarOnYmd(payments, ymd));
}

/** Today + yesterday paid webinar registration counts (IST) for KPI deltas. */
export function paidWebinarRegsTodayDelta(
  payments: readonly Payment[],
  todayYmd = istTodayYMD(),
): {
  today: number;
  yesterday: number;
  delta: number;
} {
  const yesterday = istYMD(new Date(Date.now() - 86400000)) || "";
  const today = paidWebinarRegsOnYmd(payments, todayYmd);
  const yest = paidWebinarRegsOnYmd(payments, yesterday);
  return { today, yesterday: yest, delta: today - yest };
}

/** Whether an IST YMD falls inside the given timeframe. */
export function inFrame(ymd: string, frame: Frame, month: string, year: number): boolean {
  if (frame === "7d") return ymd >= ymdDaysAgo(6);
  if (frame === "30d") return ymd >= ymdDaysAgo(29);
  if (frame === "month") return ymd.slice(0, 7) === month;
  return ymd.slice(0, 4) === String(year);
}

/** Predicate for the last-7-days window (the collapsed mini-card window). */
export function last7Pred(): (ymd: string) => boolean {
  const from = ymdDaysAgo(6);
  return (ymd) => ymd >= from;
}

/**
 * Paid webinar registrations bucketed by IST day, counted DISTINCT by
 * (phone, webinar) per day. `selected` scopes to one webinar (itemKey); "" = all.
 */
export function buildWebinarByDay(payments: Payment[], selected: string): Map<string, number> {
  const perDay = new Map<string, Set<string>>();
  for (const p of payments) {
    if (!isCountablePaidWebinarPayment(p)) continue;
    const key = itemKey(p);
    if (selected && key !== selected) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd) continue;
    let s = perDay.get(ymd);
    if (!s) {
      s = new Set();
      perDay.set(ymd, s);
    }
    s.add(`${(p.phone || "").trim()}|${key}`);
  }
  const map = new Map<string, number>();
  for (const [ymd, s] of perDay) map.set(ymd, s.size);
  return map;
}

export interface PaidWebinarOption {
  key: string;
  label: string;
  count: number;
}

export interface WebinarSplitRow {
  key: string;
  label: string;
  count: number;
}

export function webinarSplit(
  payments: Payment[],
  inSel: (ymd: string) => boolean,
): { rows: WebinarSplitRow[]; total: number } {
  const perWebinar = new Map<string, { label: string; set: Set<string> }>();
  for (const p of payments) {
    if (!isCountablePaidWebinarPayment(p)) continue;
    const key = itemKey(p);
    if (!key) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd || !inSel(ymd)) continue;
    let e = perWebinar.get(key);
    if (!e) {
      e = { label: p.item || key, set: new Set() };
      perWebinar.set(key, e);
    }
    if (p.item && (e.label === key || !e.label)) e.label = p.item;
    e.set.add(`${(p.phone || "").trim()}|${ymd}`);
  }
  const rows = [...perWebinar.entries()]
    .map(([key, e]) => ({ key, label: e.label, count: e.set.size }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return { rows, total };
}

export function listPaidWebinars(payments: Payment[]): PaidWebinarOption[] {
  const totals = new Map<string, PaidWebinarOption>();
  for (const p of payments) {
    if (!isCountablePaidWebinarPayment(p)) continue;
    const key = itemKey(p);
    if (!key) continue;
    const cur = totals.get(key) || { key, label: p.item || key, count: 0 };
    cur.count += 1;
    if (p.item && (cur.label === key || !cur.label)) cur.label = p.item;
    totals.set(key, cur);
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface WebinarMeta {
  slug: string;
  title?: string | null;
  datetime?: string | null;
}

/** Lifetime distinct paid registrations for one webinar (phone×item). */
export function webinarLifetimeDistinct(
  payments: Payment[],
  webinarKey: string,
): {
  key: string;
  label: string;
  count: number;
} | null {
  const key = webinarKey.trim().toLowerCase();
  if (!key) return null;
  const rows = filterPaidWebinarForSlug(payments, key);
  if (!rows.length) return null;
  let label = key;
  for (const p of rows) {
    if (p.item && (label === key || !label)) label = p.item;
  }
  return { key, label, count: distinctRegistrations(rows) };
}

export function latestPaidWebinar(
  payments: Payment[],
  webinars?: WebinarMeta[] | null,
): { key: string; label: string; count: number } | null {
  const paidKeys = new Set<string>();
  const latestPayAt = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const p of payments) {
    if (!isCountablePaidWebinarPayment(p)) continue;
    const key = itemKey(p);
    if (!key) continue;
    paidKeys.add(key);
    const t = new Date(p.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if ((latestPayAt.get(key) || 0) < t) latestPayAt.set(key, t);
    if (p.item) labels.set(key, p.item);
  }
  if (paidKeys.size === 0) return null;

  const dtBySlug = new Map<string, number>();
  const titleBySlug = new Map<string, string>();
  for (const w of webinars || []) {
    const slug = (w.slug || "").trim().toLowerCase();
    if (!slug) continue;
    if (w.title) titleBySlug.set(slug, w.title);
    if (w.datetime) {
      const t = new Date(w.datetime).getTime();
      if (Number.isFinite(t)) dtBySlug.set(slug, t);
    }
  }

  let bestKey = "";
  let bestScore = -Infinity;
  for (const key of paidKeys) {
    const score = dtBySlug.get(key) ?? latestPayAt.get(key) ?? 0;
    if (score > bestScore || (score === bestScore && key.localeCompare(bestKey) < 0)) {
      bestScore = score;
      bestKey = key;
    }
  }
  if (!bestKey) return null;
  const hit = webinarLifetimeDistinct(payments, bestKey);
  if (!hit) return null;
  const titled = titleBySlug.get(bestKey) || labels.get(bestKey);
  return titled ? { ...hit, label: titled } : hit;
}
