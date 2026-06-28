import { NextResponse } from "next/server";
import { getLeadForms, addLeadForm } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const forms = await getLeadForms();
    return NextResponse.json({ ok: true, forms });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load forms." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.name) return NextResponse.json({ ok: false, error: "Name required." }, { status: 400 });
    const form = await addLeadForm(body);
    return NextResponse.json({ ok: true, form });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to create form." }, { status: 500 });
  }
}
