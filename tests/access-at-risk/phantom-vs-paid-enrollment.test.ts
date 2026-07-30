import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canAccessLecture } from "../../lib/entitlements";
import type { Course, CourseEnrollment } from "../../lib/types";

const course: Course = {
  id: "co-safalta",
  slug: "safalta-online-foundation",
  title: "Safalta",
  price: 40000,
  created_at: "2026-01-01T00:00:00.000Z",
  entitlements: { recorded: true },
} as Course;

function enr(over: Partial<CourseEnrollment>): CourseEnrollment {
  return {
    id: over.id || "e1",
    phone: "8490085511",
    student_name: "M Kashish",
    course_id: "co-safalta",
    course_slug: "safalta-online-foundation",
    course_title: "Safalta",
    plan_type: "emi",
    total_fee: 40000,
    amount_paid: 0,
    installment_count: 1,
    status: "checkout_intent",
    schedule: [],
    created_at: "2026-06-28T06:00:00.000Z",
    updated_at: "2026-06-28T06:00:00.000Z",
    ...over,
  } as CourseEnrollment;
}

describe("canAccessLecture prefers active enrollment over checkout phantom", () => {
  test("fully_paid + older checkout_intent → lectures unlocked (Kashish bug)", () => {
    // Same order getCourseEnrollmentsByPhone returns: newest first.
    const enrollments = [
      enr({
        id: "paid",
        status: "fully_paid",
        amount_paid: 40000,
        created_at: "2026-06-28T07:01:58.000Z",
        schedule: [
          { no: 0, kind: "seat", amount: 2000, due: null, paid: true },
          { no: 1, kind: "installment", amount: 38000, due: "2026-07-05T06:30:00.000Z", paid: true },
        ],
      }),
      enr({
        id: "phantom",
        status: "checkout_intent",
        amount_paid: 0,
        created_at: "2026-06-28T06:59:49.000Z",
        schedule: [
          { no: 0, kind: "seat", amount: 2000, due: null, paid: false },
          { no: 1, kind: "installment", amount: 38000, due: null, paid: false },
        ],
      }),
    ];

    const learner = {
      studentId: null,
      phone: "8490085511",
      name: "M Kashish",
      email: null,
      courseIds: ["co-safalta"],
      hasPlan: false,
      blocked: false,
      kind: "buyer" as const,
    };

    const access = canAccessLecture(
      learner,
      { course_id: "co-safalta", course_ids: ["co-safalta"], visibility: "enrolled" },
      { courses: [course], enrollments, overrides: [] },
    );

    assert.equal(access.allowed, true, "paid student must not be locked by a sibling checkout_intent");
    assert.ok(access.reason === "lifetime" || access.reason === "active");
  });

  test("checkout_intent alone still blocks", () => {
    const access = canAccessLecture(
      {
        studentId: null,
        phone: "9999999999",
        name: "X",
        email: null,
        courseIds: [],
        hasPlan: false,
        blocked: false,
        kind: "buyer",
      },
      { course_id: "co-safalta", course_ids: ["co-safalta"], visibility: "enrolled" },
      {
        courses: [course],
        enrollments: [enr({ id: "only-phantom" })],
        overrides: [],
      },
    );
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "not_enrolled");
  });
});
