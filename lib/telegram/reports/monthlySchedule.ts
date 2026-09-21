/**
 * Month-end business report slot.
 * Fires on the 1st (Asia/Kolkata) and summarises the previous complete calendar
 * month. Retries are safe: the caller stores one snapshot per `monthly:YYYY-MM`.
 * Quiet hours skip the tick; the next hourly cron on the 1st still owes the report.
 */
import { istNowParts } from "./format";
import { istMonthWindow, type TimeWindow } from "../../analytics/businessMetrics";

export interface MonthlyReportSlot {
  /** Idempotency key for the month being reported, e.g. monthly:2026-09 */
  slotKey: string;
  /** YYYY-MM of the reported month. */
  ym: string;
  label: string;
  window: TimeWindow;
}

function previousMonth(ymd: string): { year: number; month: number } {
  const [y, m] = ymd.split("-").map(Number);
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

export function resolveMonthlyReportSlot(
  d = new Date(),
  quiet?: (istHour: number) => boolean,
): MonthlyReportSlot | null {
  const parts = istNowParts(d);
  const day = Number(parts.ymd.slice(8, 10));
  if (day !== 1) return null;
  if (quiet?.(parts.hour)) return null;
  const prev = previousMonth(parts.ymd);
  const ym = `${prev.year}-${String(prev.month).padStart(2, "0")}`;
  return {
    slotKey: `monthly:${ym}`,
    ym,
    label: `${MONTHS[prev.month - 1]} ${prev.year}`,
    window: istMonthWindow(prev.year, prev.month),
  };
}
