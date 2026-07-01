import { NextResponse } from "next/server";
import { reverifyPayments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
// Live ICICI Verify calls are ~1s each; a whole-backlog sweep needs headroom.
// 300s is the Vercel Pro ceiling (auto-clamped on smaller plans).
export const maxDuration = 300;

/**
 * One-shot HISTORICAL backlog re-verification (CRON_SECRET-gated, server-side).
 *
 * Unlike the scheduled cron (which only re-checks rows that are "due" on the
 * backoff schedule and skips anything past ICICI's T+3 window), this endpoint
 * re-verifies EVERY stuck non-paid row we pass it — including old ones — because
 * ICICI's Verify URL still returns an authoritative status for them.
 *
 * It reuses the SINGLE shared verifier (`reverifyPayments`) so it inherits the
 * exact status mapping (Success->PAID+settled; RIP/SIP->PAID+settlement
 * in-progress + access via the existing finalize path; Failed/Timeout/Expired->
 * FAILED; anything else->unchanged + flagged for review), the settlement flag,
 * the idempotent PAID side-effects, and the immutable payment_action_log audit.
 * Never downgrades a PAID row. Attributed to actor "system/backfill".
 *
 *   GET/POST /api/admin/payments/backfill-verify?secret=<CRON_SECRET>
 *     &dryRun=1                 -> report only (still calls ICICI, writes nothing)
 *     &statuses=VERIFYING,ABANDONED   (default: VERIFYING,PENDING,pending,ABANDONED)
 *     &limit=500                (1..1000)
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const dryRun = url.searchParams.get("dryRun") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 500, 1), 1000);
  const statuses = (url.searchParams.get("statuses") || "VERIFYING,PENDING,pending,ABANDONED")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const result = await reverifyPayments({
      statuses,
      itemTypes: ["webinar", "course"],
      limit,
      dryRun,
      withDetails: true,
      actor: { id: "system/backfill", name: "system/backfill", role: "backfill", isSuper: false },
    });
    return NextResponse.json({ ok: true, dryRun, result, ts: Date.now() });
  } catch (e) {
    console.error("[admin/payments/backfill-verify] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
