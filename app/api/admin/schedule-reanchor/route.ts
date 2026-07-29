import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requireAnyPermission, currentAdminId } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses, getCourseEnrollmentById } from "@/lib/dataProvider";
import { previewReanchorEnrollment } from "@/lib/scheduleReanchor";
import { getSupabaseAdmin } from "@/lib/supabase";
import { maskMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * GET — preview-only re-anchoring report. NEVER mutates schedules.
 * POST — apply for a single enrollment behind explicit confirmation.
 *         Left UNUSED at ship; requires confirmApply: true.
 */
export async function GET() {
  if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [enrollments, courses] = await Promise.all([getAllCourseEnrollments(), getAllCourses()]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();
  const previews = enrollments
    .map((e) => previewReanchorEnrollment(e, byId.get(e.course_id), now))
    .filter((p) => p.skipReason == null && p.wouldChange);

  const rupeesOut = previews.reduce((a, p) => a + p.rupeesMovingOutOfMonth, 0);
  return NextResponse.json({
    ok: true,
    mode: "preview",
    wrote: false,
    count: previews.length,
    rupeesMovingOutOfMonth: rupeesOut,
    rows: previews.map((p) => ({
      ...p,
      phone: maskMobile(p.phone),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session || !(await requireAnyPermission(["manage_payments"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.confirmApply !== true) {
    return NextResponse.json({
      ok: false,
      error: "Apply path is gated. Pass confirmApply: true only after human approval. Preview via GET.",
    }, { status: 400 });
  }
  // Ship leaves this unused — still implemented so approval can flip it on later.
  const enrollmentId = String(body.enrollmentId || "");
  if (!enrollmentId) return NextResponse.json({ ok: false, error: "enrollmentId required" }, { status: 400 });

  const enrollment = await getCourseEnrollmentById(enrollmentId);
  if (!enrollment) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === enrollment.course_id);
  const preview = previewReanchorEnrollment(enrollment, course);
  if (preview.skipReason || !preview.wouldChange) {
    return NextResponse.json({ ok: false, error: preview.skipReason || "Nothing to change" }, { status: 400 });
  }

  const before = JSON.stringify(enrollment.schedule);
  const proposedByNo = new Map<number, string>();
  for (const line of preview.lines) {
    if (line.proposedDue && line.kind === "installment" && !line.paid) {
      proposedByNo.set(line.no, line.proposedDue);
    }
  }
  const nextSchedule = (enrollment.schedule || []).map((s) => {
    if (s.kind !== "installment" || s.paid || s.status === "cancelled" || s.status === "waived") return s;
    const due = proposedByNo.get(s.no);
    return due ? { ...s, due } : s;
  });
  // Amounts must be byte-identical.
  const amountBefore = (enrollment.schedule || []).reduce((a, s) => a + (s.amount || 0), 0);
  const amountAfter = nextSchedule.reduce((a, s) => a + (s.amount || 0), 0);
  if (amountBefore !== amountAfter) {
    return NextResponse.json({ ok: false, error: "Amount drift refused" }, { status: 500 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "DB unavailable" }, { status: 500 });
  const actor = session.username || (await currentAdminId()) || "admin";
  const { error } = await db.from("course_enrollments").update({ schedule: nextSchedule }).eq("id", enrollmentId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await db.from("access_override_events").insert({
    phone: enrollment.phone,
    course_id: enrollment.course_id,
    actor,
    kind: "shortened", // reuse kind space; detail carries the real event
    detail: "Due dates re-anchored to batch start (amounts unchanged)",
    reason: "schedule_reanchor_apply",
    meta: { beforeFingerprint: before.slice(0, 200), lines: preview.lines },
  }).then(() => undefined, () => undefined);

  return NextResponse.json({ ok: true, applied: true, enrollmentId, actor });
}
