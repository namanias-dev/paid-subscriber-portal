import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canAccessLecture } from "../../lib/entitlements";
import { decideContentBatchScope, filterContentByBatchScope } from "../../lib/contentBatchScope";
import type { ContentItem, Course, CourseEnrollment } from "../../lib/types";

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

describe("batch-scoped lecture access", () => {
  test("morning student blocked from evening-scoped recording", () => {
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
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "wrong_batch");
  });

  test("morning student keeps morning-scoped + unscoped recordings", () => {
    const morning = canAccessLecture(
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
    assert.equal(morning.allowed, true);

    const shared = canAccessLecture(
      learner,
      {
        id: "hist-1",
        course_id: "co-safalta-old",
        course_ids: ["co-safalta-old"],
        visibility: "enrolled",
        batch_ids: null,
      },
      { courses: [course], enrollments: [enr({})], overrides: [] },
    );
    assert.equal(shared.allowed, true);
  });

  test("ambiguous enrolment fail-opens (does not blank portal)", () => {
    const d = decideContentBatchScope({
      item: {
        id: "geo-1",
        course_id: "co-safalta-old",
        course_ids: ["co-safalta-old"],
        visibility: "enrolled",
        batch_ids: [eveningId],
      },
      enrollments: [enr({ batch_id: null, batch_label: null })],
      courses: [course],
      phone: "999",
    });
    assert.equal(d.allow, true);
    assert.equal(d.failOpen, true);
  });

  test("multi-enrolment union sees both batches", () => {
    const items = [
      { id: "a", type: "recording", title: "Polity", subject: "Polity", course_id: "co-safalta-old", course_ids: ["co-safalta-old"], batch_ids: [morningId], is_published: true, created_at: "", description: null, drive_link: null, youtube_link: null, date: null, duration: null, paper: null, drip_date: null },
      { id: "b", type: "recording", title: "Geo", subject: "Geography", course_id: "co-safalta-old", course_ids: ["co-safalta-old"], batch_ids: [eveningId], is_published: true, created_at: "", description: null, drive_link: null, youtube_link: null, date: null, duration: null, paper: null, drip_date: null },
    ] as ContentItem[];
    const filtered = filterContentByBatchScope(items, {
      courses: [course],
      enrollments: [
        enr({ id: "m", batch_id: morningId }),
        enr({ id: "e", batch_id: eveningId, batch_label: "Online · Evening" }),
      ],
      phone: "8219451749",
    });
    assert.equal(filtered.length, 2);
  });
});
