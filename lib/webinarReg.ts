import { istYMD } from "./dates";
import { isPaidStatus as isPaid, itemKey } from "./paymentsAgg";
import type { Payment } from "./types";

/** Timeframe presets shared by every registrations view. */
export type Frame = "7d" | "30d" | "month" | "year";

/** IST YMD for `daysAgo` days before today. */
export function ymdDaysAgo(daysAgo: number): string {
  return istYMD(new Date(Date.now() - daysAgo * 86400000)) || "";
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

export interface WebinarSplitRow {
  key: string;
  label: string;
  count: number;
}

/**
 * Per-webinar registration split for the rows matching `inSel` (an IST-YMD
 * predicate). Distinct by (phone, webinar, day) — identical granularity to
 * {@link buildWebinarByDay} and the source breakdown, so the per-webinar rows
 * sum EXACTLY to the all-webinars total for the same window. Sorted most-first.
 * Read-only.
 */
export function webinarSplit(payments: Payment[], inSel: (ymd: string) => boolean): { rows: WebinarSplitRow[]; total: number } {
  const perWebinar = new Map<string, { label: string; set: Set<string> }>();
  for (const p of payments) {
    if (!isPaid(p.status) || p.item_type !== "webinar") continue;
    const key = itemKey(p);
    if (!key) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd || !inSel(ymd)) continue;
    let e = perWebinar.get(key);
    if (!e) { e = { label: p.item || key, set: new Set() }; perWebinar.set(key, e); }
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
