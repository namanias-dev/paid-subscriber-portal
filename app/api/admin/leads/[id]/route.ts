import { NextResponse } from "next/server";
import { updateLead, deleteLead, getLeadActivities, addLeadActivity } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const activities = await getLeadActivities(params.id);
    return NextResponse.json({ ok: true, activities });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (body._activity) {
      const activity = await addLeadActivity({ lead_id: params.id, ...body._activity });
      return NextResponse.json({ ok: true, activity });
    }
    const lead = await updateLead(params.id, body);
    if (!lead) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, lead });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteLead(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete." }, { status: 500 });
  }
}
