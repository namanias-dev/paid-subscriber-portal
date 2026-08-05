/**
 * Full access-reminder cycle with dry_run=true. Print recipients; optionally arm.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase3-arm-reminders.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase3-arm-reminders.ts --arm
 */
import { readFileSync, existsSync } from "fs";
import { planAccessAutomation, printAutoReport } from "../lib/sms/accessAutomation";
import {
  getAccessReminderSettings,
  updateAccessReminderSettings,
} from "../lib/sms/accessCapStore";
import { enrollmentFeeStateFromEnrollment } from "../lib/enrollmentFeeState";
import { getCourseEnrollmentById } from "../lib/dataProvider";
import { ACCESS_QUIET_HOURS_IST } from "../lib/sms/accessReminderConstants";
import { getRule, upsertRule } from "../lib/sms/store";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!.trim();
    let v = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const SIMRAN_ID = "c5a9042c-d157-4afe-8c11-e71c92a5e036";

async function main() {
  const doArm = process.argv.includes("--arm");

  const before = await getAccessReminderSettings();
  const mcBefore = await getRule("installment_access_reminder");
  console.log("SETTINGS_BEFORE", before);
  console.log("MC_RULE_BEFORE", {
    enabled: mcBefore?.enabled,
    schedule_time: mcBefore?.schedule_time,
    template_id: mcBefore?.template_id,
  });
  console.log("QUIET_HOURS_IST", ACCESS_QUIET_HOURS_IST);

  if (!before.dryRun) {
    await updateAccessReminderSettings({ dryRun: true }, "phase3-arm-script");
  }

  // Mid-day IST so quiet hours don't empty the dry-run table.
  // 2026-08-06 06:30 UTC = 12:00 IST.
  const noonIst = Date.parse("2026-08-06T06:30:00.000Z");
  const plan = await planAccessAutomation(noonIst);
  printAutoReport(plan);

  const recipients = plan.wouldSend.map((c) => ({
    name: c.studentName,
    phone: c.maskedPhone,
    enrollmentId: c.enrollmentId,
    installmentNo: c.installmentNo,
    accessStatus: c.accessStatus,
    daysLeft: c.daysLeft,
    templateId: c.templateId,
    body: c.body,
  }));
  console.log("CANDIDATE_COUNT", plan.candidates.length);
  console.log("EXCLUDED", JSON.stringify(plan.excluded, null, 2));
  console.log("RECIPIENT_COUNT", recipients.length);

  const enriched = [];
  for (const r of recipients) {
    const e = await getCourseEnrollmentById(r.enrollmentId);
    const fee = e ? enrollmentFeeStateFromEnrollment(e) : null;
    enriched.push({
      name: r.name,
      phone: r.phone,
      enrollmentId: r.enrollmentId,
      installmentNo: r.installmentNo,
      amount: fee?.nextDueInstalment?.amountDue ?? null,
      due: fee?.nextDueInstalment?.dueDate ?? null,
      carriedIn: fee?.nextDueInstalment?.carriedIn ?? null,
      baseAmount: fee?.nextDueInstalment?.baseAmount ?? null,
      templateId: r.templateId,
      accessStatus: r.accessStatus,
      body: r.body,
    });
  }
  console.log("RECIPIENTS", JSON.stringify(enriched, null, 2));

  // Also print all candidates (including skipped) for audit visibility
  const candEnriched = [];
  for (const c of plan.candidates) {
    const e = await getCourseEnrollmentById(c.enrollmentId);
    const fee = e ? enrollmentFeeStateFromEnrollment(e) : null;
    candEnriched.push({
      name: c.studentName,
      phone: c.maskedPhone,
      enrollmentId: c.enrollmentId,
      skip: c.skipReason,
      installmentNo: c.installmentNo,
      amount: fee?.nextDueInstalment?.amountDue ?? null,
      due: fee?.nextDueInstalment?.dueDate ?? null,
      accessStatus: c.accessStatus,
      body: c.body?.slice(0, 160),
    });
  }
  console.log("ALL_CANDIDATES", JSON.stringify(candEnriched, null, 2));

  const simranDirect = enriched.filter((r) => r.enrollmentId === SIMRAN_ID);
  const simranCand = candEnriched.filter((r) => r.enrollmentId === SIMRAN_ID);
  console.log("SIMRAN_WOULD_SEND", simranDirect.length, JSON.stringify(simranDirect, null, 2));
  console.log("SIMRAN_CANDIDATE", JSON.stringify(simranCand, null, 2));

  const blockers: string[] = [];
  for (const r of simranDirect) {
    if (r.amount === 1333 || r.amount === 19333) blockers.push(`Simran amount ${r.amount} forbidden`);
    if (r.amount != null && r.amount !== 20666) blockers.push(`Simran amount ${r.amount} ≠ 20666`);
    if (r.due && !String(r.due).startsWith("2026-08-20")) blockers.push(`Simran due ${r.due}`);
    if (r.accessStatus === "blocked") blockers.push("Simran blocked/overdue");
    if (/1,?333/.test(r.body) && !/20,?666/.test(r.body)) blockers.push("Simran body has ₹1,333");
    if (/19,?333/.test(r.body) && !/20,?666/.test(r.body)) blockers.push("Simran body has ₹19,333 only");
  }
  for (const r of simranCand) {
    if (r.amount === 1333 || r.amount === 19333) blockers.push(`Simran cand amount ${r.amount}`);
  }
  for (const r of enriched) {
    if (r.carriedIn && r.carriedIn > 0 && r.amount != null && r.baseAmount != null) {
      if (r.amount === r.baseAmount) blockers.push(`${r.name}: amount ignores carry`);
    }
  }

  const clean = blockers.length === 0;
  console.log("DRY_RUN_CLEAN", clean);
  if (!clean) {
    console.log("BLOCKERS", JSON.stringify(blockers, null, 2));
    if (!before.dryRun) {
      await updateAccessReminderSettings({ dryRun: before.dryRun }, "phase3-arm-script");
    }
    console.log("ARMED", false, "reason=dry_run_not_clean");
    process.exit(2);
  }

  if (!doArm) {
    console.log("ARMED", false, "reason=no_--arm_flag");
    return;
  }

  const after = await updateAccessReminderSettings(
    { enabled: true, dryRun: false },
    "phase3-arm-script",
  );
  const mcAfter = await upsertRule("installment_access_reminder", { enabled: true });
  console.log("SETTINGS_AFTER", after);
  console.log("MC_RULE_AFTER", { enabled: mcAfter?.enabled, schedule_time: mcAfter?.schedule_time });
  console.log("ARMED", true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
