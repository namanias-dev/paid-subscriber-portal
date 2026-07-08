import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { duplicatePosition } from "@/lib/careers/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const position = await duplicatePosition(params.id);
    if (!position) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, position });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Failed to duplicate." }, { status: 500 });
  }
}
