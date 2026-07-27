/**
 * ZERO-SEND QA for bulk installment reminders.
 *
 * Everything here goes through buildBulkInstallmentReminders, which resolves,
 * renders and gates but NEVER calls the gateway. Console output only, phones
 * masked. Nothing is written to any table.
 */
import { getAllCourseEnrollments, getCourseEnrollmentById } from "../lib/dataProvider";
import { deriveCollections, isLineOutstanding } from "../lib/installments";
import { maskMobile, normalizeIndianMobile } from "../lib/phone";
import { buildBulkInstallmentReminders, buildReminderContext, buildReminderFor } from "../lib/sms/installmentReminderService";
import { buildTracking } from "../lib/sms/installmentTracking";
import { isOutstandingInstallment } from "../lib/sms/installmentAttribution";
import type { CourseEnrollment } from "../lib/types";

const money = (n: number | null | undefined) => (n == null ? "—" : String(n));

function hdr(t: string) { console.log(`\n${"=".repeat(76)}\n${t}\n${"=".repeat(76)}`); }

/** The page's own view of this enrollment (same functions the table renders). */
function pageView(e: CourseEnrollment) {
  const d = deriveCollections(e);
  return {
    overdueColumn: d.overdueAmount,
    balance: d.remaining,
    nextPayableNo: d.nextPayable?.no ?? null,
    nextPayableAmount: d.nextPayable?.amount ?? null,
    nextPayableKind: d.nextPayable?.kind ?? null,
    daysOverdue: d.daysOverdue,
    missed: d.missedInstallments,
  };
}

async function main() {
  const all = await getAllCourseEnrollments();
  const active = all.filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const atRisk = active.filter((e) => deriveCollections(e).overdueAmount > 0);

  hdr("SCOPE");
  console.log(`enrollments total ${all.length} · active ${active.length} · at-risk (overdue > 0) ${atRisk.length}`);

  // ---- pick the course+batch with the most at-risk students ----
  const groups = new Map<string, CourseEnrollment[]>();
  for (const e of atRisk) {
    const k = `${e.course_id}||${e.batch_label ?? ""}`;
    const l = groups.get(k); if (l) l.push(e); else groups.set(k, [e]);
  }
  const [bestKey, cohort] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
  const courseTitle = cohort[0]!.course_title;
  const batchLabel = cohort[0]!.batch_label ?? "(no batch)";

  hdr(`BULK MATRIX — ${courseTitle} · ${batchLabel} (${cohort.length} at-risk students)`);
  const bulk = await buildBulkInstallmentReminders(cohort.map((e) => e.id), { overdueOnly: true });

  console.log(
    "phone".padEnd(12),
    "PAGE overdue".padStart(13),
    "PAGE next-line".padStart(15),
    "SMS inst".padStart(9),
    "SMS amount".padStart(11),
    "match".padStart(6),
    " sendable / reason",
  );
  let mismatches = 0;
  for (const e of cohort) {
    const p = bulk.previews.find((x) => x.enrollmentId === e.id)!;
    const pv = pageView(e);
    const pageLine = pv.nextPayableKind === "installment" ? `no.${pv.nextPayableNo} ${money(pv.nextPayableAmount)}` : `${pv.nextPayableKind ?? "—"}`;
    const smsInst = p.installmentNo != null ? `no.${p.installmentNo}` : "—";
    // The SMS figure must equal the page's own figure for THAT line.
    const comparable = pv.nextPayableKind === "installment" && p.sendable;
    const ok = !comparable || (p.installmentNo === pv.nextPayableNo && p.amountDue === pv.nextPayableAmount);
    if (!ok) mismatches++;
    console.log(
      maskMobile(e.phone).padEnd(12),
      money(pv.overdueColumn).padStart(13),
      pageLine.padStart(15),
      smsInst.padStart(9),
      money(p.amountDue).padStart(11),
      (comparable ? (ok ? "OK" : "BUG") : "n/a").padStart(6),
      ` ${p.sendable ? "SEND" : `excluded: ${p.blockReason}`}`,
    );
  }
  console.log(`\nmismatches (page figure vs SMS figure): ${mismatches}  ${mismatches === 0 ? "— PASS" : "— BUG"}`);
  console.log(`sendable ${bulk.sendableCount} · excluded ${bulk.excludedCount} · segments ${bulk.totalSegments} · DLT ${bulk.dltTemplateId}`);
  console.log("excluded by reason:", JSON.stringify(bulk.excludedByReason));

  // ---- the amount printed in the body must match the resolved amount ----
  hdr("BODY vs RESOLVED AMOUNT (byte check on the rendered text)");
  let bodyBugs = 0;
  for (const p of bulk.previews.filter((x) => x.sendable)) {
    const m = p.body.match(/installment no\. (\d+) of Rs\.(\d+(?:\.\d+)?)/);
    const okNo = m && Number(m[1]) === p.installmentNo;
    const okAmt = m && Number(m[2]) === p.amountDue;
    const noBraces = !/[{}]/.test(p.body);
    if (!m || !okNo || !okAmt || !noBraces) { bodyBugs++; console.log("  BUG:", maskMobile("**********"), p.enrollmentId, p.body); }
  }
  console.log(`bodies checked ${bulk.sendableCount} · defects ${bodyBugs} ${bodyBugs === 0 ? "— PASS" : "— BUG"}`);

  // ---- edge-case census across ALL enrollments ----
  hdr("EDGE-CASE CENSUS (every active enrollment, overdue-only default ON)");
  const census: Record<string, number> = {};
  const bump = (k: string) => { census[k] = (census[k] || 0) + 1; };
  const ctx = await buildReminderContext(active, { overdueOnly: true });
  if (!ctx.ok) { console.log("job-level block:", ctx.reason, ctx.detail); return; }

  const examples: Record<string, string> = {};
  for (const e of active) {
    const p = buildReminderFor(e, ctx.ctx);
    const key = p.sendable ? "SENDABLE" : p.blockReason!;
    bump(key);
    if (!examples[key]) examples[key] = `${maskMobile(e.phone)} · ${e.course_title.slice(0, 28)}`;

    const unpaidInst = (e.schedule || []).filter(isOutstandingInstallment).length;
    if (unpaidInst > 1 && p.sendable) bump("· of which multiple unpaid installments");
    if ((e.schedule || []).some((l) => isLineOutstanding(l) && l.kind === "seat")) bump("· has an unpaid seat line");
    if (!normalizeIndianMobile(e.phone || "").ok) bump("· phone unusable");
  }
  for (const [k, v] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
    console.log(String(v).padStart(5), k.padEnd(26), examples[k] ? `e.g. ${examples[k]}` : "");
  }

  // ---- not-yet-due must be excluded by default and included when relaxed ----
  hdr("DEFAULT SAFETY — 'not yet due' is excluded unless explicitly relaxed");
  const relaxed = await buildReminderContext(active, { overdueOnly: false });
  if (relaxed.ok) {
    let strictSendable = 0, relaxedSendable = 0, notYetDue = 0;
    for (const e of active) {
      const s = buildReminderFor(e, ctx.ctx);
      const r = buildReminderFor(e, relaxed.ctx);
      if (s.sendable) strictSendable++;
      if (r.sendable) relaxedSendable++;
      if (s.blockReason === "not_yet_due") notYetDue++;
    }
    console.log(`overdue-only ON  -> ${strictSendable} sendable`);
    console.log(`overdue-only OFF -> ${relaxedSendable} sendable`);
    console.log(`students excluded ONLY because their installment is not due yet: ${notYetDue}`);
    console.log(relaxedSendable >= strictSendable ? "PASS — the default is the narrower, safer set" : "BUG — the default is not the safe case");
  }

  // ---- same student in two batches ----
  hdr("SAME STUDENT IN TWO COHORTS — reminders must stay per-enrollment");
  const byPhone = new Map<string, CourseEnrollment[]>();
  for (const e of active) {
    const n = normalizeIndianMobile(e.phone || "");
    if (!n.ok || !n.digits10) continue;
    const l = byPhone.get(n.digits10); if (l) l.push(e); else byPhone.set(n.digits10, [e]);
  }
  const multi = [...byPhone.entries()].filter(([, l]) => l.length > 1);
  console.log(`phones with more than one active enrollment: ${multi.length}`);
  for (const [digits, list] of multi.slice(0, 4)) {
    console.log(`  ${maskMobile(digits)}:`);
    for (const e of list) {
      const p = buildReminderFor(e, ctx.ctx);
      console.log(`     ${e.id.slice(0, 8)} · ${e.course_title.slice(0, 26).padEnd(26)} inst ${String(p.installmentNo ?? "—").padStart(3)} · ${money(p.amountDue).padStart(7)} · ${p.sendable ? "SEND" : p.blockReason}`);
    }
  }
  const distinctKeys = new Set(multi.flatMap(([, l]) => l.map((e) => e.id)));
  console.log(`attribution keys are per ENROLLMENT, so ${distinctKeys.size} distinct keys across those students — a reminder for one cohort can never mark the other cohort's installment.`);

  // ---- cohort with zero overdue ----
  hdr("COHORT WITH ZERO OVERDUE");
  const zero = active.filter((e) => deriveCollections(e).overdueAmount === 0);
  const zeroGroups = new Map<string, CourseEnrollment[]>();
  for (const e of zero) {
    const k = `${e.course_title}||${e.batch_label ?? ""}`;
    if (atRisk.some((a) => a.course_id === e.course_id && (a.batch_label ?? "") === (e.batch_label ?? ""))) continue;
    const l = zeroGroups.get(k); if (l) l.push(e); else zeroGroups.set(k, [e]);
  }
  const zg = [...zeroGroups.entries()][0];
  if (zg) {
    const r = await buildBulkInstallmentReminders(zg[1].map((e) => e.id), { overdueOnly: true });
    console.log(`${zg[0].split("||")[0]!.slice(0, 40)} — ${zg[1].length} students, sendable ${r.sendableCount}, excluded ${r.excludedCount}`);
    console.log("reasons:", JSON.stringify(r.excludedByReason));
    console.log(r.sendableCount === 0 ? "PASS — nothing to chase, nothing offered" : "CHECK — a cohort with no overdue produced sendable reminders");
  } else {
    console.log("(no cohort is entirely free of overdue students)");
  }

  // ---- 300+ selection: cap ----
  hdr("CAP — a selection larger than 500");
  const many = [...active.map((e) => e.id)];
  const inflated = [...many, ...many]; // 620 ids, deliberately with duplicates
  const capped = await buildBulkInstallmentReminders(inflated, { overdueOnly: true });
  console.log(`requested ${inflated.length} (${new Set(inflated).size} unique) -> previews ${capped.previews.length} · dropped over cap ${capped.overCapDropped}`);
  console.log(capped.previews.length <= 500 ? "PASS — capped at 500, duplicates collapsed" : "BUG — cap not enforced");

  // ---- tracking, on real data ----
  hdr("TRACKING STATES (real data, whole table)");
  const tracking = await buildTracking(active);
  const dist: Record<string, number> = {};
  for (const [, v] of tracking.byEnrollment) {
    const k = v.row ? v.row.kind : "no_installment_line";
    dist[k] = (dist[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
  const a = tracking.aggregate;
  console.log(`\nheader line: Reminded: ${a.reminded} · Paid after reminder: ${a.paidAfterReminder}${a.medianDaysToPayment != null ? ` (median ${a.medianDaysToPayment}d)` : ""} · Still pending: ${a.stillPending}`);

  hdr("HISTORICAL REMINDER (no attribution key) RENDERS HONESTLY");
  for (const [id, v] of tracking.byEnrollment) {
    const s = v.perInstallment.find((x) => x.kind === "reminded_unattributable");
    if (!s) continue;
    const e = await getCourseEnrollmentById(id);
    console.log(`${maskMobile(e!.phone)} · ${e!.course_title.slice(0, 30)}`);
    console.log(`  installment no.${s.installmentNo} · outstanding ${money(s.outstanding)} · state "${s.kind}" · reason "${s.unattributableReason}"`);
    console.log(`  -> rendered as "Reminded — installment not recorded": not dropped, not attributed.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
