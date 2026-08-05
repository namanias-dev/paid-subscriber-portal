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
export const maxDuration = 300;

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

    if (action === "sales_smoke") {
      const salesMod = await import("@/lib/telegram/sales");
      process.env.TELEGRAM_SALES_SMOKE = "1";
      const ok = await salesMod.maybeSalesSmokeMessage();
      return NextResponse.json({ ok, channel: "sales", ts: Date.now() });
    }

    if (action === "sales_digest") {
      const salesMod = await import("@/lib/telegram/sales");
      const digest = await salesMod.runSalesDigestIfDue({ force: true });
      return NextResponse.json({ ok: digest.ok, digest, ts: Date.now() });
    }

    if (action === "sales_seed") {
      const salesMod = await import("@/lib/telegram/sales");
      const dry = url.searchParams.get("dry") === "1" || url.searchParams.get("confirm") !== "1";
      // Real seed: disable live flags first so pilot can't race-double with seed.
      if (!dry) await salesMod.setSalesFlagsEnabled(false);
      const result = await salesMod.runSalesTodaySeed({ dryRun: dry, confirm: !dry });
      return NextResponse.json({
        ok: result.ok,
        dryRun: result.dryRun,
        seed: result,
        note: dry
          ? "Dry-run only — pass confirm=1 to post"
          : "Seed finished; call action=sales_go_live to enable flags",
        ts: Date.now(),
      });
    }

    if (action === "sales_seed_digest") {
      const salesMod = await import("@/lib/telegram/sales");
      const finish = await salesMod.finishSalesSeedDigest();
      return NextResponse.json({ ok: finish.ok, finish, ts: Date.now() });
    }

    if (action === "sales_go_live") {
      const salesMod = await import("@/lib/telegram/sales");
      await salesMod.setSalesFlagsEnabled(true);
      const alerts = await salesMod.salesAlertsEnabled();
      const digest = await salesMod.salesDigestEnabled();
      return NextResponse.json({
        ok: true,
        sales_alerts_enabled: alerts,
        sales_digest_enabled: digest,
        schedule: "10:00,15:00,20:00 IST",
        quiet_hours: "21:00–08:00 IST",
        abandon_window: "30m–2h",
        ts: Date.now(),
      });
    }

    if (action === "sales_prove_dedup") {
      const salesMod = await import("@/lib/telegram/sales");
      const phone = url.searchParams.get("phone") || "";
      const event = (url.searchParams.get("event") || "admission") as
        | "admission"
        | "payment_succeeded"
        | "installment_paid";
      const before = await salesMod.alreadyDeduped(event, phone);
      if (phone) {
        if (event === "admission") {
          await salesMod.salesAlertAdmission({
            name: "Dedup prove",
            phone,
            course: "Prove",
            amount: 1,
          });
        } else if (event === "payment_succeeded") {
          await salesMod.salesAlertPaymentSucceeded({
            name: "Dedup prove",
            phone,
            course: "Prove",
            amount: 1,
          });
        } else {
          await salesMod.salesAlertInstallmentPaid({
            name: "Dedup prove",
            phone,
            course: "Prove",
            amount: 1,
            installmentNo: 1,
          });
        }
      }
      const after = await salesMod.alreadyDeduped(event, phone);
      return NextResponse.json({
        ok: true,
        phone_tail: phone.slice(-4),
        event,
        alreadyDedupedBefore: before,
        alreadyDedupedAfter: after,
        noDuplicate: before === true,
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

    if (action === "webinar_reg_alert") {
      const { firePaidWebinarRegistrationAlert, alertWebinarRegistration } = await import(
        "@/lib/telegram/reports/alerts"
      );
      const { getPayments, getWebinars } = await import("@/lib/dataProvider");
      const { paidWebinarRegistrationCount } = await import("@/lib/webinarReg");
      const { isPaidStatus } = await import("@/lib/paymentsAgg");
      const paymentId = url.searchParams.get("payment_id") || "";
      const nameQ = (url.searchParams.get("name") || "").trim().toLowerCase();
      const pays = await getPayments();
      let pay =
        (paymentId && pays.find((p) => p.id === paymentId)) ||
        [...pays]
          .filter(
            (p) =>
              !p.deleted_at &&
              isPaidStatus(p.status) &&
              p.item_type === "webinar" &&
              (!nameQ || (p.student_name || "").toLowerCase() === nameQ),
          )
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ||
        null;
      if (!pay) {
        return NextResponse.json({ ok: false, error: "paid_webinar_payment_not_found", ts: Date.now() }, { status: 404 });
      }
      await firePaidWebinarRegistrationAlert(pay);
      const webs = await getWebinars();
      const w = webs.find((x) => x.slug === pay!.item_slug);
      const count = paidWebinarRegistrationCount(pays, pay.item_slug || "");
      return NextResponse.json({
        ok: true,
        registration: {
          payment_id: pay.id,
          name: pay.student_name,
          webinar: w?.title || pay.item,
          count,
          created_at: pay.created_at,
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
    // Sales channel — fully isolated; failures never affect ops digest/alerts.
    let sales: unknown = null;
    try {
      const salesMod = await import("@/lib/telegram/sales");
      const abandon = await salesMod.sweepCheckoutAbandoned().catch(() => ({ checked: 0, alerted: 0 }));
      const digestSales = await salesMod.runSalesDigestIfDue().catch(() => ({
        ok: false,
        sent: false,
        slot: null,
        flushed: 0,
      }));
      sales = { abandon, digest: digestSales };
    } catch (e) {
      sales = { error: (e as Error).message };
    }
    return NextResponse.json({ ok: true, digest, alerts, sales, ts: Date.now() });
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
