import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { buildDltRows, dltToMarkdown, dltToCsv } from "@/lib/sms/dlt";

export const dynamic = "force-dynamic";

/** Export the DLT Approval Sheet (Markdown default, ?format=csv for a spreadsheet). */
export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const rows = buildDltRows();
  if (url.searchParams.get("format") === "csv") {
    return new NextResponse(dltToCsv(rows), { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=sms-dlt-approval-sheet.csv" } });
  }
  if (url.searchParams.get("format") === "md") {
    return new NextResponse(dltToMarkdown(rows), { headers: { "Content-Type": "text/markdown", "Content-Disposition": "attachment; filename=sms-dlt-templates.md" } });
  }
  return NextResponse.json({ ok: true, rows });
}
