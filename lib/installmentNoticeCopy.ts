/** Client-safe helpers for installment notice copy (no server imports). */

/** Avoid "Installment 1 · Installment 1" when label already includes the number. */
export function formatInstalmentLabel(installmentNo: number, label?: string | null): string {
  const no = installmentNo;
  const raw = (label || "").trim();
  if (!raw) return `Instalment ${no}`;
  const stripped = raw
    .replace(/^Installments?\s+\d+(\s+of\s+\d+)?\s*[·•\-]?\s*/i, "")
    .replace(/^Instalments?\s+\d+(\s+of\s+\d+)?\s*[·•\-]?\s*/i, "")
    .trim();
  if (!stripped || /^install?ments?\s+\d+/i.test(stripped)) return `Instalment ${no}`;
  if (/^of\s+\d+/i.test(stripped)) return `Instalment ${no} ${stripped}`;
  return `Instalment ${no}`;
}

export function shortCourseTitle(title: string, max = 36): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
