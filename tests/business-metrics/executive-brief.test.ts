import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Payment } from "../../lib/types";
import {
  collectionsReconcile,
  computeCollections,
  computePeople,
  istDayWindow,
  istMonthToDateWindow,
} from "../../lib/analytics/businessMetrics";
import { webinarRegistrationReport } from "../../lib/webinarReg";
import { REPORTING_CHANNEL_DESCRIPTION, reportingDefinitionsHtml } from "../../lib/telegram/reports/definitionCopy";
import {
  genuineLoginKey,
  legacyTrendLoginKey,
  meanDailyUniques,
  trackedDayAverage,
  uniqueLoginsOnDay,
  type LoginHit,
} from "../../lib/analytics/loginIdentity";
import {
  computeSmsDelivery,
  smsDeliveryReconciles,
  smsTemplateLabel,
} from "../../lib/analytics/smsDelivery";
import {
  digestSnapshotSlot,
  executiveBriefLines,
  packTelegramMessages,
  shortCourseTitle,
} from "../../lib/telegram/reports/businessFormat";

const DAY = istDayWindow("2026-09-23");
const YDAY = istDayWindow("2026-09-22");
const AT = "2026-09-22T20:00:00.000Z"; // 23 Sep 2026, 01:30 IST

function pay(partial: Partial<Payment> & Pick<Payment, "id" | "phone" | "amount" | "status">): Payment {
  return {
    student_name: "Student",
    item: "GS Foundation",
    item_type: "course",
    razorpay_payment_id: null,
    mode: null,
    created_at: AT,
    payment_kind: "full",
    status: "PAID",
    ...partial,
  } as Payment;
}

describe("source and purpose stay separate partitions of cash received", () => {
  const none = new Set<string>();

  test("seat booking, staff installment and online installment each land once", () => {
    const rows = [
      pay({
        id: "seat",
        phone: "9000000101",
        amount: 2000,
        payment_kind: "seat",
        total_amount: 75000,
        gateway: "ICICI_EAZYPAY",
      }),
      pay({
        id: "manual",
        phone: "9000000101",
        amount: 30000,
        payment_kind: "installment",
        installment_no: 1,
        gateway: "offline",
        payment_source: "admin_offline",
        payment_mode: "Cash",
        recorded_by: "admin",
      }),
      pay({
        id: "online",
        phone: "9000000102",
        amount: 10000,
        payment_kind: "installment",
        installment_no: 1,
        gateway: "ICICI_EAZYPAY",
      }),
    ];
    const m = computeCollections(rows, DAY, none);
    assert.equal(m.grossCollection, 42000);
    assert.equal(m.netCollection, 42000);
    assert.equal(m.successfulPayments, 3);
    assert.equal(m.payingStudents, 2);
    assert.equal(m.sources.find((s) => s.key === "online")?.amount, 12000);
    assert.equal(m.sources.find((s) => s.key === "manual")?.amount, 30000);
    assert.equal(m.sources.find((s) => s.key === "other")?.amount, 0);
    assert.equal(m.categories.find((c) => c.key === "seat")?.amount, 2000);
    assert.equal(m.categories.find((c) => c.key === "installment")?.amount, 40000);
    const sourceSum = m.sources.reduce((a, s) => a + s.amount, 0);
    const purposeSum = m.categories.reduce((a, c) => a + c.amount, 0);
    assert.equal(sourceSum, 42000);
    assert.equal(purposeSum, 42000);
    assert.notEqual(sourceSum + purposeSum, m.grossCollection);
    const onlineStudents = m.sources.find((s) => s.key === "online")!.students;
    const manualStudents = m.sources.find((s) => s.key === "manual")!.students;
    assert.equal(onlineStudents + manualStudents, 3);
    assert.equal(m.payingStudents, 2);
    assert.equal(collectionsReconcile(m), true);
  });

  test("failed, pending, abandoned and duplicate webhook do not collect", () => {
    const m = computeCollections(
      [
        pay({ id: "fail", phone: "9000000201", amount: 20000, status: "FAILED", gateway: "ICICI_EAZYPAY" }),
        pay({ id: "pend", phone: "9000000202", amount: 30000, status: "PENDING", gateway: "ICICI_EAZYPAY" }),
        pay({ id: "ab", phone: "9000000203", amount: 15000, status: "ABANDONED", gateway: "ICICI_EAZYPAY" }),
        pay({
          id: "dup",
          phone: "9000000204",
          amount: 5000,
          gateway: "ICICI_EAZYPAY",
          duplicate_of_payment_id: "orig",
        }),
        pay({ id: "ok", phone: "9000000204", amount: 5000, gateway: "ICICI_EAZYPAY", payment_kind: "full" }),
      ],
      DAY,
      none,
    );
    assert.equal(m.netCollection, 5000);
    assert.equal(m.successfulPayments, 1);
  });

  test("a reversal reduces net and stays out of the manual gross", () => {
    const m = computeCollections(
      [
        pay({
          id: "cash",
          phone: "9000000301",
          amount: 30000,
          payment_kind: "installment",
          installment_no: 2,
          gateway: "offline",
          payment_source: "admin_offline",
        }),
        pay({
          id: "rev",
          phone: "9000000301",
          amount: -30000,
          payment_kind: "installment",
          installment_no: 2,
          gateway: "offline",
          payment_source: "student_proof_reversal",
          reversal_of_payment_id: "cash",
        }),
      ],
      DAY,
      none,
    );
    assert.equal(m.grossCollection, 30000);
    assert.equal(m.refundAmount, 30000);
    assert.equal(m.netCollection, 0);
    assert.equal(m.sources.find((s) => s.key === "manual")?.amount, 30000);
    assert.equal(collectionsReconcile(m), true);
  });

  test("the same amount twice is two payments when the installment differs", () => {
    const m = computeCollections(
      [
        pay({
          id: "i1",
          phone: "9000000401",
          amount: 5000,
          payment_kind: "installment",
          installment_no: 1,
          gateway: "offline",
          payment_source: "admin_offline",
        }),
        pay({
          id: "i2",
          phone: "9000000401",
          amount: 5000,
          payment_kind: "installment",
          installment_no: 2,
          gateway: "offline",
          payment_source: "admin_offline",
        }),
      ],
      DAY,
      none,
    );
    assert.equal(m.netCollection, 10000);
    assert.equal(m.successfulPayments, 2);
    assert.equal(m.payingStudents, 1);
  });

  test("a receipt is counted on its created_at day, including a backdated entry", () => {
    const rows = [
      pay({
        id: "back",
        phone: "9000000501",
        amount: 8000,
        created_at: "2026-09-21T20:00:00.000Z",
        gateway: "offline",
        payment_source: "admin_offline",
        payment_kind: "installment",
        installment_no: 1,
      }),
    ];
    assert.equal(computeCollections(rows, DAY, none).netCollection, 0);
    assert.equal(computeCollections(rows, YDAY, none).netCollection, 8000);
    const mtd = computeCollections(rows, istMonthToDateWindow("2026-09-23"), none);
    assert.equal(mtd.netCollection, 8000);
  });
});

describe("login identity — the 51 versus 58 split", () => {
  test("phone-first unique logins drop staff and collapse two buyer ids", () => {
    const hits: LoginHit[] = [];
    for (let i = 1; i <= 48; i++) {
      hits.push({
        at: AT,
        phone: `9000001${String(i).padStart(3, "0")}`,
        buyerId: `buyer-${i}`,
      });
    }
    for (let i = 1; i <= 3; i++) {
      const phone = `900000200${i}`;
      hits.push({ at: AT, phone, buyerId: `split-a-${i}` });
      hits.push({ at: AT, phone, buyerId: `split-b-${i}` });
    }
    const staff = ["9000000091", "9000000092", "9000000093", "9000000094"];
    staff.forEach((phone, i) => hits.push({ at: AT, phone, buyerId: `staff-${i}` }));

    const excluded = { phones: new Set(staff), buyerIds: new Set<string>(), studentIds: new Set<string>() };
    const legacy = new Set(hits.map((h) => legacyTrendLoginKey(h)).filter(Boolean));
    const genuine = new Set(hits.map((h) => genuineLoginKey(h, excluded)).filter(Boolean));
    assert.equal(legacy.size, 58);
    assert.equal(genuine.size, 51);
    assert.equal(uniqueLoginsOnDay(hits, "2026-09-23", excluded), 51);
  });

  test("30-day average includes quiet days; tracked average does not include today or pre-tracking zeros", () => {
    const quiet = Array.from({ length: 29 }, () => 0);
    assert.equal(meanDailyUniques([...quiet, 30]), 1);
    assert.equal(trackedDayAverage([0, 30]), 30);
    assert.equal(trackedDayAverage([]), null);
    const boundary = uniqueLoginsOnDay(
      [
        { at: "2026-09-20T18:29:00.000Z", phone: "9000001111" },
        { at: "2026-09-20T18:30:00.000Z", phone: "9000002222" },
      ],
      "2026-09-21",
      { phones: new Set(), buyerIds: new Set(), studentIds: new Set() },
    );
    assert.equal(boundary, 1);
  });
});

describe("sms delivery cohort", () => {
  test("delivered, failed, pending, queued, retry and duplicate callback reconcile", () => {
    const rows = [
      { id: "1", status: "DELIVERED", templateName: "Payment Successful", mobile: "9811111111", createdAt: AT, dedupeKey: "a" },
      { id: "2", status: "FAILED", templateName: "Payment Successful", mobile: "9822222222", createdAt: AT, dedupeKey: "b" },
      { id: "3", status: "SENT", templateName: "Welcome / First Login", mobile: "9833333333", createdAt: AT, dedupeKey: "c" },
      { id: "4", status: "UNKNOWN", templateName: "Welcome / First Login", mobile: "9844444444", createdAt: AT, dedupeKey: "d" },
      { id: "5", status: "QUEUED", templateName: "Portal Access Expiring", mobile: "9855555555", createdAt: AT, dedupeKey: "e" },
      { id: "6", status: "FAILED", templateName: "Payment Successful", mobile: "9866666666", createdAt: AT, dedupeKey: "retry-1" },
      { id: "7", status: "DELIVERED", templateName: "Payment Successful", mobile: "9866666666", createdAt: AT, dedupeKey: "retry-2" },
      { id: "8", status: "DELIVERED", templateName: "Payment Successful", mobile: "9877777777", createdAt: AT, dedupeKey: "same" },
      { id: "9", status: "SENT", templateName: "Payment Successful", mobile: "9877777777", createdAt: AT, dedupeKey: "same" },
      { id: "10", status: "FAILED", templateName: null, mobile: "9888888888", createdAt: AT, dedupeKey: "noname" },
      { id: "11", status: "DELIVERED", templateName: "Payment Successful", mobile: "9000000001", createdAt: AT, dedupeKey: "test" },
      { id: "12", status: "DELIVERED", templateName: "Payment Successful", mobile: "9899999999", createdAt: "2026-09-21T10:00:00.000Z", dedupeKey: "yday" },
    ];
    const m = computeSmsDelivery(rows, DAY);
    assert.equal(m.delivered, 3);
    assert.equal(m.failed, 3);
    assert.equal(m.pending, 2);
    assert.equal(m.queued, 1);
    assert.equal(m.sent, 8);
    assert.equal(smsDeliveryReconciles(m), true);
    assert.equal(m.templates.find((t) => t.name === "Unnamed template")?.failed, 1);
    assert.equal(smsTemplateLabel("UPSC_MASTERCLASS_REQUESTED_LINK"), "UPSC Masterclass Requested Link");
    assert.equal(JSON.stringify(m).includes("9811111111"), false);
  });
});

describe("executive brief delivery", () => {
  test("manual snapshot slot does not consume the scheduled slot", () => {
    const scheduled = digestSnapshotSlot("2026-09-23T20:00+05:30", false, 1);
    const manual = digestSnapshotSlot("2026-09-23T20:00+05:30", true, 1);
    assert.equal(scheduled, "2026-09-23T20:00+05:30");
    assert.equal(manual, "2026-09-23T20:00+05:30:manual:1");
    assert.notEqual(scheduled, manual);
  });

  test("one today figure, escaped text, and a second message only when needed", () => {
    const lines = executiveBriefLines({
      dateLabel: "23 September",
      timeLabel: "6:05 PM",
      people: {
        newAccounts: 7,
        uniqueLoginUsers: 51,
        loginEvents: 65,
        activeUsers: 102,
        returningActiveUsers: 98,
        newUsersActive: 4,
      },
      login: {
        todayFallback: 58,
        yesterday: 48,
        avg30: 40,
        avg90: 36,
      },
      today: null,
      yesterday: null,
      mtd: null,
      todayAdmissions: null,
      sms: {
        sent: 2,
        delivered: 1,
        failed: 1,
        pending: 0,
        queued: 0,
        templates: [{ name: "Fee <Reminder>", sent: 2, delivered: 1, failed: 1, pending: 0, queued: 0 }],
      },
      webinar: null,
      courses: [],
      outstanding: { overdueCount: 2, overdueAmount: 150000, due7dAmount: 20000 },
      failed: [],
      morningNote: null,
    });
    const html = lines.join("\n");
    assert.match(html, /⚡ <b>KEY HIGHLIGHTS<\/b>/);
    assert.match(html, /👥 Activity: 7 new · 51 logged in · 102 active/);
    assert.match(html, /Unique logins — <b>51<\/b>/);
    assert.equal(/Login Trend[\s\S]*Today/.test(html), false);
    assert.equal(html.includes(">58<"), false);
    assert.match(html, /Yesterday 48 · 30-day avg 40 · 90-day avg 36/);
    assert.match(html, /Fee &lt;Reminder&gt;/);
    assert.equal(html.includes("Manually triggered"), false);
    assert.equal(html.includes("Collected is money received"), false);
    assert.equal(html.includes("Students who signed in"), false);
    assert.equal(packTelegramMessages(lines).length, 1);

    const long = [...lines];
    long.push("📚 <b>COURSE ADMISSIONS</b>");
    long.push("X".repeat(2000));
    long.push("📋 <b>OUTSTANDING FEES</b>");
    long.push("Y".repeat(2000));
    const packed = packTelegramMessages(long, 2500);
    assert.equal(packed.length, 2);
    assert.match(packed[1], /Continued/);
    assert.match(packed[0], /STUDENTS/);
  });

  test("course titles use display aliases and never an ellipsis", () => {
    const original = "Naman IAS Optional Geography Foundation Programme for UPSC Mains";
    const shown = shortCourseTitle(original);
    assert.equal(original.startsWith("Naman IAS"), true);
    assert.equal(shown.includes("Naman IAS"), false);
    assert.equal(shown.includes("…"), false);
    assert.equal(
      shortCourseTitle("Full GS Foundation SAFALTA BATCH For UPSC CSE 2027/28 | September 2026"),
      "GS Foundation — SAFALTA Sep 2026",
    );
    assert.equal(
      shortCourseTitle("Mains Answer Writing Program for UPSC CSE"),
      "Mains Answer Writing Program",
    );
    assert.equal(
      shortCourseTitle("UPSC Modern History Complete Course by Naman Sir"),
      "Modern History",
    );
    assert.equal(shortCourseTitle("Public Administration Optional 2026"), "Public Administration Optional 2026");
    assert.equal(shortCourseTitle("Saarthi (Old)"), "Saarthi (Old)");
  });

  test("highlights count unresolved failures and keep later-paid in the detail", () => {
    const lines = executiveBriefLines({
      dateLabel: "25 September 2026",
      timeLabel: "10:05 PM",
      people: null,
      login: null,
      today: null,
      yesterday: null,
      mtd: null,
      todayAdmissions: { admissions: 0, students: 0, byCourse: [] },
      sms: null,
      webinar: {
        title: "UPSC Full Masterclass by Naman Sir",
        dateLabel: "26 Sept · 4:00 PM",
        registered: 41,
        newToday: 9,
        pendingCheckout: 14,
        attendedLastPct: null,
        sources: [
          { label: "Instagram", count: 18 },
          { label: "Direct", count: 9 },
        ],
      },
      courses: [],
      outstanding: null,
      failed: [
        { name: "Ruthi", amount: 50, item: "Webinar registration — Masterclass", when: "5:27 PM", reason: null, recovered: false },
        { name: "Jyoti", amount: 50, item: "Webinar registration — Masterclass", when: "4:17 PM", reason: null, recovered: true },
      ],
      morningNote: null,
    });
    const html = lines.join("\n");
    assert.match(html, /NAMAN IAS — EXECUTIVE BRIEF/);
    assert.equal(html.includes("Live figures through"), false);
    assert.match(html, /⚠️ Payments: <b>1<\/b> unresolved failure/);
    assert.match(html, /2 failed attempts<\/b> · 1 unresolved/);
    assert.match(html, /<i>Still failed<\/i>/);
    assert.match(html, /<i>Later paid<\/i>/);
    assert.match(html, /Webinar: \+9 today · <b>41<\/b> paid total · 14 pending/);
    assert.match(html, /Instagram 18 · Direct 9/);
    assert.match(html, /No new admissions today/);
    assert.equal(html.includes("981"), false);
  });
});

describe("activity and webinar report definitions", () => {
  test("five sign-ins are one unique login, and portal use without a sign-in is active only", () => {
    const five = computePeople({
      newAccountKeys: [],
      loginEventKeys: ["p:9000000501", "p:9000000501", "p:9000000501", "p:9000000501", "p:9000000501"],
      activityKeys: [],
    });
    assert.equal(five.uniqueLoginUsers, 1);
    assert.equal(five.loginEvents, 5);
    const continued = computePeople({
      newAccountKeys: [],
      loginEventKeys: [],
      activityKeys: ["p:9000000502"],
    });
    assert.equal(continued.uniqueLoginUsers, 0);
    assert.equal(continued.activeUsers, 1);
    assert.equal(continued.returningActiveUsers, 1);
  });

  test("a staff copy of an online receipt is not collected twice", () => {
    const m = computeCollections(
      [
        pay({ id: "gw", phone: "9000000601", amount: 2000, payment_kind: "seat", gateway: "ICICI_EAZYPAY" }),
        pay({
          id: "staff-copy",
          phone: "9000000601",
          amount: 2000,
          payment_kind: "seat",
          gateway: "offline",
          payment_source: "admin_offline",
          duplicate_of_payment_id: "gw",
        }),
      ],
      DAY,
      new Set(),
    );
    assert.equal(m.netCollection, 2000);
    assert.equal(m.sources.find((s) => s.key === "online")?.amount, 2000);
    assert.equal(m.sources.find((s) => s.key === "manual")?.amount, 0);
    assert.equal(collectionsReconcile(m), true);
  });

  test("webinar new-today is the first paid seat, with the stored source", () => {
    const slug = "masterclass";
    const rows = [
      pay({
        id: "old",
        phone: "9811111111",
        amount: 50,
        item_type: "webinar",
        item_slug: slug,
        attribution_source: "instagram",
        created_at: "2026-09-22T04:00:00.000Z",
      }),
      pay({
        id: "old-again",
        phone: "9811111111",
        amount: 50,
        item_type: "webinar",
        item_slug: slug,
        attribution_source: "direct",
        created_at: AT,
      }),
      pay({
        id: "new",
        phone: "9822222222",
        amount: 50,
        item_type: "webinar",
        item_slug: slug,
        attribution_source: "fb",
        created_at: AT,
      }),
      pay({
        id: "blank",
        phone: "9833333333",
        amount: 50,
        item_type: "webinar",
        item_slug: slug,
        attribution_source: "",
        created_at: AT,
      }),
    ];
    const report = webinarRegistrationReport(rows, slug, "2026-09-23");
    assert.equal(report.paidTotal, 3);
    assert.equal(report.paidToday, 2);
    assert.equal(report.hasAttribution, true);
    assert.equal(report.sources.find((s) => s.label === "Instagram")?.count, 1);
    assert.equal(report.sources.find((s) => s.label === "Facebook")?.count, 1);
    assert.equal(report.sources.find((s) => s.label === "Unknown")?.count, 1);
    assert.equal(report.sources.some((s) => s.label === "Meta Ads"), false);
  });

  test("definitions stay within the channel description limit", () => {
    assert.ok(REPORTING_CHANNEL_DESCRIPTION.length <= 255);
    assert.match(reportingDefinitionsHtml(), /actual money received/i);
    assert.match(reportingDefinitionsHtml(), /90 complete IST days/);
    assert.equal(reportingDefinitionsHtml().includes("Meta Ads"), false);
  });
});
