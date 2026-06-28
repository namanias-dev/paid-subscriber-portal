import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { backfillProvisionalEnrollments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safe, reversible cleanup of provisional/duplicate course enrollments so payment
 * ATTEMPTS never count as enrollments. SUPER ADMIN ONLY.
 *
 * Defaults to a DRY-RUN (preview): pass { "apply": true } to actually supersede
 * the duplicate attempts. Never deletes payments or students — only marks extra
 * attempt rows cancelled (superseded_by) and their open payments ABANDONED, with
 * an immutable enrollment_merge_log entry. Reconciles with the Merge tool.
 *
 * Recommended: run once with no body (dry-run), review `actions`, then re-run
 * with { "apply": true }.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { apply?: boolean; dryRun?: boolean };
  // Safe default: only apply when explicitly requested.
  const dryRun = body.apply === true ? false : body.dryRun !== false;

  try {
    const r = await backfillProvisionalEnrollments({
      dryRun,
      actor: { id: actor.id ?? undefined, name: actor.name ?? undefined, role: actor.role ?? undefined },
    });
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
