import { NextResponse } from "next/server";
import { getLeads, addLead } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const leads = await getLeads();
    return NextResponse.json({ ok: true, leads });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load leads." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.name || !body.phone) return NextResponse.json({ ok: false, error: "Name and phone required." }, { status: 400 });
    const lead = await addLead(body);
    return NextResponse.json({ ok: true, lead });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to add lead." }, { status: 500 });
  }
}
