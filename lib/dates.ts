const DAY_MS = 86400000;

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
