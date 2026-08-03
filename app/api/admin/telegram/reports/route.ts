import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  getReportSettings,
  previewDigestNow,
  sendDigestNow,
  updateReportSettings,
  type DigestFrequency,
  type ReportAlertKey,
} from "@/lib/telegram/reports";
import { validateReportsChannelId, verifyReportsChannel } from "@/lib/telegram/reports/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    morning?: boolean;
    html?: string;
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

  if (action === "preview_digest") {
    const result = await previewDigestNow({ morningExtras: body.morning === true });
    return NextResponse.json({ ...result, action });
  }

  if (action === "send_digest_now" || action === "send_test_report") {
    const html = typeof body.html === "string" ? body.html : undefined;
    const result = await sendDigestNow({
      force: true,
      skipIdempotency: true,
      morningExtras: body.morning === true,
      html,
    });
    return NextResponse.json({ ...result, action });
  }

  if (action === "send_webinar_registration") {
    const { firePaidWebinarRegistrationAlert } = await import("@/lib/telegram/reports/alerts");
    const { getPayments, getWebinars } = await import("@/lib/dataProvider");
    const { paidWebinarRegistrationCount } = await import("@/lib/webinarReg");
    const { isPaidStatus } = await import("@/lib/paymentsAgg");
    const pays = await getPayments();
    const nameQ = (body.name || "").trim().toLowerCase();
    let pay =
      [...pays]
        .filter(
          (p) =>
            !p.deleted_at &&
            isPaidStatus(p.status) &&
            p.item_type === "webinar" &&
            (!nameQ || (p.student_name || "").toLowerCase() === nameQ) &&
            (!body.phone || p.phone === body.phone),
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
    if (!pay) {
      return NextResponse.json({ ok: false, error: "paid_webinar_payment_not_found", action }, { status: 404 });
    }
    await firePaidWebinarRegistrationAlert(pay);
    const webs = await getWebinars();
    const w = webs.find((x) => x.slug === pay!.item_slug);
    const count = paidWebinarRegistrationCount(pays, pay.item_slug || "");
    return NextResponse.json({
      ok: true,
      action,
      payment_id: pay.id,
      webinar_id: w?.id || null,
      name: pay.student_name,
      reg_count: count,
    });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
