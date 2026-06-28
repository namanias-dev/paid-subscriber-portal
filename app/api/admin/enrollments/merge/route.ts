import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { mergeDuplicateEnrollments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Merge duplicate active enrollments (same phone+course) into ONE canonical row.
 * SUPER ADMIN ONLY. Cancels the extras (preserving payment history), re-points PAID
 * payments to the kept row, recomputes the single correct balance, and writes an
 * immutable enrollment_merge_log entry. Idempotent.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string; courseId?: string; keepId?: string; reason?: string };
  if (!body.phone || !body.courseId) {
    return NextResponse.json({ ok: false, error: "phone and courseId are required." }, { status: 400 });
  }

  try {
    const r = await mergeDuplicateEnrollments({
      phone: body.phone,
      courseId: body.courseId,
      keepId: body.keepId ?? null,
      reason: body.reason ?? null,
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
