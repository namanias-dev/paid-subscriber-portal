import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { distinctRegistrations, isPaidStatus } from "../../lib/paymentsAgg";
import { buildWebinarByDay } from "../../lib/webinarReg";
import { istTodayYMD } from "../../lib/dates";
import type { Payment } from "../../lib/types";

function pay(partial: Partial<Payment> & Pick<Payment, "id" | "status" | "phone" | "item_type">): Payment {
  return {
    amount: 50,
    item: "Webinar",
    item_slug: "test-webinar",
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...partial,
  } as Payment;
}

describe("paid webinar regs — Payments methodology", () => {
  test("counts only PAID/captured distinct phone×item — ignores abandoned/failed", () => {
    const today = new Date().toISOString();
    const rows = [
      pay({ id: "1", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: today }),
      pay({ id: "2", status: "captured", phone: "9222222222", item_type: "webinar", created_at: today }),
      pay({ id: "3", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: today }), // retry same seat
      pay({ id: "4", status: "ABANDONED", phone: "9333333333", item_type: "webinar", created_at: today }),
      pay({ id: "5", status: "FAILED", phone: "9444444444", item_type: "webinar", created_at: today }),
      pay({ id: "6", status: "PAID", phone: "9555555555", item_type: "course", created_at: today }),
    ];
    const paidWeb = rows.filter((p) => isPaidStatus(p.status) && p.item_type === "webinar");
    assert.equal(distinctRegistrations(paidWeb), 2);
  });

  test("buildWebinarByDay matches distinct paid seats for today", () => {
    const today = istTodayYMD();
    const rows = [
      pay({ id: "a", status: "PAID", phone: "9111111111", item_type: "webinar", item_slug: "w1" }),
      pay({ id: "b", status: "PAID", phone: "9222222222", item_type: "webinar", item_slug: "w1" }),
      pay({ id: "c", status: "ABANDONED", phone: "9333333333", item_type: "webinar", item_slug: "w1" }),
    ];
    const map = buildWebinarByDay(rows, "");
    assert.equal(map.get(today), 2);
  });
});
