import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { qstashHealthStatus, isQstashConfigured } from "@/lib/paymentOutcome";
import { isEazypayConfigured } from "@/lib/eazypay";
import { smsEnvEnabled } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

/**
 * Keep-alive + infra health. Hit daily (Vercel cron or cron-job.org) to stop
 * Supabase free tier from pausing. Protected by CRON_SECRET when set.
 * Includes QStash status so ops can confirm the verify ladder without a live order.
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const url = new URL(req.url);
      const provided =
        url.searchParams.get("secret") ||
        req.headers.get("authorization")?.replace("Bearer ", "");
      if (provided !== secret) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const qstash = qstashHealthStatus();

    if (isDemoMode) {
      return NextResponse.json({
        ok: true,
        demo: true,
        qstash: qstash.qstash,
        qstashDetail: qstash,
        eazypay: isEazypayConfigured(),
        smsEnv: smsEnvEnabled(),
        ts: Date.now(),
      });
    }

    const db = getSupabaseAdmin();
    if (db) {
      await db.from("students").select("id").limit(1);
    }
    return NextResponse.json({
      ok: true,
      qstash: isQstashConfigured(),
      qstashDetail: qstash,
      eazypay: isEazypayConfigured(),
      smsEnv: smsEnvEnabled(),
      ts: Date.now(),
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
