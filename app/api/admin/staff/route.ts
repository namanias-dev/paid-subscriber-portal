import { NextResponse } from "next/server";
import { getStaff, addStaff } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const staff = await getStaff();
    return NextResponse.json({ ok: true, staff });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load staff." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.name) return NextResponse.json({ ok: false, error: "Name required." }, { status: 400 });
    const member = await addStaff(body);
    return NextResponse.json({ ok: true, member });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to add staff." }, { status: 500 });
  }
}
