/**
 * The Notes send path end to end in demo mode (no database), with global fetch
 * stubbed. Every assertion is on the outbound gateway call, so this suite
 * cannot itself send an SMS.
 */
import { describe, test, beforeEach, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { buildAndValidateNotesOrderSms, type NotesSmsPlan } from "../../lib/store/sms/plan";
import { notesApprovedByKey, notesRendererVars } from "../../lib/sms/notesApproved";
import { captured, confirmInput, hoursAgo, paidOrder, pendingInput } from "./fixtures";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SMS_ENABLED = "true";

type Service = typeof import("../../lib/sms/service");
type Send = typeof import("../../lib/store/sms/send");
type Gateway = typeof import("../../lib/sms/gateway");
let service: Service;
let sender: Send;
let gateway: Gateway;

const realFetch = globalThis.fetch;
let calls: URLSearchParams[] = [];
let phoneSeq = 0;

before(async () => {
  service = await import("../../lib/sms/service");
  sender = await import("../../lib/store/sms/send");
  gateway = await import("../../lib/sms/gateway");
});

beforeEach(() => {
  calls = [];
  process.env.SMS_API_AUTH_KEY = "test-key";
  process.env.SMS_API_USERNAME = "test-user";
  process.env.SMS_API_PASSWORD = "test-pass";
  globalThis.fetch = (async (url: unknown) => {
    calls.push(new URL(String(url)).searchParams);
    return new Response("Submitted Successfully | 123456789", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fresh phone per test so the per-phone guards of earlier tests do not interfere. */
function freshConfirmPlan(over: { amount?: number } = {}): NotesSmsPlan {
  phoneSeq += 1;
  const phone = `98${String(10000000 + phoneSeq).slice(-8)}`;
  const amount = over.amount ?? 249900;
  return buildAndValidateNotesOrderSms(
    confirmInput({
      order: paidOrder({ id: `ord-${phoneSeq}`, phone, phone_key: phone, total_paise: amount, amount_paid_paise: amount }),
      payments: [captured({ id: `pay-${phoneSeq}`, amount_paise: amount })],
    }),
  );
}

const flagOn = async () => true;

describe("gateway payload", () => {
  test("order confirmed: exact text, DLT id, sender, route, 10-digit number, no unicode flag", async () => {
    const plan = freshConfirmPlan();
    assert.equal(plan.ok, true, plan.blockers.join(","));
    const out = await sender.sendNotesPlan(plan, { mode: "auto", sentBy: { type: "SYSTEM" }, reload: async () => plan, smsFlagEnabled: flagOn });
    assert.equal(out.status, "submitted", out.reason || "");
    assert.equal(calls.length, 1);
    const p = calls[0];
    assert.equal(p.get("message"), plan.text);
    assert.equal(p.get("templateid"), "1777179058711611732");
    assert.equal(p.get("senderid"), "NAMIAS");
    assert.equal(p.get("route"), "12");
    assert.equal(p.get("number"), plan.destination.digits10);
    assert.match(p.get("number")!, /^[6-9]\d{9}$/);
    assert.equal(p.get("unicode"), null);
    assert.ok(!/[{}]/.test(p.get("message")!));
  });

  test("payment pending: exact text and DLT id", async () => {
    phoneSeq += 1;
    const phone = `97${String(10000000 + phoneSeq).slice(-8)}`;
    const base = pendingInput();
    const plan = buildAndValidateNotesOrderSms({ ...base, order: { ...base.order!, id: `ord-p-${phoneSeq}`, phone, phone_key: phone } });
    assert.equal(plan.ok, true, plan.blockers.join(","));
    const out = await sender.sendNotesPlan(plan, { mode: "auto", sentBy: { type: "SYSTEM" }, reload: async () => plan, smsFlagEnabled: flagOn });
    assert.equal(out.status, "submitted", out.reason || "");
    assert.equal(calls[0].get("templateid"), "1777179057396343991");
    assert.equal(calls[0].get("message"), plan.text);
  });

  for (const key of ["NOTES_CHECKOUT_INCOMPLETE_01", "NOTES_NEW_LEAD_PROMO_01", "NOTES_DISCOUNT_NOTES500_01"] as const) {
    test(`${key} cannot reach the gateway while held`, async () => {
      const t = notesApprovedByKey(key)!;
      const text = t.approvedText.replace("{#urg#}", "https://www.namanias.com/notes");
      const res = await gateway.sendViaGateway({ digits10: "9876500000", message: text, templateId: t.dltTemplateId });
      assert.equal(res.ok, false);
      assert.equal(calls.length, 0);
    });
  }
});

describe("idempotency", () => {
  test("4 payment callbacks + 2 cron passes for one order submit one SMS", async () => {
    const plan = freshConfirmPlan();
    const opts = { sentBy: { type: "SYSTEM" as const }, reload: async () => plan, smsFlagEnabled: flagOn };
    const outcomes = await Promise.all([
      ...Array.from({ length: 4 }, () => sender.sendNotesPlan(plan, { ...opts, mode: "auto" })),
      ...Array.from({ length: 2 }, () => sender.sendNotesPlan(plan, { ...opts, mode: "auto", enforceWindow: true })),
    ]);
    assert.equal(calls.length, 1, "a duplicate trigger reached the gateway");
    assert.equal(outcomes.filter((o) => o.status === "submitted").length, 1);
  });

  test("a manual send after an automatic one is refused", async () => {
    const plan = freshConfirmPlan();
    const opts = { sentBy: { type: "SYSTEM" as const }, reload: async () => plan, smsFlagEnabled: flagOn };
    await sender.sendNotesPlan(plan, { ...opts, mode: "auto" });
    const manual = await sender.sendNotesPlan(plan, { ...opts, mode: "manual", sentBy: { type: "ADMIN", userId: "u1" } });
    assert.equal(manual.status, "skipped");
    assert.equal(manual.reason, "already_sent");
    assert.equal(calls.length, 1);
  });
});

describe("race and re-validation", () => {
  test("payment captured between plan and send suppresses the pending SMS", async () => {
    const plan = buildAndValidateNotesOrderSms(pendingInput());
    assert.equal(plan.ok, true);
    const reload = async () =>
      buildAndValidateNotesOrderSms(
        pendingInput({
          order: { ...pendingInput().order!, status: "PROCESSING", paid_at: hoursAgo(0), amount_paid_paise: 299900 },
          payments: [{ id: "pay-p", status: "CAPTURED", amount_paise: 299900, captured_at: hoursAgo(0), created_at: hoursAgo(3) }],
        }),
      );
    const out = await sender.sendNotesPlan(plan, { mode: "auto", sentBy: { type: "SYSTEM" }, reload, smsFlagEnabled: flagOn });
    assert.equal(out.status, "skipped");
    assert.equal(calls.length, 0);
  });

  test("a different destination on reload is refused (changed_before_send)", async () => {
    const plan = freshConfirmPlan();
    const other = freshConfirmPlan();
    const out = await sender.sendNotesPlan(plan, { mode: "manual", sentBy: { type: "ADMIN" }, reload: async () => other, smsFlagEnabled: flagOn });
    assert.equal(out.reason, "changed_before_send");
    assert.equal(calls.length, 0);
  });

  test("the store flag off sends nothing", async () => {
    const plan = freshConfirmPlan();
    const out = await sender.sendNotesPlan(plan, { mode: "auto", sentBy: { type: "SYSTEM" }, reload: async () => plan });
    assert.equal(out.reason, "notes_store_sms_off");
    assert.equal(calls.length, 0);
  });

  test("a blocked plan sends nothing", async () => {
    const plan = buildAndValidateNotesOrderSms(confirmInput({ payments: [captured({ amount_paise: 299900 })] }));
    const out = await sender.sendNotesPlan(plan, { mode: "manual", sentBy: { type: "ADMIN" }, reload: async () => plan, smsFlagEnabled: flagOn });
    assert.equal(out.status, "skipped");
    assert.equal(out.reason, "amount_mismatch");
    assert.equal(calls.length, 0);
  });
});

describe("the generic sender cannot carry a Notes template", () => {
  const t = notesApprovedByKey("NOTES_ORDER_CONFIRMED_01")!;
  const values = { alp: "Indian Polity", num: "2499", urg: "https://www.namanias.com/notes/track" };

  test("sendSms without the Notes expected body", async () => {
    const res = await service.sendSms({
      mobile: "9811111111",
      templateId: t.id,
      variables: notesRendererVars(t, values),
      sentBy: { type: "ADMIN" },
    });
    assert.equal(res.skipped, "notes_template_requires_notes_path");
    assert.equal(calls.length, 0);
  });

  test("sendSms with client-forged variables that differ from the validated plan", async () => {
    const plan = freshConfirmPlan();
    const res = await service.sendSms({
      mobile: plan.destination.digits10!,
      templateId: t.id,
      variables: notesRendererVars(t, { ...values, num: "1" }),
      sentBy: { type: "ADMIN" },
      notesExpectedBody: plan.text,
    });
    assert.equal(res.skipped, "notes_body_mismatch");
    assert.equal(calls.length, 0);
  });

  test("variable-store defaults cannot override Notes slots", () => {
    const merged = service.mergeSendVars(t.id, { "#alp#": "Hacked", "#num#": "1", "#urg#": "https://evil.example" }, notesRendererVars(t, values));
    assert.equal(merged["#alp#"], "Indian Polity");
    assert.equal(merged["#num#"], "2499");
    assert.equal(merged["#urg#"], "https://www.namanias.com/notes/track");
  });

  test("sendBatch refuses a Notes template outright", async () => {
    const res = await service.sendBatch({
      recipients: [{ mobile: "9822222222", variables: notesRendererVars(t, values) }],
      templateId: t.id,
      sentBy: { type: "ADMIN" },
    } as Parameters<Service["sendBatch"]>[0]);
    assert.equal(res.abortReason, "notes_template_requires_notes_path");
    assert.equal(calls.length, 0);
  });

  test("bulk gateway refuses any Notes DLT id", async () => {
    const res = await gateway.sendBulkViaGateway({
      digits10List: ["9833333333", "9844444444"],
      message: "Thank you! Your Indian Polity Notes order is confirmed. Rs.2499 payment received. Track: https://www.namanias.com/notes/track Naman Sharma IAS Academy.",
      templateId: t.dltTemplateId,
    });
    assert.equal(res.response.error, "blocked:notes_template_bulk");
    assert.equal(calls.length, 0);
  });

  test("resend of a Notes log is refused", async () => {
    const { resolveResendMessage } = await import("../../lib/sms/resendBody");
    const r = await resolveResendMessage({ template_id: t.id } as Parameters<typeof resolveResendMessage>[0]);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.skip, "notes_resend_requires_notes_path");
  });
});
