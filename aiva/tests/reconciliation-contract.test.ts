import { describe, it, expect } from "vitest";
import { isPaidStatus, dedupedPaidTotal, dedupePaidRows } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment } from "@portal/lib/installments";

/**
 * Contract tests: AIVA reuses the portal's reconciliation primitives as its single source of
 * truth. These pin the behaviour AIVA depends on. If the portal changes these rules, this test
 * (and the codebase-intelligence registry) must be updated deliberately.
 */
describe("reused reconciliation primitives (single source of truth)", () => {
  it("only PAID/captured count as paid", () => {
    expect(isPaidStatus("PAID")).toBe(true);
    expect(isPaidStatus("captured")).toBe(true);
    expect(isPaidStatus("INITIATED")).toBe(false);
    expect(isPaidStatus("PENDING")).toBe(false);
    expect(isPaidStatus("ABANDONED")).toBe(false);
    expect(isPaidStatus("VERIFYING")).toBe(false);
    expect(isPaidStatus(null as never)).toBe(false);
  });

  it("dedupes duplicate paid attempts for the same obligation", () => {
    const rows: any[] = [
      { id: "a", phone: "9876543210", item_type: "course", item: "Safalta", item_slug: "safalta", payment_kind: "seat", installment_no: 0, status: "PAID", amount: 5000, created_at: "2026-01-01" },
      { id: "b", phone: "9876543210", item_type: "course", item: "Safalta", item_slug: "safalta", payment_kind: "seat", installment_no: 0, status: "PAID", amount: 5000, created_at: "2026-01-02" },
    ];
    const deduped = dedupePaidRows(rows as any);
    expect(deduped.length).toBe(1);
    expect(dedupedPaidTotal(rows as any)).toBe(5000);
  });

  it("detects overdue installments and active enrollment", () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const enr: any = {
      total_fee: 20000,
      amount_paid: 5000,
      status: "partially_paid",
      schedule: [
        { no: 0, kind: "seat", label: "Seat", amount: 5000, due: null, paid: true },
        { no: 1, kind: "installment", label: "Installment 1", amount: 15000, due: past, paid: false },
      ],
    };
    const d = deriveEnrollment(enr);
    expect(d.paid).toBe(5000);
    expect(d.remaining).toBe(15000);
    expect(d.hasOverdue).toBe(true);
    expect(isActiveEnrollment(enr)).toBe(true);
  });

  it("treats a zero-paid pending enrollment as an attempt, not active", () => {
    expect(isActiveEnrollment({ status: "pending", amount_paid: 0 } as any)).toBe(false);
  });
});
