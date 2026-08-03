import { NextResponse } from "next/server";
import {
  verifyQstashRequest,
  applyVerifyForReference,
  enqueueVerifyRetry,
  isQstashConfigured,
} from "@/lib/paymentOutcome";
import { maybeNotifyLadderOkOnce } from "@/lib/paymentOutcome/ladderOkNotify";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { tgLog } from "@/lib/telegram/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Per-order Verify worker. Invoked by QStash (signed) or cron secret for backstop tests.
 * Body: { referenceNo: string, stepMinutes?: number, retry?: boolean }
 *
 * Signature verification MUST use the raw body string before JSON.parse.
 */
async function run(req: Request) {
  const rawBody = await req.text();
  let viaQstash = false;
  let authorized = false;

  if (isQstashConfigured()) {
    viaQstash = await verifyQstashRequest(req, rawBody);
    authorized = viaQstash;
  }
  if (!authorized) {
    authorized =
      authorizeCron(req, process.env.CRON_SECRET) ||
      authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  }

  let body: { referenceNo?: string; stepMinutes?: number; retry?: boolean } = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as typeof body) : {};
  } catch {
    body = {};
  }
  const url = new URL(req.url);
  const referenceNo = (body.referenceNo || url.searchParams.get("referenceNo") || "").trim();
  const stepMinutes =
    body.stepMinutes != null && Number.isFinite(Number(body.stepMinutes))
      ? Number(body.stepMinutes)
      : null;

  tgLog(
    "qstash_verify_inbound",
    {
      ref: referenceNo || null,
      signatureOk: viaQstash,
      authorized,
      viaQstash,
      stepMinutes,
      retry: !!body.retry,
      hasUpstashHeader: !!req.headers.get("upstash-signature"),
    },
    authorized ? "info" : "warn",
  );

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!referenceNo) {
    return NextResponse.json({ ok: false, error: "missing_referenceNo" }, { status: 400 });
  }

  const result = await applyVerifyForReference(referenceNo);
  tgLog(
    "qstash_verify_result",
    {
      ref: referenceNo,
      viaQstash,
      stepMinutes,
      from: result.from,
      to: result.to,
      outcome: result.outcome,
      changed: result.changed,
      newlyPaid: result.newlyPaid,
      rawStatus: result.rawStatus,
    },
    "info",
  );

  if (result.outcome === "rate_limited") {
    await enqueueVerifyRetry(referenceNo, result.retryAfterMs || 120_000);
  }

  if (viaQstash) {
    await maybeNotifyLadderOkOnce(result, { stepMinutes, viaQstash: true }).catch(() => {});
  }

  return NextResponse.json({ ok: true, result, viaQstash, ts: Date.now() });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
