import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import {
  alertNoLeadsIfStale,
  alertNoLoginsIfStale,
  alertOverdueInstallments,
  alertWebinarReminders24h,
  maybeRunScheduledDigest,
  sendDigestNow,
} from "@/lib/telegram/reports";
import { verifyReportsChannel } from "@/lib/telegram/reports/verify";
import { alertPaymentPaid } from "@/lib/telegram/reports/alerts";
import { getPayments } from "@/lib/dataProvider";
import { isPaidStatus } from "@/lib/paymentsAgg";
import { assertReportsChannel } from "@/lib/telegram/reports/channelGuard";
import { getReportSettings, maskChannelId } from "@/lib/telegram/reports/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(req: Request) {
  const authorized =
    authorizeCron(req, process.env.CRON_SECRET) ||
    authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    const force =
      url.searchParams.get("force") === "1" ||
      action === "send_now" ||
      action === "send_digest";

    if (action === "verify") {
      const settings = await getReportSettings();
      const guarded = await assertReportsChannel(
        settings.channel_id || process.env.TELEGRAM_REPORTS_CHANNEL_ID,
      );
      if (!guarded.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: guarded.error || "getChat_failed",
            getChat: {
              ok: false,
              id: guarded.id,
              type: guarded.type,
              title: guarded.title,
              error: guarded.error,
              masked: maskChannelId(guarded.id),
            },
            ts: Date.now(),
          },
          { status: 502 },
        );
      }
      const verify = await verifyReportsChannel({
        sendTest: url.searchParams.get("test") !== "0",
      });
      return NextResponse.json({
        ok: verify.ok,
        getChat: {
          ok: true,
          id: guarded.id,
          type: guarded.type,
          title: guarded.title,
          masked: maskChannelId(guarded.id),
        },
        verify,
        ts: Date.now(),
      });
    }

    if (action === "seat_alert_test") {
      const pays = await getPayments();
      const seat = [...pays]
        .filter(
          (p) =>
            !p.deleted_at &&
            isPaidStatus(p.status) &&
            p.item_type === "course" &&
            p.payment_kind === "seat",
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      if (!seat) {
        return NextResponse.json({ ok: false, error: "no_seat_payment_found", ts: Date.now() });
      }
      await alertPaymentPaid(seat);
      return NextResponse.json({
        ok: true,
        seat: {
          name: seat.student_name,
          item: seat.item,
          amount: seat.amount,
          created_at: seat.created_at,
        },
        ts: Date.now(),
      });
    }

    if (force || action === "send_morning") {
      const settings = await getReportSettings();
      const guarded = await assertReportsChannel(
        settings.channel_id || process.env.TELEGRAM_REPORTS_CHANNEL_ID,
      );
      if (!guarded.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: guarded.error || "getChat_failed",
            getChat: {
              ok: false,
              id: guarded.id,
              type: guarded.type,
              title: guarded.title,
              error: guarded.error,
              masked: maskChannelId(guarded.id),
            },
            ts: Date.now(),
          },
          { status: 502 },
        );
      }
      const digest = await sendDigestNow({
        force: true,
        skipIdempotency: true,
        morningExtras: action === "send_morning" || url.searchParams.get("morning") === "1",
      });
      return NextResponse.json({
        ok: digest.ok,
        getChat: {
          ok: true,
          id: guarded.id,
          type: guarded.type,
          title: guarded.title,
          masked: maskChannelId(guarded.id),
        },
        digest,
        alerts: { overdue: { sent: 0 }, noLeads: false, webinar24h: 0 },
        ts: Date.now(),
      });
    }

    const digest = await maybeRunScheduledDigest();
    const alerts = {
      overdue: await alertOverdueInstallments().catch(() => ({ sent: 0 })),
      noLeads: await alertNoLeadsIfStale().catch(() => false),
      noLogins: await alertNoLoginsIfStale().catch(() => false),
      webinar24h: await alertWebinarReminders24h().catch(() => 0),
    };
    return NextResponse.json({ ok: true, digest, alerts, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
