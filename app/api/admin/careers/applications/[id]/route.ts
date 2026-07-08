import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getActionActor } from "@/lib/adminGuard";
import { getApplicationById, updateApplication, deleteApplication } from "@/lib/careers/store";
import { deleteCareerFile } from "@/lib/careers/storage";
import { APPLICATION_STATUSES } from "@/lib/careers/config";
import type { ApplicationStatus } from "@/lib/careers/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const application = await getApplicationById(params.id);
    if (!application) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, application });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load application." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const actor = await getActionActor();
    const body = (await req.json().catch(() => ({}))) as {
      status?: string;
      admin_notes?: string;
      note?: string;
    };
    const patch: { status?: ApplicationStatus; admin_notes?: string; by?: string | null; note?: string | null } = {
      by: actor?.name || actor?.id || null,
    };
    if (body.status !== undefined) {
      if (!APPLICATION_STATUSES.includes(body.status as ApplicationStatus)) {
        return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
      }
      patch.status = body.status as ApplicationStatus;
    }
    if (body.admin_notes !== undefined) patch.admin_notes = String(body.admin_notes).slice(0, 4000);
    if (body.note !== undefined) patch.note = String(body.note).slice(0, 500);

    const application = await updateApplication(params.id, patch);
    if (!application) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, application });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Failed to update." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const application = await getApplicationById(params.id);
    if (!application) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    // Best-effort cleanup of the applicant's uploaded files from R2.
    for (const f of application.files) {
      await deleteCareerFile(f.key).catch(() => {});
    }
    const ok = await deleteApplication(params.id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete application." }, { status: 500 });
  }
}
