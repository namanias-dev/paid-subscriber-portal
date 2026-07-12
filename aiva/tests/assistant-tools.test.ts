import { describe, it, expect, beforeEach, vi } from "vitest";
import { isPaidStatus, dedupePaidRows, dedupedPaidTotal } from "@portal/lib/paymentsAgg";
import { inr } from "@/lib/revenue/dailyBrief";
import { clearMemo } from "@/lib/cache";

/**
 * Tool RECONCILIATION contract: the data tools must produce the SAME numbers as the portal's
 * truth primitives (isPaidStatus / dedupePaidRows / deriveEnrollment). We feed a fixed dataset
 * through a mocked data layer and assert every headline figure ties out exactly.
 */

const fx = vi.hoisted(() => {
  const now = Date.now();
  const day = 86_400_000;
  const isoH = (ms: number) => new Date(ms).toISOString();
  const payments: any[] = [
    { id: "p1a", phone: "9000000001", item_type: "course", item: "Safalta", item_slug: "safalta", payment_kind: "seat", installment_no: 0, status: "PAID", amount: 5000, created_at: isoH(now - 2 * day) },
    { id: "p1b", phone: "9000000001", item_type: "course", item: "Safalta", item_slug: "safalta", payment_kind: "seat", installment_no: 0, status: "PAID", amount: 5000, created_at: isoH(now - 1 * day) },
    { id: "p2", phone: "9000000002", item_type: "course", item: "GS", item_slug: "gs", payment_kind: "seat", installment_no: 0, status: "PAID", amount: 10000, created_at: isoH(now - 3 * day) },
    { id: "p3", phone: "9000000003", item_type: "course", item: "GS", item_slug: "gs", payment_kind: "seat", installment_no: 0, status: "ABANDONED", amount: 4000, created_at: isoH(now - 4 * day) },
    { id: "p4", phone: "9000000004", item_type: "course", item: "GS", item_slug: "gs", payment_kind: "seat", installment_no: 0, status: "INITIATED", amount: 9999, created_at: isoH(now - 1 * day) },
  ];
  const enrollments: any[] = [
    {
      id: "e1", student_name: "Test Student", phone: "9000000002", course_id: "c1", course_title: "GS", batch_label: "GS 2027", batch_id: null,
      status: "partially_paid", amount_paid: 5000, total_fee: 20000, created_at: isoH(now - 40 * day),
      schedule: [
        { no: 0, kind: "seat", label: "Seat", amount: 5000, paid: true, paid_amount: 5000, due: null },
        { no: 1, kind: "installment", label: "Inst 1", amount: 15000, paid: false, paid_amount: 0, due: isoH(now - 20 * day) },
      ],
    },
  ];
  return { payments, enrollments };
});

vi.mock("@/lib/data", () => ({
  fetchPayments: async () => fx.payments,
  fetchCourseEnrollments: async () => fx.enrollments,
  fetchWebinarRegistrations: async () => [],
  fetchWebinars: async () => [],
  fetchCoursesLite: async () => [],
  fetchSmsForPhones: async () => [],
  fetchStudentIdsByPhone: async () => new Map(),
  fetchStudentsSearch: async () => [],
  fetchProofStatuses: async () => ({}),
  countOpenProofs: async () => 0,
}));

import { getCollectionsSummary, getRevenueAging, getOverdueStudents } from "@/lib/assistant/tools";

beforeEach(() => clearMemo());

const paidTruth = dedupedPaidTotal(dedupePaidRows(fx.payments.filter((p) => isPaidStatus(p.status))));

describe("getCollectionsSummary reconciles to the Payments tab", () => {
  it("all-time collected equals dedupedPaidTotal of the fixtures", async () => {
    const r = await getCollectionsSummary("week", true);
    const allTime = r.figures.find((f) => f.label === "All-time collected");
    expect(allTime?.value).toBe(inr(paidTruth)); // 15,000
    expect(paidTruth).toBe(15000);
  });
});

describe("getRevenueAging reconciles overdue + abandoned", () => {
  it("bucket totals match the tower math", async () => {
    const r = await getRevenueAging();
    expect(r.figures.find((f) => f.label === "Overdue 8+d")?.value).toBe(`1 · ${inr(15000)}`);
    expect(r.figures.find((f) => f.label === "Abandoned")?.value).toBe(`1 · ${inr(4000)}`);
    expect(r.figures.find((f) => f.label === "At-risk total")?.value).toBe(inr(19000));
    expect(r.headline).toContain(inr(19000));
  });
});

describe("getOverdueStudents(15) finds the deep-overdue line", () => {
  it("counts exactly the 20-day-overdue installment and its amount", async () => {
    const r = await getOverdueStudents(15);
    expect(r.figures.find((f) => f.label === "Overdue 15+ days")?.value).toBe("1");
    expect(r.figures.find((f) => f.label === "Amount unpaid")?.value).toBe(inr(15000));
    expect(r.rowsTotal).toBe(1);
  });
});
