import { NextResponse } from "next/server";
import { getImportJobs } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const jobs = await getImportJobs();
    return NextResponse.json({ ok: true, jobs });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load import jobs." }, { status: 500 });
  }
}
