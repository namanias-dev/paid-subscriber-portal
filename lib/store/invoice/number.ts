/** Indian financial year and invoice serials. Production and test use separate sequences. */

export function financialYearLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = month >= 4 ? year : year - 1;
  const a = String(start).slice(-2);
  const b = String(start + 1).slice(-2);
  return `${a}-${b}`;
}

export function formatInvoiceNumber(prefix: string, financialYear: string, sequence: number): string {
  const safePrefix = (prefix || "NIA").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "NIA";
  const n = Math.max(1, Math.floor(sequence));
  return `${safePrefix}/${financialYear}/${String(n).padStart(5, "0")}`;
}

export function invoiceObjectKey(financialYear: string, invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^A-Za-z0-9/_-]/g, "");
  return `invoices/FY${financialYear}/${safe}.pdf`;
}

/** Private audit copy. Customer downloads keep using invoiceObjectKey. */
export function invoiceAuditObjectKey(financialYear: string, invoiceNumber: string, revision: number): string {
  const safe = invoiceNumber.replace(/[^A-Za-z0-9/_-]/g, "");
  return `invoices/audit/FY${financialYear}/${safe}-r${revision}.pdf`;
}
