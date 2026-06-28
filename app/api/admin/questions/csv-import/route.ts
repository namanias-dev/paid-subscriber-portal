import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { parseCsvQuestions } from "@/lib/csvQuestions";
import { previewParsed, importParsed } from "@/lib/quizImport";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const ct = req.headers.get("content-type") || "";
    let csvText = "";
    let action = "preview";
    let publish = false;
    let approve = false;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      action = String(form.get("action") || "preview");
      publish = String(form.get("publish")) === "true";
      approve = String(form.get("approve")) === "true";
      if (!file) return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(ws);
      } else {
        csvText = buf.toString("utf-8");
      }
    } else {
      const body = await req.json().catch(() => ({}));
      csvText = String(body.text || "");
      action = String(body.action || "preview");
      publish = !!body.publish;
      approve = !!body.approve;
    }

    const parsed = parseCsvQuestions(csvText);
    if (action === "preview") {
      const result = await previewParsed(parsed);
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await importParsed(parsed, { publish, approve, skipDuplicates: true, type: "CSV", sourceConfig: { mode: "csv_upload" } });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "CSV import failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
