import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listLogs, type LogFilters } from "@/lib/sms/store";
import { retryLog } from "@/lib/sms/service";
import type { SmsLog } from "@/lib/sms/types";

export const dynamic = "force-dynamic";

function filtersFromUrl(url: URL): LogFilters {
  return {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    status: url.searchParams.get("status") || undefined,
    templateId: url.searchParams.get("template") || undefined,
    mobile: url.searchParams.get("mobile") || undefined,
    trigger: url.searchParams.get("trigger") || undefined,
    sentByType: url.searchParams.get("sentBy") || undefined,
    audienceType: url.searchParams.get("audience") || undefined,
    limit: Number(url.searchParams.get("limit")) || 500,
  };
}

function toCsv(rows: SmsLog[]): string {
  const head = ["created_at", "mobile", "name", "template", "status", "segments", "trigger", "sent_by", "message", "error"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.created_at, r.normalized_mobile, r.student_name, r.template_name, r.status, r.segments, r.trigger_event, r.sent_by_type, r.message_body, r.error_message].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const logs = await listLogs(filtersFromUrl(url));
  if (url.searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(logs), { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=sms-logs.csv" } });
  }
  return NextResponse.json({ ok: true, logs });
}

export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "retry" && body.id) {
    const res = await retryLog(String(body.id));
    return NextResponse.json({ ok: res.ok, result: res });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
