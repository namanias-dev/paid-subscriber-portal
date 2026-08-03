import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { reverifyPayments } from "@/lib/dataProvider";
import { isQstashConfigured } from "@/lib/paymentOutcome";
import { sendMessage, buildKeyboard } from "@/lib/telegram/botApi";
import { getReportSettings, resolveReportsChannelId } from "@/lib/telegram/reports/settings";
import { formatINR } from "@/lib/dates";
import { tgLog } from "@/lib/telegram/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Silent (or ops-notified) re-verify backfill over a date window.
 *
 *   GET /api/cron/payment-outcome-backfill?secret=...&windowDays=14&offsetDays=0&notify=0&limit=500
 *
 * windowDays — width of the created_at window (default 14)
 * offsetDays — how many days back the window END is (0 = now; 14 = ended 14d ago)
 * notify=1   — post ops Telegram summary (default 0 — silent, no Telegram)
 *
 * Student SMS/Telegram always silent (silentStudentNotify).
 */
async function run(req: Request) {
  const authorized =
    authorizeCron(req, process.env.CRON_SECRET) ||
    authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 500)));
  const windowDays = Math.min(90, Math.max(1, Number(url.searchParams.get("windowDays") || 14)));
  const offsetDays = Math.min(365, Math.max(0, Number(url.searchParams.get("offsetDays") || 0)));
  const notify = url.searchParams.get("notify") === "1";

  const endMs = Date.now() - offsetDays * 86400_000;
  const startMs = endMs - windowDays * 86400_000;
  const since = new Date(startMs).toISOString();
  const until = new Date(endMs).toISOString();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });

  const { data: candidates } = await db
    .from("payments")
    .select("reference_no,item_type,payment_kind,amount,status,created_at")
    .not("status", "in", "(PAID,captured)")
    .in("item_type", ["webinar", "course"])
    .is("deleted_at", null)
    .gte("created_at", since)
    .lt("created_at", until)
    .not("reference_no", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  const refs = ((candidates as { reference_no: string | null }[]) || [])
    .map((r) => r.reference_no)
    .filter(Boolean) as string[];

  tgLog(
    "payment_backfill_batch_start",
    { since, until, windowDays, offsetDays, candidates: refs.length, notify },
    "info",
  );

  const result = await reverifyPayments({
    referenceNos: refs,
    silentStudentNotify: true,
    withDetails: true,
    rateLimitMs: 250,
    limit,
  });

  const recovered = (result.details || []).filter((d) => d.to === "PAID" && d.from !== "PAID");
  const byType = {
    webinar: 0,
    seat: 0,
    installment: 0,
    other_course: 0,
    webinar_inr: 0,
    seat_inr: 0,
    installment_inr: 0,
    other_inr: 0,
  };

  for (const d of recovered) {
    const row = (
      (candidates as { reference_no: string; item_type: string; payment_kind: string | null; amount: number }[]) || []
    ).find((c) => c.reference_no === d.reference_no);
    if (!row) continue;
    const amt = Number(row.amount) || 0;
    if (row.item_type === "webinar") {
      byType.webinar += 1;
      byType.webinar_inr += amt;
    } else if (row.payment_kind === "seat") {
      byType.seat += 1;
      byType.seat_inr += amt;
    } else if (row.payment_kind === "installment") {
      byType.installment += 1;
      byType.installment_inr += amt;
    } else {
      byType.other_course += 1;
      byType.other_inr += amt;
    }
  }

  const totalInr = byType.webinar_inr + byType.seat_inr + byType.installment_inr + byType.other_inr;

  tgLog(
    "payment_backfill_batch_done",
    {
      since,
      until,
      scanned: result.scanned,
      toPaid: result.toPaid,
      toFailed: result.toFailed,
      toAbandoned: result.toAbandoned,
      totalInr,
      notify,
    },
    "info",
  );

  if (notify) {
    const summary = [
      `🔧 <b>Payment Verify backfill</b>`,
      `Window ${since.slice(0, 10)} → ${until.slice(0, 10)}`,
      `Scanned ${result.scanned} · Recovered to PAID: <b>${result.toPaid}</b>`,
      `Webinar ${byType.webinar} (${formatINR(byType.webinar_inr)})`,
      `Seat ${byType.seat} (${formatINR(byType.seat_inr)})`,
      `Installment ${byType.installment} (${formatINR(byType.installment_inr)})`,
      `Other course ${byType.other_course} (${formatINR(byType.other_inr)})`,
      `Total recovered ${formatINR(totalInr)}`,
      `QStash configured: ${isQstashConfigured() ? "yes" : "NO — set QSTASH_* env"}`,
      `No student SMS sent (silent).`,
    ].join("\n");

    try {
      const settings = await getReportSettings();
      const channel = resolveReportsChannelId(settings);
      if (channel) {
        await sendMessage({
          chat_id: channel,
          text: summary,
          reply_markup: buildKeyboard([{ label: "Payments", url: "https://www.namanias.com/admin/payments" }]),
        });
      }
    } catch {
      /* ops notify best-effort */
    }
  }

  return NextResponse.json({
    ok: true,
    since,
    until,
    windowDays,
    offsetDays,
    scanned: result.scanned,
    toPaid: result.toPaid,
    toFailed: result.toFailed,
    toAbandoned: result.toAbandoned,
    byType,
    totalInr,
    qstash: isQstashConfigured(),
    notify,
    details: recovered.slice(0, 50),
    ts: Date.now(),
  });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
