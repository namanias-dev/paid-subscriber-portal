import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listPositions, createPosition, applicationCountsByPosition } from "@/lib/careers/store";
import { normalizePositionInput } from "@/lib/careers/normalize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const [positions, counts] = await Promise.all([listPositions(), applicationCountsByPosition()]);
    return NextResponse.json({ ok: true, positions, counts });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load positions." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const clean = normalizePositionInput(body);
    if (!clean.title) return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
    const position = await createPosition(clean);
    return NextResponse.json({ ok: true, position });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Failed to create position." }, { status: 500 });
  }
}
