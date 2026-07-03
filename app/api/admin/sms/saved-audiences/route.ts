import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { listSavedAudiences, createSavedAudience, deleteSavedAudience } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

/** Saved composable-filter audiences for the Send tab (name + FilterSpec). */
export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, saved: await listSavedAudiences() });
}

export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const spec = (body.spec && typeof body.spec === "object") ? body.spec as Record<string, unknown> : null;
  if (!name.trim() || !spec) return NextResponse.json({ ok: false, error: "Missing name or filter spec" }, { status: 400 });
  const row = await createSavedAudience(name, spec, await currentAdminId());
  if (!row) return NextResponse.json({ ok: false, error: "Could not save (name required)" }, { status: 400 });
  return NextResponse.json({ ok: true, saved: row });
}

export async function DELETE(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  return NextResponse.json({ ok: await deleteSavedAudience(id) });
}
