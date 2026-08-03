import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { cancelPromoQueue, countPendingPromo, listPromoQueue, reschedulePromoQueue } from "@/lib/sms/promoQueue";
import { getSettings, getTemplate } from "@/lib/sms/store";
import {
  promoWindowStatus,
  parseIstScheduleInput,
  isPromoTemplate,
  isWithinPromoWindow,
  nextValidPromoSlot,
  formatIstScheduleLabel,
  toDatetimeLocalIst,
} from "@/lib/sms/promoQuietHours";

export const dynamic = "force-dynamic";

function sourceLabel(row: { queue_source?: string | null; sent_by_type?: string; source_failed_log_id?: string | null }): string {
  if (row.queue_source === "manual") return "Manual";
  if (row.queue_source === "recovery") return "Recovery";
  if (row.queue_source === "quiet_hours") return "Automation";
  if (row.sent_by_type === "ADMIN") return "Manual";
  if (row.source_failed_log_id) return "Recovery";
  return "Automation";
}

export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const statuses = status
    ? (status.split(",").map((s) => s.trim()) as ("pending" | "claimed" | "sent" | "cancelled" | "skipped" | "failed")[])
    : (["pending", "claimed"] as const);
  const [rows, pending, settings] = await Promise.all([
    listPromoQueue({ status: [...statuses], limit: 300 }),
    countPendingPromo(),
    getSettings(),
  ]);
  return NextResponse.json({
    ok: true,
    pending,
    rows: rows.map((r) => ({ ...r, source_label: sourceLabel(r) })),
    promoWindow: promoWindowStatus(settings),
  });
}

export async function POST(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; scheduleAt?: string };
  if (body.action === "cancel" && body.id) {
    const ok = await cancelPromoQueue(body.id, "cancelled_by_admin");
    return NextResponse.json({ ok, error: ok ? undefined : "not_pending_or_missing" });
  }
  if (body.action === "reschedule" && body.id && body.scheduleAt) {
    const settings = await getSettings();
    const parsed = parseIstScheduleInput(body.scheduleAt);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code }, { status: 400 });
    const rows = await listPromoQueue({ status: ["pending"], limit: 500 });
    const row = rows.find((r) => r.id === body.id);
    if (!row) return NextResponse.json({ ok: false, error: "not_pending_or_missing" }, { status: 404 });
    const tpl = await getTemplate(row.template_id);
    if (tpl && isPromoTemplate(tpl) && !isWithinPromoWindow(settings, parsed.at)) {
      const next = nextValidPromoSlot(settings, parsed.at);
      return NextResponse.json({
        ok: false,
        error: "Promo templates may only be scheduled inside the quiet-hours window.",
        code: "promo_outside_window",
        nextValidSlot: { utcIso: next.toISOString(), istLabel: formatIstScheduleLabel(next), datetimeLocal: toDatetimeLocalIst(next) },
      }, { status: 400 });
    }
    const ok = await reschedulePromoQueue(body.id, parsed.at);
    return NextResponse.json({
      ok,
      scheduledFor: parsed.utcIso,
      scheduledForIst: parsed.istLabel,
      error: ok ? undefined : "not_pending_or_missing",
    });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
