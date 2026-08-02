import { NextResponse } from "next/server";
import {
  verifyQstashRequest,
  applyVerifyForReference,
  enqueueVerifyRetry,
  isQstashConfigured,
} from "@/lib/paymentOutcome";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Per-order Verify worker. Invoked by QStash (signed) or cron secret for backstop tests.
 * Body: { referenceNo: string, stepMinutes?: number, retry?: boolean }
 */
async function run(req: Request) {
  const rawBody = await req.text();
  let authorized = false;

  if (isQstashConfigured()) {
    authorized = await verifyQstashRequest(req, rawBody);
  }
  if (!authorized) {
    authorized =
      authorizeCron(req, process.env.CRON_SECRET) ||
      authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  }
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { referenceNo?: string; stepMinutes?: number; retry?: boolean } = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as typeof body) : {};
  } catch {
    body = {};
  }
  const url = new URL(req.url);
  const referenceNo = (body.referenceNo || url.searchParams.get("referenceNo") || "").trim();
  if (!referenceNo) {
    return NextResponse.json({ ok: false, error: "missing_referenceNo" }, { status: 400 });
  }

  const result = await applyVerifyForReference(referenceNo);
  if (result.outcome === "rate_limited") {
    await enqueueVerifyRetry(referenceNo, result.retryAfterMs || 120_000);
  }

  return NextResponse.json({ ok: true, result, ts: Date.now() });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
