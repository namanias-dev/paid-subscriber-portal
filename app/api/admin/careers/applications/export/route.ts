import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listApplications } from "@/lib/careers/store";
import type { ApplicationStatus } from "@/lib/careers/types";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
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

  const headers = [
    "Submitted",
    "Position",
    "Name",
    "Phone",
    "Email",
    "City",
    "State",
    "Subjects",
    "UPSC attempts",
    "Interview attempts",
    "Salary expectation",
    "UPSC roll no",
    "Status",
    "Files",
  ];
  const rows = applications.map((a) => [
    a.created_at,
    a.position_title || "",
    a.full_name,
    a.phone,
    a.email,
    a.city || "",
    a.state || "",
    a.subjects.join("; "),
    a.upsc_attempts ?? "",
    a.interview_attempts ?? "",
    a.salary_expectation ?? "",
    a.upsc_roll_number || "",
    a.status,
    a.files.map((f) => f.name).join("; "),
  ]);

  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse("\uFEFF" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="careers-applications-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
