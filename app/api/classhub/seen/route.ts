import { NextResponse } from "next/server";
import { resolveLearner } from "@/lib/entitlements";
import { markClassHubSeen } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/**
 * Records that the current learner (buyer OR LMS student) has opened a Class Hub
 * section — clearing its NEW badge. Tracked against the canonical students.id.
 */
export async function POST(req: Request) {
  try {
    const learner = await resolveLearner();
    if (!learner?.studentId) return NextResponse.json({ ok: true }); // logged out / no student row — no-op
    const body = await req.json().catch(() => ({}));
    const courseId = String(body.courseId || "");
    const section = String(body.section || "");
    if (!courseId || !section) return NextResponse.json({ ok: false, error: "Missing courseId/section" }, { status: 400 });
    // Only track sections for courses the learner actually has access to.
    if (!learner.courseIds.includes(courseId)) return NextResponse.json({ ok: true });
    await markClassHubSeen(learner.studentId, courseId, section);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
