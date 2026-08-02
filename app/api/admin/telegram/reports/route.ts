import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  getReportSettings,
  sendDigestNow,
  updateReportSettings,
  type DigestFrequency,
  type ReportAlertKey,
} from "@/lib/telegram/reports";
import { validateReportsChannelId, verifyReportsChannel } from "@/lib/telegram/reports/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const settings = await getReportSettings();
  return NextResponse.json({
    ok: true,
    settings,
    envChannelConfigured: !!(process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim(),
  });
}

export async function PATCH(req: NextRequest) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof updateReportSettings>[0] = {};
  if ("channel_id" in body) {
    const v = body.channel_id;
    if (v == null || v === "") {
      patch.channel_id = null;
    } else {
      const raw = String(v).trim();
      const validated = await validateReportsChannelId(raw);
      if (!validated.ok || !validated.id) {
        return NextResponse.json(
          {
            ok: false,
            error: validated.error || "getChat_failed",
            getChat: validated,
          },
          { status: 400 },
        );
      }
      patch.channel_id = validated.id;
    }
  }
  if (typeof body.digest_enabled === "boolean") patch.digest_enabled = body.digest_enabled;
  if (
    body.digest_frequency === "2h" ||
    body.digest_frequency === "3h" ||
    body.digest_frequency === "6h" ||
    body.digest_frequency === "daily"
  ) {
    patch.digest_frequency = body.digest_frequency as DigestFrequency;
  }
  if ("quiet_hours_start" in body) {
    patch.quiet_hours_start =
      body.quiet_hours_start == null || body.quiet_hours_start === ""
        ? null
        : Math.max(0, Math.min(23, Number(body.quiet_hours_start)));
  }
  if ("quiet_hours_end" in body) {
    patch.quiet_hours_end =
      body.quiet_hours_end == null || body.quiet_hours_end === ""
        ? null
        : Math.max(0, Math.min(23, Number(body.quiet_hours_end)));
  }
  if (body.alerts && typeof body.alerts === "object") {
    patch.alerts = body.alerts as Partial<Record<ReportAlertKey, boolean>>;
  }
  const settings = await updateReportSettings(patch);
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: NextRequest) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    registration_id?: string;
    webinar_id?: string;
    name?: string;
    phone?: string;
  };
  const action = body.action || "send_digest_now";

  if (action === "test_post") {
    const verify = await verifyReportsChannel({ sendTest: true });
    return NextResponse.json({
      ok: verify.ok,
      action,
      verify,
      reason: verify.ok ? undefined : verify.testError || verify.getChatError || "test_failed",
    });
  }

  if (action === "send_digest_now" || action === "send_test_report") {
    const result = await sendDigestNow({ force: true, skipIdempotency: true });
    return NextResponse.json({ ...result, action });
  }

  if (action === "send_webinar_registration") {
    const { alertWebinarRegistration } = await import("@/lib/telegram/reports/alerts");
    const { getAllWebinarRegistrations, getWebinars } = await import("@/lib/dataProvider");
    const regs = await getAllWebinarRegistrations();
    let reg =
      (body.registration_id && regs.find((r) => r.id === body.registration_id)) ||
      (body.webinar_id && body.phone
        ? regs.find((r) => r.webinar_id === body.webinar_id && r.phone === body.phone)
        : null) ||
      null;
    if (!reg && body.name) {
      const hits = regs
        .filter((r) => (r.name || "").toLowerCase() === body.name!.toLowerCase())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      reg = hits[0] || null;
    }
    if (!reg) {
      return NextResponse.json({ ok: false, error: "registration_not_found", action }, { status: 404 });
    }
    const webs = await getWebinars();
    const w = webs.find((x) => x.id === reg!.webinar_id);
    const count = regs.filter((r) => r.webinar_id === reg!.webinar_id).length;
    const sent = await alertWebinarRegistration({
      webinarId: reg.webinar_id,
      name: reg.name || body.name || "Student",
      phone: reg.phone,
      webinarTitle: w?.title || null,
      webinarSlug: w?.slug || null,
      webinarAt: w?.datetime || null,
      price: w?.price ?? null,
      regCount: count,
      registeredAt: reg.created_at,
    });
    return NextResponse.json({
      ok: sent,
      action,
      registration_id: reg.id,
      webinar_id: reg.webinar_id,
      name: reg.name,
      reg_count: count,
    });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
