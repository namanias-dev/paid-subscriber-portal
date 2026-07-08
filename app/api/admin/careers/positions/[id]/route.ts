import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getPositionById, updatePosition, deletePosition } from "@/lib/careers/store";
import { normalizePositionInput } from "@/lib/careers/normalize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const position = await getPositionById(params.id);
    if (!position) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, position });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load position." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const clean = normalizePositionInput(body);
    const position = await updatePosition(params.id, clean);
    if (!position) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, position });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Failed to update position." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const ok = await deletePosition(params.id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete position." }, { status: 500 });
  }
}
