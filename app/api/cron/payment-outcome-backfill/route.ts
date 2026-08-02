import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { reverifyPayments } from "@/lib/dataProvider";
import { isQstashConfigured } from "@/lib/paymentOutcome";
import { sendMessage, buildKeyboard } from "@/lib/telegram/botApi";
import { getReportSettings, resolveReportsChannelId } from "@/lib/telegram/reports/settings";
import { formatINR } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 90-day silent re-verify backfill.
 * Recover captured-but-invisible orders without student notifications.
 * Posts one ops Telegram summary.
 *
 *   GET /api/cron/payment-outcome-backfill?secret=...&limit=500
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
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });

  const { data: candidates } = await db
    .from("payments")
    .select("reference_no,item_type,payment_kind,amount,status")
    .not("status", "in", "(PAID,captured)")
    .in("item_type", ["webinar", "course"])
    .is("deleted_at", null)
    .gte("created_at", since)
    .not("reference_no", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  const refs = ((candidates as { reference_no: string | null }[]) || [])
    .map((r) => r.reference_no)
    .filter(Boolean) as string[];

  const result = await reverifyPayments({
    referenceNos: refs,
    silentStudentNotify: true,
    withDetails: true,
    rateLimitMs: 250,
    limit,
  });

  const recovered = (result.details || []).filter((d) => d.to === "PAID" && d.from !== "PAID");
  const byType = { webinar: 0, seat: 0, installment: 0, other_course: 0, webinar_inr: 0, seat_inr: 0, installment_inr: 0, other_inr: 0 };

  for (const d of recovered) {
    const row = ((candidates as { reference_no: string; item_type: string; payment_kind: string | null; amount: number }[]) || []).find(
      (c) => c.reference_no === d.reference_no,
    );
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
  const summary = [
    `🔧 <b>Payment Verify backfill (90d)</b>`,
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

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    toPaid: result.toPaid,
    byType,
    totalInr,
    qstash: isQstashConfigured(),
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
