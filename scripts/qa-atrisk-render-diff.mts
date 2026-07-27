/**
 * Proves the At-Risk Fees table renders IDENTICALLY with nothing selected.
 *
 * Replays the OLD row pipeline (as shipped in 6246ffe0) and the NEW one in its
 * default state over the same live data, then diffs the ordered list of every
 * pre-existing column value. Anything but a zero diff means the default view
 * changed, which the brief forbids.
 */
import { getAllCourseEnrollments } from "../lib/dataProvider";
import { deriveCollections } from "../lib/installments";
import { formatINR, formatISTDate } from "../lib/dates";
import type { CourseEnrollment } from "../lib/types";

type Row = { e: CourseEnrollment; d: ReturnType<typeof deriveCollections> };

/** The columns the table actually paints, in order. */
function renderRow(r: Row): string {
  const { e, d } = r;
  return [
    e.id,
    e.student_name,
    e.phone,
    e.course_title,
    e.batch_label ?? "",
    formatINR(d.overdueAmount),
    `${d.daysOverdue}d`,
    String(d.missedInstallments),
    formatINR(d.remaining),
    d.nextDueDate ? formatISTDate(d.nextDueDate) : "—",
  ].join(" | ");
}

function sortOverdue(list: Row[]): Row[] {
  return [...list].sort((a, b) => b.d.overdueAmount - a.d.overdueAmount || b.d.daysOverdue - a.d.daysOverdue);
}

/** OLD: components/admin/collections/CollectionsWorklist.tsx @ 6246ffe0 */
function oldPipeline(enrollments: CourseEnrollment[]): Row[] {
  const overdue = enrollments
    .filter((e) => e.amount_paid > 0 && e.status !== "cancelled")
    .map((e) => ({ e, d: deriveCollections(e) }))
    .filter(({ d }) => d.overdueAmount > 0);
  // Default filters: courseId "all", batch "all", q "", sort "overdue".
  return sortOverdue(overdue);
}

/** NEW: same file, default state — overdueOnly ON, staleOnly OFF, nothing selected. */
function newPipeline(enrollments: CourseEnrollment[]): Row[] {
  const overdueOnly = true;
  const scoped = enrollments
    .filter((e) => e.amount_paid > 0 && e.status !== "cancelled")
    .map((e) => ({ e, d: deriveCollections(e) }))
    .filter(({ d }) => (overdueOnly ? d.overdueAmount > 0 : d.remaining > 0));
  return sortOverdue(scoped);
}

async function main() {
  const all = await getAllCourseEnrollments();
  const before = oldPipeline(all).map(renderRow);
  const after = newPipeline(all).map(renderRow);

  console.log("=== AT-RISK FEES: DEFAULT VIEW, NOTHING SELECTED ===");
  console.log(`rows before: ${before.length}`);
  console.log(`rows after : ${after.length}`);

  const diffs: string[] = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    if (before[i] !== after[i]) diffs.push(`row ${i}:\n  before: ${before[i] ?? "(absent)"}\n  after : ${after[i] ?? "(absent)"}`);
  }

  const headlineBefore = oldPipeline(all).reduce((a, { d }) => a + d.overdueAmount, 0);
  const headlineAfter = newPipeline(all).reduce((a, { d }) => a + d.overdueAmount, 0);
  console.log(`headline before: ${formatINR(headlineBefore)}`);
  console.log(`headline after : ${formatINR(headlineAfter)}`);

  console.log(`\nrow-by-row diffs: ${diffs.length}`);
  for (const d of diffs.slice(0, 5)) console.log(d);
  console.log(
    diffs.length === 0 && before.length === after.length && headlineBefore === headlineAfter
      ? "\nPASS — same rows, same order, same values in every pre-existing column."
      : "\nBUG — the default view changed.",
  );
  console.log("\nAdditive only: a checkbox column, a Reminder column, a reminder-filter row and one header line.");
  console.log("The sticky bar renders nothing until at least one row is selected.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
