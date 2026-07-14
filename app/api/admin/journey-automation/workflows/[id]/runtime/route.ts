import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getWorkflowRuntimeSummary, listEnrollments, listJobs, listStaffTasks, listNodeRuns } from "@/lib/journey-automation/engine/monitor";

export const dynamic = "force-dynamic";

/**
 * Runs / queue / DLQ monitor data (READ-ONLY). journey_view.
 *   GET …/runtime                 → summary + enrollments + jobs + dead-letters + staff tasks
 *   GET …/runtime?enrollment=<id> → node-runs for one enrollment (resolved vars MINUS secrets)
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const enrollmentId = url.searchParams.get("enrollment");
  try {
    if (enrollmentId) {
      const nodeRuns = await listNodeRuns(enrollmentId);
      return NextResponse.json({ ok: true, nodeRuns });
    }
    const [summary, enrollments, jobs, deadLetters, staffTasks] = await Promise.all([
      getWorkflowRuntimeSummary(params.id),
      listEnrollments(params.id, 50),
      listJobs(params.id, { limit: 100 }),
      listJobs(params.id, { deadOnly: true, limit: 100 }),
      listStaffTasks(params.id, 50),
    ]);
    return NextResponse.json({ ok: true, summary, enrollments, jobs, deadLetters, staffTasks });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
