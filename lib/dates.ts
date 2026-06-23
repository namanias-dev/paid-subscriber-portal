const DAY_MS = 86400000;

/** Human-readable file size, e.g. 1.4 MB. */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Compute expiry from a start date + number of months (30d each). null => lifetime. */
export function computeExpiry(startDate: string | Date, months: number | null): string | null {
  if (months == null) return null;
  const start = new Date(startDate);
  const expiry = new Date(start.getTime() + months * 30 * DAY_MS);
  return expiry.toISOString();
}

/** Days remaining until expiry. null => lifetime (Infinity). */
export function daysLeft(expiryDate: string | null): number {
  if (!expiryDate) return Infinity;
  const expiry = new Date(expiryDate).getTime();
  return Math.ceil((expiry - Date.now()) / DAY_MS);
}

export function isExpired(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  return daysLeft(expiryDate) <= 0;
}

export function isExpiringSoon(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  const d = daysLeft(expiryDate);
  return d > 0 && d <= 7;
}

export function formatDate(date: string | Date | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ----------------------------- IST (Asia/Kolkata) time -----------------------------
// India Standard Time is a fixed UTC+5:30 with no daylight saving, so a constant
// offset is the most reliable way to convert naive admin input to a real instant.
const IST_OFFSET_MIN = 330;

/**
 * Convert a naive `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm"),
 * which represents an IST wall-clock time, into a timezone-correct UTC ISO string.
 * This avoids interpreting the input in the admin's *browser* timezone.
 */
export function istInputToISO(local: string): string {
  if (!local) return "";
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) {
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  const utcMs =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) -
    IST_OFFSET_MIN * 60000;
  return new Date(utcMs).toISOString();
}

/** Convert a stored UTC ISO instant into an IST wall-clock value for a datetime-local input. */
export function isoToISTInput(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const ist = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

/**
 * Add days to a UTC ISO instant, anchored to the IST calendar day, and return a
 * UTC ISO at IST midday (12:00) — safe for date-level due dates (no TZ rollover).
 */
export function addDaysISO(iso: string, days: number): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const ist = new Date(base.getTime() + IST_OFFSET_MIN * 60000);
  const utcMidday =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 12, 0) -
    IST_OFFSET_MIN * 60000;
  return new Date(utcMidday).toISOString();
}

/** Add calendar months to a UTC ISO instant (IST calendar, clamps day, IST midday). */
export function addMonthsISO(iso: string, months: number): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const ist = new Date(base.getTime() + IST_OFFSET_MIN * 60000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + months;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const day = Math.min(ist.getUTCDate(), daysInMonth(targetY, targetM));
  const utcMidday = Date.UTC(targetY, targetM, day, 12, 0) - IST_OFFSET_MIN * 60000;
  return new Date(utcMidday).toISOString();
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

const IST_DATE_FULL = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const IST_DATE_MED = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/** "28 Jun 2026" in IST (timezone-stable across server/browser). */
export function formatISTDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : IST_DATE_MED.format(d);
}

/** "11:00 AM" in IST. */
export function formatISTTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : IST_TIME.format(d);
}

/** "28 Jun 2026, 11:00 AM IST" — compact for cards/lists. */
export function formatISTDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${IST_DATE_MED.format(d)}, ${IST_TIME.format(d)} IST`;
}

/**
 * Full range label, e.g. "Sunday, 28 June 2026, 11:00 AM – 1:00 PM IST".
 * Falls back to a single time when no end is provided.
 */
export function formatISTRange(startISO?: string | null, endISO?: string | null): string {
  if (!startISO) return "—";
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return "—";
  const datePart = IST_DATE_FULL.format(start);
  const startTime = IST_TIME.format(start);
  if (endISO) {
    const end = new Date(endISO);
    if (!Number.isNaN(end.getTime())) return `${datePart}, ${startTime} – ${IST_TIME.format(end)} IST`;
  }
  return `${datePart}, ${startTime} IST`;
}

/** UPSC Prelims is typically late May / early June. Use June 1 as a reasonable default. */
export function daysToPrelims(targetYear: number | null): number | null {
  if (!targetYear) return null;
  const prelims = new Date(`${targetYear}-06-01T00:00:00`);
  const diff = Math.ceil((prelims.getTime() - Date.now()) / DAY_MS);
  return diff;
}

/** % of plan duration consumed (0-100). Lifetime => 0. */
export function planUsedPercent(
  startDate: string | null,
  expiryDate: string | null
): number {
  if (!expiryDate || !startDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(expiryDate).getTime();
  const now = Date.now();
  if (end <= start) return 100;
  const pct = ((now - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Format an integer as Indian currency, e.g. 124500 -> ₹1,24,500 */
export function formatINR(amount: number | null | undefined): string {
  if (amount == null) return "₹0";
  return "₹" + amount.toLocaleString("en-IN");
}

export function yesterdayISODate(): string {
  return new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
}
