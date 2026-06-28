import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { parseCsvQuestions } from "@/lib/csvQuestions";
import { previewParsed, importParsed } from "@/lib/quizImport";
import { parseSheetId, parseGid, fetchSheetCsv } from "@/lib/googleSheets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "preview");
    const raw = String(body.spreadsheetId || body.url || "");
    if (!raw) return NextResponse.json({ ok: false, error: "Provide a Google Sheet URL or ID." }, { status: 400 });

    const id = parseSheetId(raw);
    const gid = body.gid ? String(body.gid) : parseGid(raw);
    const csv = await fetchSheetCsv(id, gid);
    const parsed = parseCsvQuestions(csv);

    if (action === "preview") {
      const result = await previewParsed(parsed);
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await importParsed(parsed, {
      publish: !!body.publish, approve: !!body.approve, skipDuplicates: true,
      type: "GOOGLE_SHEET", sourceConfig: { spreadsheetId: id, gid },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Google Sheet import failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
