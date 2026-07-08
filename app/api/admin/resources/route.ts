import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getResources, addResource } from "@/lib/dataProvider";
import { normalizeResourceInput } from "@/lib/resourceNormalize";
import { RESERVED_RESOURCE_SLUGS } from "@/lib/resourceConstants";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("content_resources"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const resources = await getResources();
    return NextResponse.json({ ok: true, resources });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load resources." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_resources"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
    const norm = normalizeResourceInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const slug = String(norm.value!.slug || "");
    if (RESERVED_RESOURCE_SLUGS.has(slug)) {
      return NextResponse.json({ ok: false, error: `"${slug}" is a reserved category slug. Choose a different slug.` }, { status: 400 });
    }
    // Enforce unique slug.
    const existing = await getResources();
    if (existing.some((r) => r.slug === slug)) {
      return NextResponse.json({ ok: false, error: `A resource with slug "${slug}" already exists.` }, { status: 400 });
    }
    const resource = await addResource(norm.value!);
    return NextResponse.json({ ok: true, resource });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create resource.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
