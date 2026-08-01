import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { listAdminActivity, ADMIN_ACTIVITY_LABELS, type AdminActivityAction } from "@/lib/adminActivity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 50)));
  const { rows, total } = await listAdminActivity({
    actorId: url.searchParams.get("actor") || null,
    action: url.searchParams.get("action") || null,
    entityType: url.searchParams.get("entityType") || null,
    fromISO: url.searchParams.get("from") || null,
    toISO: url.searchParams.get("to") || null,
    q: url.searchParams.get("q") || null,
    page,
    pageSize,
  });

  return NextResponse.json({
    ok: true,
    rows: rows.map((r) => ({
      ...r,
      action_label: ADMIN_ACTIVITY_LABELS[r.action as AdminActivityAction] || r.action,
    })),
    total,
    page,
    pageSize,
    labels: ADMIN_ACTIVITY_LABELS,
  });
}
