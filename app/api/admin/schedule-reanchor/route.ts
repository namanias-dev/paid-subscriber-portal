import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requireAnyPermission, currentAdminId } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses, getCourseEnrollmentById } from "@/lib/dataProvider";
import { previewReanchorEnrollment } from "@/lib/scheduleReanchor";
import { applyReanchorEnrollment, revertReanchorSnapshot, REANCHOR_ACTOR } from "@/lib/scheduleReanchorApply";
import { maskMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * GET — preview-only re-anchoring report. NEVER mutates schedules.
 * POST — apply one enrollment (confirmApply) or revert one snapshot (confirmRevert).
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
  const actor = REANCHOR_ACTOR;

  if (body.confirmRevert === true && body.snapshotId) {
    const rev = await revertReanchorSnapshot(String(body.snapshotId), `${actor} revert`);
    if (!rev.ok) return NextResponse.json({ ok: false, error: rev.error }, { status: 400 });
    return NextResponse.json({ ok: true, reverted: true, enrollmentId: rev.enrollmentId, actor });
  }

  if (body.confirmApply !== true) {
    return NextResponse.json({
      ok: false,
      error: "Apply path is gated. Pass confirmApply: true. Preview via GET. Revert via confirmRevert + snapshotId.",
    }, { status: 400 });
  }

  const enrollmentId = String(body.enrollmentId || "");
  if (!enrollmentId) return NextResponse.json({ ok: false, error: "enrollmentId required" }, { status: 400 });

  const enrollment = await getCourseEnrollmentById(enrollmentId);
  if (!enrollment) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === enrollment.course_id);
  const applied = await applyReanchorEnrollment({ enrollment, course, actor });
  if (!applied.ok) {
    return NextResponse.json({ ok: false, error: applied.error, preview: applied.preview }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    applied: true,
    enrollmentId,
    snapshotId: applied.snapshotId,
    actor: actor || (await currentAdminId()),
    accessBefore: applied.preview.accessBefore,
    accessAfter: applied.preview.accessAfter,
    rupeesMovingOutOfMonth: applied.preview.rupeesMovingOutOfMonth,
    lines: applied.preview.lines,
  });
}
