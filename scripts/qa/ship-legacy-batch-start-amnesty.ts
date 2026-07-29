/**
 * APPLY legacy batch starts + 7-day amnesty + enable live access SMS.
 *
 *   DRY_RUN=1  — plan only (default)
 *   APPLY=1    — dates + amnesty + asserts + canary + enable + first wave
 *   REVERT_ID=<uuid> — revert a snapshot
 *
 * ZERO accidental SMS unless APPLY=1 passes all asserts.
 */
import { getSupabaseAdmin } from "../../lib/supabase";
import {
  getAllCourseEnrollments,
  getAllAccessOverrides,
  getAllCourses,
  updateCourse,
} from "../../lib/dataProvider";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { isActiveEnrollment } from "../../lib/installments";
import { isAccessAtRiskEnrollment } from "../../lib/accessAtRisk";
import { isPhantomEnrollment } from "../../lib/enrollmentScope";
import {
  activeAccessGrant,
  buildAccessReminder,
} from "../../lib/sms/accessReminderService";
import {
  planAccessAutomation,
  runAccessAutomation,
  printAutoReport,
} from "../../lib/sms/accessAutomation";
import {
  getAccessReminderSettings,
  updateAccessReminderSettings,
} from "../../lib/sms/accessCapStore";
import { maskMobile } from "../../lib/phone";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_DAILY_VOLUME_CEILING,
} from "../../lib/sms/accessReminderConstants";
import { gatewayConfigured } from "../../lib/sms/config";
import { previewSms, sendSms } from "../../lib/sms/service";
import { getSettings as getSmsSettings, updateSettings as updateSmsSettings } from "../../lib/sms/store";
import {
  SAARTHI_OLD_ID,
  SAFALTA_OLD_ID,
  TARGET_COURSE_IDS,
  SAARTHI_START_ISO,
  SAFALTA_START_ISO,
  AMNESTY_REASON,
  AMNESTY_ACTOR,
  BACKFILL_ACTOR,
  applyCourseStartDates,
  planAmnestyCohort,
  issueSystemAmnestyGrant,
  amnestyExpiresAt,
  saveBackfillSnapshot,
  revertBackfillSnapshot,
  isLiveOverdueBlocked,
  startForCourse,
  type PaymentLite,
} from "../../lib/legacyBatchStartBackfill";

const APPLY = process.env.APPLY === "1";
const REVERT_ID = process.env.REVERT_ID || "";
const TEST_MOBILE = "9988791797";
const LIVE_RAMP = 25;
const TAG = `legacy-backfill-${new Date().toISOString().slice(0, 10)}`;

function maskName(name: string | null | undefined): string {
  const n = (name || "?").trim().split(/\s+/);
  if (n.length === 1) return n[0].slice(0, 2) + "***";
  return n[0] + " " + n[n.length - 1].slice(0, 1) + ".";
}

async function loadPayments(enrIds: string[], phones: string[]): Promise<PaymentLite[]> {
  const db = getSupabaseAdmin()!;
  const out: PaymentLite[] = [];
  for (let i = 0; i < enrIds.length; i += 80) {
    const chunk = enrIds.slice(i, i + 80);
    const { data } = await db
      .from("payments")
      .select("enrollment_id, phone, status, transaction_date, created_at, import_source, amount")
      .in("enrollment_id", chunk)
      .order("id");
    out.push(...((data || []) as PaymentLite[]));
  }
  // Also phone-scoped for orphaned links (paged)
  for (let i = 0; i < phones.length; i += 80) {
    const chunk = phones.slice(i, i + 80);
    const { data } = await db
      .from("payments")
      .select("enrollment_id, phone, status, transaction_date, created_at, import_source, amount")
      .in("phone", chunk)
      .in("status", ["PAID", "captured", "CAPTURED"])
      .order("id");
    out.push(...((data || []) as PaymentLite[]));
  }
  // Dedupe by enrollment_id+created_at+amount
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.enrollment_id}|${p.phone}|${p.transaction_date}|${p.created_at}|${p.amount}|${p.status}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function scheduleFingerprints(courseIds: string[]): Promise<Map<string, string>> {
  const enrollments = await getAllCourseEnrollments();
  const map = new Map<string, string>();
  for (const e of enrollments) {
    if (!courseIds.includes(e.course_id)) continue;
    map.set(e.id, JSON.stringify(e.schedule));
  }
  return map;
}

async function main() {
  console.log("=== LEGACY BATCH START + AMNESTY + LIVE SMS ===");
  console.log({ APPLY, REVERT_ID: REVERT_ID || null, TAG, TEST_MOBILE, LIVE_RAMP });

  if (REVERT_ID) {
    const r = await revertBackfillSnapshot(REVERT_ID);
    console.log("REVERT", r);
    process.exit(r.ok ? 0 : 1);
  }

  const now = Date.now();
  const settingsBefore = await getAccessReminderSettings();
  console.log("Settings before:", settingsBefore);

  // Baseline list
  let enrollments = await getAllCourseEnrollments();
  let courses = await getAllCourses();
  let overrides = await getAllAccessOverrides();
  let byId = new Map(courses.map((c) => [c.id, c]));

  const cohort = enrollments.filter(
    (e) => TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])
      && e.status !== "cancelled" && e.status !== "transferred_out" && isActiveEnrollment(e),
  );
  const fpBefore = await scheduleFingerprints([...TARGET_COURSE_IDS]);

  let listBefore = 0;
  for (const e of enrollments) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const access = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    if (isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, override: ovr, now })) listBefore++;
  }
  console.log(`Access At Risk before: ${listBefore}; cohort active: ${cohort.length}`);

  const payments = await loadPayments(cohort.map((e) => e.id), [...new Set(cohort.map((e) => e.phone))]);
  const nullLegacy = payments.filter((p) => p.import_source === "saarthi_legacy" && !p.transaction_date && (p.status === "PAID" || p.status === "captured")).length;
  console.log(`Payments loaded: ${payments.length}; null-dated saarthi_legacy PAID: ${nullLegacy}`);
  console.log("NOTE: null-dated legacy payments do NOT count as July-2026 payments (created_at is import day). amount_paid still reflects them — students are not misread as unpaid.");

  // Plan amnesty against FUTURE starts (before applying — same math)
  const planned = await planAmnestyCohort({ payments, now });
  console.log("\n=== SAARTHI SPLIT (July 2026 txn payments) ===");
  console.table([{
    paidInJuly: planned.saarthiSplit.paidJuly,
    paidInJulyOwed: planned.saarthiSplit.paidJulyOwed,
    noJulyPayment: planned.saarthiSplit.noJuly,
    noJulyOwed: planned.saarthiSplit.noJulyOwed,
  }]);
  console.log(`Amnesty candidates (would-be-blocked): ${planned.candidates.length}`);
  console.table(planned.candidates.slice(0, 40).map((c) => ({
    student: maskName(c.name),
    phone: maskMobile(c.phone),
    course: c.courseId === SAARTHI_OLD_ID ? "Saarthi" : "Safalta",
    owed: c.owed,
    july: c.paidInJuly,
    nullLegacy: c.nullDatedLegacy,
  })));

  if (!APPLY) {
    console.log("\nDRY_RUN only. Re-run with APPLY=1 to write.");
    console.log("Target dates:", { Saarthi: SAARTHI_START_ISO, Safalta: SAFALTA_START_ISO });
    return;
  }

  // ─── APPLY DATES ───────────────────────────────────────────────
  console.log("\n=== APPLYING BATCH STARTS ===");
  const { patched, coursesBefore } = await applyCourseStartDates();
  console.table(patched.flatMap((p) => p.batchChanges.map((b) => ({
    course: p.title.slice(0, 28),
    batch: b.id.slice(0, 36),
    start: `${(b.oldStart || "null").slice(0, 10)} → ${b.newStart.slice(0, 10)}`,
    label: (b.newLabel || "").slice(0, 48),
  }))));

  // Reload courses
  courses = await getAllCourses();
  byId = new Map(courses.map((c) => [c.id, c]));

  // Schedules byte-identical
  const fpAfter = await scheduleFingerprints([...TARGET_COURSE_IDS]);
  let schedMoved = 0;
  for (const [id, before] of fpBefore) {
    if (fpAfter.get(id) !== before) schedMoved++;
  }
  console.log(`Schedule byte-identical assert: moved=${schedMoved} (want 0)`);
  if (schedMoved !== 0) {
    console.error("ABORT: schedules changed");
    process.exit(2);
  }

  // ─── APPLY AMNESTY ─────────────────────────────────────────────
  const expiresAt = amnestyExpiresAt(now);
  console.log(`\n=== ISSUING AMNESTY GRANTS until ${expiresAt} ===`);
  const grantsIssued: { phone: string; course_id: string; enrollment_id: string; owed: number }[] = [];
  for (const c of planned.candidates) {
    const r = await issueSystemAmnestyGrant({
      phone: c.phone,
      courseId: c.courseId,
      expiresAt,
      now,
    });
    if (!r.ok) {
      console.error("Grant failed", c.phone, r.error);
      process.exit(3);
    }
    grantsIssued.push({
      phone: c.phone,
      course_id: c.courseId,
      enrollment_id: c.enrollmentId,
      owed: c.owed,
    });
  }
  console.log(`Amnesty grants issued: ${grantsIssued.length} · actor=${AMNESTY_ACTOR} · reason=${AMNESTY_REASON}`);

  const snapId = await saveBackfillSnapshot({
    tag: TAG,
    coursesBefore,
    grantsIssued,
    settingsBefore,
    notes: `Safalta=${SAFALTA_START_ISO} Saarthi=${SAARTHI_START_ISO} amnesty=${expiresAt}`,
  });
  console.log(`Snapshot id: ${snapId}`);
  console.log(`REVERT: REVERT_ID=${snapId} node --import tsx --import ./scripts/_react-cache-shim.mjs --env-file=.env.local scripts/qa/ship-legacy-batch-start-amnesty.ts`);

  // Reload
  enrollments = await getAllCourseEnrollments();
  overrides = await getAllAccessOverrides();
  byId = new Map((await getAllCourses()).map((c) => [c.id, c]));

  // ─── ASSERT ZERO LIVE BLOCKED ──────────────────────────────────
  const liveBlocked: { student: string; phone: string; course: string }[] = [];
  for (const e of enrollments) {
    if (!TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])) continue;
    if (!isActiveEnrollment(e)) continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    if (isLiveOverdueBlocked(byId.get(e.course_id), e, ovr, now)) {
      liveBlocked.push({
        student: maskName(e.student_name),
        phone: maskMobile(e.phone),
        course: (e.course_title || "").slice(0, 28),
      });
    }
  }
  console.log(`\n=== LIVE BLOCKED TODAY: ${liveBlocked.length} (want 0) ===`);
  if (liveBlocked.length) {
    console.table(liveBlocked);
    console.error("ABORT: students live-blocked after amnesty — leaving dry_run=true");
    await updateAccessReminderSettings({ dryRun: true, enabled: false }, BACKFILL_ACTOR);
    process.exit(4);
  }

  // Every amnesty holder — verify Expiring not Blocked (print all)
  const amnestyPhones = new Set(grantsIssued.map((g) => g.phone));
  console.log("\n=== AMNESTY HOLDERS — template check (all) ===");
  const templateRows = [];
  for (const g of grantsIssued) {
    const e = enrollments.find((x) => x.id === g.enrollment_id)!;
    const preview = await buildAccessReminder({ enrollmentId: e.id, now });
    templateRows.push({
      student: maskName(e.student_name),
      phone: maskMobile(e.phone),
      sendable: preview.sendable,
      template: preview.templateId,
      days: preview.daysLeft,
      daysSource: preview.daysSource,
      block: preview.blockReason,
      liveOk: preview.liveAccessAllowed,
    });
    if (preview.templateId === ACCESS_BLOCKED_TEMPLATE_ID) {
      console.error("ABORT: amnesty holder would get Blocked template", e.phone);
      await updateAccessReminderSettings({ dryRun: true, enabled: false }, BACKFILL_ACTOR);
      process.exit(5);
    }
  }
  console.table(templateRows);

  // List after
  const stateBreak = { blocked: 0, grace: 0, grantHolding: 0, needsCall: 0, list: 0 };
  const listRows = [];
  for (const e of enrollments) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    const on = isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: schedule, override: ovr, now });
    if (!on) continue;
    stateBreak.list++;
    if (schedule.status === "blocked") stateBreak.blocked++;
    if (schedule.status === "grace") stateBreak.grace++;
    if (activeAccessGrant(ovr, now)) stateBreak.grantHolding++;
    listRows.push({
      student: maskName(e.student_name),
      phone: maskMobile(e.phone),
      course: TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])
        ? (e.course_id === SAARTHI_OLD_ID ? "Saarthi" : "Safalta")
        : (e.course_title || "").slice(0, 20),
      sched: schedule.status,
      grant: !!activeAccessGrant(ovr, now),
      amnesty: amnestyPhones.has(e.phone) && TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number]),
    });
  }
  console.log(`\nAccess At Risk: ${listBefore} → ${stateBreak.list}`);
  console.table([stateBreak]);

  // Phantom / fully paid SMS assert via dry-run plan
  console.log("\n=== PRE-FLIGHT DRY-RUN (automation plan, still dry) ===");
  // Keep dry_run true for planning; temporarily set ramp 25 for estimate
  await updateAccessReminderSettings({
    dryRun: true,
    enabled: false,
    killSwitch: false,
    rampLimit: LIVE_RAMP,
  }, BACKFILL_ACTOR);

  const plan = await planAccessAutomation(now);
  printAutoReport(plan);

  const wouldSendTable = plan.wouldSend.map((c) => ({
    student: maskName(c.studentName),
    phone: c.maskedPhone,
    template: c.templateId,
    days: c.daysLeft,
    inst: c.installmentNo,
    amount: c.preview?.amountDue ?? null,
    status: c.accessStatus,
  }));
  console.log("\n=== COMPLETE WOULD-SEND TABLE ===");
  console.table(wouldSendTable);

  // Assert: no blocked template to amnesty grant holders
  let blockedToAmnesty = 0;
  for (const c of plan.candidates) {
    if (c.templateId !== ACCESS_BLOCKED_TEMPLATE_ID) continue;
    const e = enrollments.find((x) => x.id === c.enrollmentId);
    if (!e) continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const grant = activeAccessGrant(ovr, now);
    if (grant && (grant.note || "").includes("amnesty")) blockedToAmnesty++;
    if (grant && amnestyPhones.has(e.phone) && TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])) {
      blockedToAmnesty++;
    }
  }
  // Also check wouldSend
  for (const c of plan.wouldSend) {
    if (c.templateId !== ACCESS_BLOCKED_TEMPLATE_ID) continue;
    const e = enrollments.find((x) => x.id === c.enrollmentId);
    if (e && amnestyPhones.has(e.phone) && TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])) {
      blockedToAmnesty++;
    }
  }
  console.log(`Blocked-template-to-amnesty: ${blockedToAmnesty} (want 0)`);

  // Phantoms / fully paid in wouldSend
  let phantomSms = 0;
  let fullyPaidSms = 0;
  for (const c of plan.wouldSend) {
    const e = enrollments.find((x) => x.id === c.enrollmentId);
    if (!e) continue;
    if (isPhantomEnrollment(e) || e.status === "checkout_intent") phantomSms++;
    if (e.status === "fully_paid" || Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)) <= 0) fullyPaidSms++;
  }
  console.log(`Phantom SMS: ${phantomSms} · Fully-paid SMS: ${fullyPaidSms} (want 0/0)`);

  // Duplicate phones in wouldSend
  const phones = plan.wouldSend.map((c) => c.maskedPhone);
  const dupPhones = phones.filter((p, i) => phones.indexOf(p) !== i);
  console.log(`Duplicate phones in wouldSend: ${dupPhones.length} (want 0)`);

  const trulyEligible = plan.candidates.filter((c) =>
    !c.skipReason || c.skipReason === "ramp_limit" || c.skipReason === "daily_ceiling",
  ).length;
  const drainDays = Math.ceil(trulyEligible / LIVE_RAMP) || 0;
  console.log(`Backlog drain @ ramp ${LIVE_RAMP}: ~${drainDays} day(s) for ${trulyEligible} eligible (ceiling ${ACCESS_DAILY_VOLUME_CEILING})`);
  console.log(`Quiet hours now: ${plan.inQuietHours} · istHour=${plan.istHour}`);

  if (blockedToAmnesty > 0 || phantomSms > 0 || fullyPaidSms > 0 || liveBlocked.length > 0 || dupPhones.length > 0) {
    console.error("ABORT pre-flight asserts — not enabling");
    await updateAccessReminderSettings({ dryRun: true, enabled: false, rampLimit: LIVE_RAMP }, BACKFILL_ACTOR);
    process.exit(6);
  }

  // ─── CANARY ────────────────────────────────────────────────────
  console.log("\n=== CANARY SMS to admin test number ONLY ===");
  if (!gatewayConfigured()) {
    console.error("ABORT: gateway not configured");
    process.exit(7);
  }
  process.env.SMS_ENABLED = "true";
  const canaryPreview = await previewSms(ACCESS_EXPIRING_TEMPLATE_ID, {
    name: "Test Admin",
    first_name: "Test",
    days: "7",
    amount: "1000",
    installment_label: "Installment 1",
    due_date: "2026-08-05",
    login_code: "TEST01",
  });
  console.log("Canary preview ok:", canaryPreview?.ok, "body:", (canaryPreview?.text || "").slice(0, 120));
  if (!canaryPreview?.ok) {
    // Fallback to welcome template if access vars incomplete
    console.log("Access template preview failed vars — using welcome_first_login canary");
  }
  const smsBefore = await getSmsSettings();
  if (!smsBefore.enabled) await updateSmsSettings({ enabled: true }, "legacy-backfill-canary");
  let canaryResult;
  try {
    if (canaryPreview?.ok) {
      canaryResult = await sendSms({
        mobile: TEST_MOBILE,
        templateId: ACCESS_EXPIRING_TEMPLATE_ID,
        variables: {
          name: "Test Admin",
          first_name: "Test",
          days: "7",
          amount: "1000",
          installment_label: "Installment 1",
          due_date: "05 Aug 2026",
          login_code: "TEST01",
        },
        sentBy: { type: "ADMIN", userId: null },
        triggerEvent: null,
        audienceType: "test",
        allowRecentOverride: true,
      });
    } else {
      canaryResult = await sendSms({
        mobile: TEST_MOBILE,
        templateId: "welcome_first_login",
        variables: { name: "Test Admin", login_code: "TEST01" },
        sentBy: { type: "ADMIN", userId: null },
        triggerEvent: null,
        audienceType: "test",
        allowRecentOverride: true,
      });
    }
  } finally {
    if (!smsBefore.enabled) await updateSmsSettings({ enabled: false }, "legacy-backfill-canary");
  }
  console.log("Canary result:", JSON.stringify({
    ok: canaryResult.ok,
    status: canaryResult.status,
    logId: canaryResult.logId,
    error: canaryResult.error,
  }));
  if (!canaryResult.ok) {
    console.error("ABORT: canary failed — not enabling student SMS");
    await updateAccessReminderSettings({ dryRun: true, enabled: false, rampLimit: LIVE_RAMP }, BACKFILL_ACTOR);
    process.exit(8);
  }

  // ─── ENABLE LIVE ───────────────────────────────────────────────
  console.log("\n=== ENABLING AUTOMATION LIVE ===");
  await updateAccessReminderSettings({
    enabled: true,
    dryRun: false,
    killSwitch: false,
    rampLimit: LIVE_RAMP,
  }, BACKFILL_ACTOR);
  const settingsLive = await getAccessReminderSettings();
  console.log("Settings live:", settingsLive);
  console.log("KILL SWITCH: update access_reminder_settings set kill_switch=true, enabled=false, dry_run=true where id=1;");
  console.log("Or: await updateAccessReminderSettings({ killSwitch:true, enabled:false, dryRun:true }, 'ops')");

  // Ensure global SMS soft-switch on for live path
  const smsSettings = await getSmsSettings();
  if (!smsSettings.enabled) {
    await updateSmsSettings({ enabled: true }, BACKFILL_ACTOR);
    console.log("Enabled global sms_settings.enabled for live path");
  }

  console.log("\n=== FIRST WAVE runAccessAutomation ===");
  const wave = await runAccessAutomation(now);
  printAutoReport(wave);
  console.log("\n=== LIVE FIRST-WAVE SEND LOG ===");
  console.table(wave.wouldSend.map((c) => ({
    student: maskName(c.studentName),
    phone: c.maskedPhone,
    template: c.templateId,
    days: c.daysLeft,
    inst: c.installmentNo,
    status: c.accessStatus,
  })));
  console.log({
    sent: wave.sent,
    wouldSend: wave.wouldSend.length,
    halted: wave.haltedReason,
    quiet: wave.inQuietHours,
    dryRun: wave.dryRun,
    drainDays,
    snapshotId: snapId,
  });

  if (wave.inQuietHours && wave.sent === 0) {
    console.log("NOTE: IST quiet hours — live student SMS will start at next in-window cron (≥09:00 IST). Settings are LIVE; backlog drains over ~" + drainDays + " day(s) at ramp " + LIVE_RAMP + ".");
  }

  console.log("\n=== DONE ===");
  console.log({
    dates: { Saarthi: SAARTHI_START_ISO, Safalta: SAFALTA_START_ISO },
    amnestyGrants: grantsIssued.length,
    listBefore,
    listAfter: stateBreak.list,
    stateBreak,
    canaryOk: canaryResult.ok,
    firstWaveSent: wave.sent,
    snapshotId: snapId,
    killSwitchSQL: "update access_reminder_settings set kill_switch=true, enabled=false, dry_run=true where id=1;",
    revert: `REVERT_ID=${snapId} APPLY=0 node --import tsx --import ./scripts/_react-cache-shim.mjs --env-file=.env.local scripts/qa/ship-legacy-batch-start-amnesty.ts`,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
