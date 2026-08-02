/** Formatting helpers for Telegram business reports (IST + INR). */
import { formatINR } from "../../dates";

export function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function dash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

export function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100_000) {
    const lakh = n / 100_000;
    const rounded = Math.abs(lakh) >= 10 ? Math.round(lakh) : Math.round(lakh * 10) / 10;
    return `₹${rounded.toLocaleString("en-IN")}L`;
  }
  return formatINR(Math.round(n));
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

export function deltaArrow(deltaPct: number | null | undefined): string {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return "· —";
  const abs = Math.abs(Math.round(deltaPct));
  if (abs === 0) return "· flat";
  return deltaPct > 0 ? `▲ ${abs}%` : `▼ ${abs}%`;
}

export function deltaAbsLabel(curr: number | null, prev: number | null, suffix = ""): string {
  if (curr == null || prev == null) return "";
  const d = Math.round(curr - prev);
  if (d === 0) return "";
  const sign = d > 0 ? "+" : "";
  return ` (${sign}${d}${suffix})`;
}

/** Current IST parts. */
export function istNowParts(d = new Date()): {
  ymd: string;
  hour: number;
  minute: number;
  label: string;
  slotKey: string;
} {
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const y = get("year");
  const month = get("month");
  const day = get("day");
  const hour12 = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");

  const ymdFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = ymdFmt.format(d); // YYYY-MM-DD
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  });
  const hour = Number(hourFmt.format(d));
  const minFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    minute: "2-digit",
  });
  const minuteN = Number(minFmt.format(d));

  const label = `${day} ${month}, ${hour12}:${minute} ${dayPeriod}`.replace(/\s+/g, " ").trim();
  const slotHour = String(hour).padStart(2, "0");
  return {
    ymd,
    hour,
    minute: minuteN,
    label,
    slotKey: `${ymd}T${slotHour}:00+05:30`,
  };
}

export function formatIstShort(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
