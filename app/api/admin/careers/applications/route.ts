import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listApplications } from "@/lib/careers/store";
import type { ApplicationStatus } from "@/lib/careers/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const applications = await listApplications({
      positionId: url.searchParams.get("positionId") || undefined,
      status: (url.searchParams.get("status") as ApplicationStatus) || undefined,
      q: url.searchParams.get("q") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    return NextResponse.json({ ok: true, applications });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load applications." }, { status: 500 });
  }
}
