import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import {
  alertNoLeadsIfStale,
  alertOverdueInstallments,
  alertWebinarReminders24h,
  maybeRunScheduledDigest,
  sendDigestNow,
} from "@/lib/telegram/reports";
import { verifyReportsChannel } from "@/lib/telegram/reports/verify";
import {
  diagnoseAndDiscoverChannel,
  kickoffReportsAfterChannelCapture,
} from "@/lib/telegram/reports/discover";
import { alertPaymentPaid } from "@/lib/telegram/reports/alerts";
import { getPayments } from "@/lib/dataProvider";
import { isPaidStatus } from "@/lib/paymentsAgg";
import { getChat, sendMessage } from "@/lib/telegram/botApi";
import {
  getReportSettings,
  maskChannelId,
  updateReportSettings,
} from "@/lib/telegram/reports/settings";
import { assertReportsChannel } from "@/lib/telegram/reports/channelGuard";

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

    if (action === "discover") {
      const discovery = await diagnoseAndDiscoverChannel();
      return NextResponse.json({ ok: discovery.ok, discovery, ts: Date.now() });
    }

    if (action === "verify") {
      const verify = await verifyReportsChannel({
        sendTest: url.searchParams.get("test") !== "0",
      });
      return NextResponse.json({ ok: verify.ok, verify, ts: Date.now() });
    }

    if (action === "probe_usernames") {
      const names = (
        url.searchParams.get("names") ||
        "naman21,namanias_ops,NamanIASOps,naman_ias_ops,namaniasops,NamanIAS_Ops"
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const results = [];
      for (const name of names) {
        const id = name.startsWith("@") ? name : `@${name}`;
        const chat = await getChat(id);
        results.push({
          id,
          ok: !!chat.ok,
          type: chat.result?.type || null,
          title: chat.result?.title || null,
          chatId: chat.result?.id != null ? String(chat.result.id) : null,
          error: chat.ok ? null : chat.description || null,
        });
      }
      return NextResponse.json({ ok: true, results, ts: Date.now() });
    }

    if (action === "set_channel") {
      const raw = (url.searchParams.get("id") || "").trim();
      const guarded = await assertReportsChannel(raw);
      if (!guarded.ok || !guarded.id) {
        return NextResponse.json(
          { ok: false, error: guarded.error || "invalid_channel", ts: Date.now() },
          { status: 400 },
        );
      }
      // Refuse binding the public student channel unless explicitly forced.
      const title = (guarded.title || "").toLowerCase();
      const forcePublic = url.searchParams.get("allow_public") === "1";
      if (!forcePublic && (!/ops/.test(title) || guarded.id === "-1001062189351")) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "refusing_non_ops_channel — title must include Ops (use allow_public=1 only for intentional exceptions)",
            title: guarded.title,
            channelMasked: maskChannelId(guarded.id),
            ts: Date.now(),
          },
          { status: 400 },
        );
      }
      await updateReportSettings({ channel_id: guarded.id });
      const kick = await kickoffReportsAfterChannelCapture(guarded.id);
      return NextResponse.json({
        ok: true,
        channelMasked: maskChannelId(guarded.id),
        title: guarded.title,
        type: guarded.type,
        kick,
        ts: Date.now(),
      });
    }

    if (action === "request_link") {
      const settings = await getReportSettings();
      const owner =
        url.searchParams.get("chat_id") ||
        (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim() ||
        "1203028670";
      // If env is a private user id, that's who to DM; else ask known subscriber.
      let dmTo = owner;
      const probe = await getChat(owner);
      if (probe.ok && probe.result?.type === "private") {
        dmTo = String(probe.result.id);
      }
      const text = [
        "⚠️ Ops reports are blocked: TELEGRAM_REPORTS_CHANNEL_ID is a private user chat, not «Naman IAS — Ops».",
        "",
        "Fix in 10 seconds (pick one):",
        "1) Open «Naman IAS — Ops» → forward any post here to @NamanIASBot",
        "2) Or reply with the channel id (starts with -100…)",
        "3) Or remove + re-add @NamanIASBot as channel admin",
        "",
        "I will auto-link and post the first digest as soon as I see the channel.",
        settings.channel_id
          ? `(settings.channel_id currently ${maskChannelId(settings.channel_id)})`
          : "(settings.channel_id is empty)",
      ].join("\n");
      const sent = await sendMessage({
        chat_id: dmTo,
        text,
        disable_web_page_preview: true,
        disable_notification: false,
      });
      return NextResponse.json({
        ok: !!sent.ok,
        dmTo: maskChannelId(String(dmTo)),
        messageId: sent.result?.message_id ?? null,
        error: sent.ok ? null : sent.description,
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
      const discovery = await diagnoseAndDiscoverChannel();
      if (!discovery.ok && !discovery.chosen) {
        return NextResponse.json(
          {
            ok: false,
            error: "channel_verify_failed",
            discovery,
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
        discovery,
        digest,
        alerts: { overdue: { sent: 0 }, noLeads: false, webinar24h: 0 },
        ts: Date.now(),
      });
    }

    const digest = await maybeRunScheduledDigest();
    const alerts = {
      overdue: await alertOverdueInstallments().catch(() => ({ sent: 0 })),
      noLeads: await alertNoLeadsIfStale().catch(() => false),
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
