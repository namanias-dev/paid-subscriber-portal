import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canAccessLecture } from "../../lib/entitlements";
import type { Course, CourseEnrollment } from "../../lib/types";

const morningId = "b-safalta-june-2026-old-online-morning";
const eveningId = "b-safalta-june-2026-old-online-evening";

const course: Course = {
  id: "co-safalta-old",
  slug: "safalta-june-old",
  title: "Safalta June 2026 (Old)",
  price: 27000,
  created_at: "2026-01-01T00:00:00.000Z",
  entitlements: { recorded: true },
  batches: [
    { id: morningId, label: "Online · Morning", mode: "Online", timing: "Morning", price: 27000 },
    { id: eveningId, label: "Online · Evening", mode: "Online", timing: "Evening", price: 27000 },
  ],
} as Course;

const otherCourse: Course = {
  id: "co-other",
  slug: "other",
  title: "Other Course",
  price: 1000,
  created_at: "2026-01-01T00:00:00.000Z",
  entitlements: { recorded: true },
} as Course;

function enr(over: Partial<CourseEnrollment>): CourseEnrollment {
  return {
    id: over.id || "e1",
    phone: "8219451749",
    student_name: "Saubhagya",
    course_id: "co-safalta-old",
    course_slug: "safalta-june-old",
    course_title: "Safalta June 2026 (Old)",
    plan_type: "full",
    total_fee: 27000,
    amount_paid: 27000,
    installment_count: 1,
    status: "fully_paid",
    schedule: [],
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    batch_id: morningId,
    batch_label: "Online · Morning",
    ...over,
  } as CourseEnrollment;
}

const learner = {
  studentId: "s1",
  phone: "8219451749",
  name: "Saubhagya",
  email: null,
  courseIds: ["co-safalta-old"],
  hasPlan: false,
  blocked: false,
  kind: "buyer" as const,
};

describe("course-scoped lecture access (cross-batch restored)", () => {
  test("morning student can play evening-tagged recording on same course", () => {
    const access = canAccessLecture(
      learner,
      {
        id: "geo-1",
        course_id: "co-safalta-old",
        course_ids: ["co-safalta-old"],
        visibility: "enrolled",
        batch_ids: [eveningId],
      },
      { courses: [course], enrollments: [enr({})], overrides: [] },
    );
    assert.equal(access.allowed, true);
  });

  test("batch_ids metadata does not block morning-scoped recording either", () => {
    const access = canAccessLecture(
      learner,
      {
        id: "pol-1",
        course_id: "co-safalta-old",
        course_ids: ["co-safalta-old"],
        visibility: "enrolled",
        batch_ids: [morningId],
      },
      { courses: [course], enrollments: [enr({})], overrides: [] },
    );
    assert.equal(access.allowed, true);
  });

  test("other-course recording still blocked (course isolation)", () => {
    const access = canAccessLecture(
      learner,
      {
        id: "other-1",
        course_id: "co-other",
        course_ids: ["co-other"],
        visibility: "enrolled",
        batch_ids: null,
      },
      { courses: [course, otherCourse], enrollments: [enr({})], overrides: [] },
    );
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "not_enrolled");
  });
});
