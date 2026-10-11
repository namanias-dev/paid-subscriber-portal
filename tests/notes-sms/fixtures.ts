import { notesApprovedByKey, notesCanonicalRow, type NotesTemplateKey } from "../../lib/sms/notesApproved";
import type {
  NotesOrderFacts,
  NotesPaymentFacts,
  NotesLeadFacts,
  NotesTemplateContext,
  OrderPlanInput,
  LeadPlanInput,
} from "../../lib/store/sms/plan";

/** 11:30 IST — inside every send window. */
export const NOW = new Date("2026-10-11T06:00:00.000Z");

export function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

export function ctxFor(key: NotesTemplateKey, extra: Partial<NotesTemplateContext> = {}): NotesTemplateContext {
  const t = notesApprovedByKey(key)!;
  return { row: notesCanonicalRow(t), promoCodeProblem: null, ...extra };
}

export function paidOrder(over: Partial<NotesOrderFacts> = {}): NotesOrderFacts {
  return {
    id: "ord-a",
    order_no: "NIAS-N-2026-000101",
    status: "PROCESSING",
    phone: "9876543210",
    phone_key: "9876543210",
    customer_name: "Asha",
    total_paise: 249900,
    amount_paid_paise: 249900,
    amount_refunded_paise: 0,
    paid_at: hoursAgo(1),
    created_at: hoursAgo(2),
    ...over,
  };
}

export function captured(over: Partial<NotesPaymentFacts> = {}): NotesPaymentFacts {
  return { id: "pay-a", status: "CAPTURED", amount_paise: 249900, captured_at: hoursAgo(1), created_at: hoursAgo(2), ...over };
}

export function confirmInput(over: Partial<OrderPlanInput> = {}): OrderPlanInput {
  return {
    templateKey: "NOTES_ORDER_CONFIRMED_01",
    ctx: ctxFor("NOTES_ORDER_CONFIRMED_01"),
    order: paidOrder(),
    items: [{ sku: "NOTES-POLITY", qty: 1 }],
    payments: [captured()],
    siblings: [],
    history: [],
    now: NOW,
    ...over,
  };
}

export function unpaidOrder(over: Partial<NotesOrderFacts> = {}): NotesOrderFacts {
  return paidOrder({
    id: "ord-p",
    order_no: "NIAS-N-2026-000102",
    status: "PAYMENT_FAILED",
    total_paise: 299900,
    amount_paid_paise: 0,
    paid_at: null,
    created_at: hoursAgo(3),
    ...over,
  });
}

export function pendingInput(over: Partial<OrderPlanInput> = {}): OrderPlanInput {
  return {
    templateKey: "NOTES_PAYMENT_PENDING_01",
    ctx: ctxFor("NOTES_PAYMENT_PENDING_01"),
    order: unpaidOrder(),
    items: [{ sku: "NOTES-ECONOMY", qty: 1 }],
    payments: [{ id: "pay-p", status: "FAILED", amount_paise: 299900, captured_at: null, created_at: hoursAgo(3) }],
    siblings: [],
    history: [],
    now: NOW,
    ...over,
  };
}

export function abandonedLead(over: Partial<NotesLeadFacts> = {}): NotesLeadFacts {
  return {
    id: "lead-1",
    phone: "9123456780",
    phone_key: "9123456780",
    checkout_stage: "CHECKOUT_ABANDONED",
    sales_status: "NEW",
    marketing_consent: true,
    order_id: null,
    is_test: false,
    redacted_at: null,
    last_activity_at: hoursAgo(2),
    created_at: hoursAgo(3),
    ...over,
  };
}

export function leadInput(key: NotesTemplateKey, over: Partial<LeadPlanInput> = {}): LeadPlanInput {
  return {
    templateKey: key,
    ctx: ctxFor(key),
    lead: abandonedLead(),
    phoneOrders: [],
    history: [],
    now: NOW,
    ...over,
  };
}
