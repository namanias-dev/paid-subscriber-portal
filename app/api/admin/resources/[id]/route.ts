import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { updateResource, deleteResource, getResources } from "@/lib/dataProvider";
import { normalizeResourceInput } from "@/lib/resourceNormalize";
import { RESERVED_RESOURCE_SLUGS } from "@/lib/resourceConstants";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_resources"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const norm = normalizeResourceInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    if (typeof norm.value!.slug === "string") {
      const slug = String(norm.value!.slug);
      if (RESERVED_RESOURCE_SLUGS.has(slug)) {
        return NextResponse.json({ ok: false, error: `"${slug}" is a reserved category slug. Choose a different slug.` }, { status: 400 });
      }
      const existing = await getResources();
      if (existing.some((r) => r.slug === slug && r.id !== params.id)) {
        return NextResponse.json({ ok: false, error: `Another resource already uses slug "${slug}".` }, { status: 400 });
      }
    }
    const resource = await updateResource(params.id, norm.value!);
    if (!resource) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, resource });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update resource.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_resources"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteResource(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete resource." }, { status: 500 });
  }
}
