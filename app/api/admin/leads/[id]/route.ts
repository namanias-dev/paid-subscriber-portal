import { NextResponse } from "next/server";
import { updateLead, deleteLead, getLeadActivities, addLeadActivity } from "@/lib/dataProvider";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { buildStaffStatusPatch, hasBehaviourStatusSchema } from "@/lib/leadBehaviourStatus";
import { isLeadStatus, normalizeLeadStatus } from "@/lib/leadStatus";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const activities = await getLeadActivities(params.id);
    return NextResponse.json({ ok: true, activities });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed." },
      { status: 500 },
    );
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

    let patch: Record<string, unknown> = { ...body };
    delete patch._activity;

    if (body.status !== undefined && body.status !== null) {
      const normalized = normalizeLeadStatus(String(body.status));
      if (!normalized || !isLeadStatus(normalized)) {
        return NextResponse.json({ ok: false, error: `Invalid status: ${String(body.status)}` }, { status: 400 });
      }
      const actor = await getActionActor();
      const schemaOk = await hasBehaviourStatusSchema();
      const staffPatch = buildStaffStatusPatch({
        status: normalized,
        actorName: actor?.name ?? null,
        actorRole: actor?.role ?? null,
        note: typeof body.manual_status_note === "string" ? body.manual_status_note : null,
        includeAttributionCols: schemaOk,
      });
      // Staff patch owns status / admitted / webinar_registered / manual_* / origin.
      // Other body fields (counsellor, follow_up_date, …) still merge through.
      const {
        status: _s,
        admitted: _a,
        webinar_registered: _w,
        ...rest
      } = patch;
      patch = { ...rest, ...staffPatch };
      // Drop undefined webinar_registered so we don't clear an existing flag.
      if (patch.webinar_registered === undefined) delete patch.webinar_registered;
    }

    const lead = await updateLead(params.id, patch as Parameters<typeof updateLead>[1]);
    if (!lead) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, lead });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to update." },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteLead(params.id);
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to delete." },
      { status: 500 },
    );
  }
}
