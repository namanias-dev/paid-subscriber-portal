import { istYMD } from "./dates";
import { isPaidStatus as isPaid, itemKey } from "./paymentsAgg";
import type { Payment } from "./types";

/**
 * Paid webinar registrations bucketed by IST day, counted DISTINCT by
 * (phone, webinar) per day — the SAME methodology as the live registrations
 * cards. `selected` scopes to one webinar (itemKey); "" = all webinars.
 * Pure/read-only.
 */
export function buildWebinarByDay(payments: Payment[], selected: string): Map<string, number> {
  const perDay = new Map<string, Set<string>>();
  for (const p of payments) {
    if (!isPaid(p.status) || p.item_type !== "webinar") continue;
    const key = itemKey(p);
    if (selected && key !== selected) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd) continue;
    let s = perDay.get(ymd);
    if (!s) { s = new Set(); perDay.set(ymd, s); }
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

/** Distinct webinars that have paid registrations → selector options, most first. */
export function listPaidWebinars(payments: Payment[]): PaidWebinarOption[] {
  const totals = new Map<string, PaidWebinarOption>();
  for (const p of payments) {
    if (!isPaid(p.status) || p.item_type !== "webinar") continue;
    const key = itemKey(p);
    if (!key) continue;
    const cur = totals.get(key) || { key, label: p.item || key, count: 0 };
    cur.count += 1;
    if (p.item && (cur.label === key || !cur.label)) cur.label = p.item;
    totals.set(key, cur);
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
