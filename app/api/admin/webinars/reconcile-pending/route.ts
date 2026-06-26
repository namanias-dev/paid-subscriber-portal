import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifyFromStoredCallback } from "@/lib/eazypay";
import type { Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * ONE-TIME BACKFILL — reconcile EXISTING pending webinar payments.
 *
 * STRICT SCOPE: only rows in `payments` with item_type='webinar' AND a pending
 * status ('PENDING' or legacy 'pending'). PAID/captured/FAILED/refunded and free
 * webinars are NEVER selected and NEVER written. Every UPDATE re-asserts the
 * pending guard, so a row that settled in the meantime can't be touched
 * (idempotent, re-runnable, never downgrades).
 *
 * Decision per stale row (pending longer than the timeout):
 *   - stored gateway evidence says paid  -> PAID  (rescues a paid-but-stuck row)
 *   - stored gateway evidence says failed -> FAILED
 *   - no evidence (unknown):
 *       mode "verify" (default) -> LEAVE pending (fail-safe; needs ICICI status API)
 *       mode "expire"           -> FAILED (you accept the risk for unverifiable rows)
 * Recent pending rows (within the timeout) are always left as-is.
 *
 * Body: { dryRun?: boolean = true, mode?: "verify" | "expire" = "verify", limit?: number }
 */
const PENDING_STATUSES = ["PENDING", "pending"];
const BATCH = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Decision = "stay_pending" | "to_paid" | "to_failed" | "needs_verification";

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // default TRUE — must be explicitly disabled to write
  const mode: "verify" | "expire" = body.mode === "expire" ? "expire" : "verify";
  const limit = Number.isFinite(body.limit) ? Math.max(1, Number(body.limit)) : undefined;
  const timeoutMinutes = Number(process.env.WEBINAR_PENDING_TIMEOUT_MINUTES || 10);
  const cutoffMs = timeoutMinutes * 60_000;

  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Database not configured (demo mode) — nothing to reconcile." }, { status: 400 });
  }

  // 1) Select ONLY pending webinar payments.
  let query = db.from("payments").select("*").eq("item_type", "webinar").in("status", PENDING_STATUSES).order("created_at", { ascending: true });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const rows = (data as Payment[]) ?? [];

  // 2) Safety assertion: confirm NOTHING settled slipped into scope.
  const paidInScope = rows.filter((r) => r.status === "PAID" || r.status === "captured").length;
  const failedInScope = rows.filter((r) => r.status === "FAILED" || r.status === "refunded").length;

  const now = Date.now();
  const counts = { stay_pending: 0, to_paid: 0, to_failed: 0, needs_verification: 0 };
  const toPaid: string[] = [];
  const toFailed: string[] = [];
  const sample: { reference_no: string | null; ageMinutes: number; decision: Decision; evidence: string }[] = [];

  for (const r of rows) {
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : NaN;
    const ageMs = Number.isFinite(createdMs) ? now - createdMs : Infinity; // legacy/no-timestamp -> treat as stale
    const stale = ageMs > cutoffMs;

    let decision: Decision;
    const evidence = verifyFromStoredCallback(r);

    if (!stale) {
      decision = "stay_pending";
    } else if (evidence === "paid") {
      decision = "to_paid";
    } else if (evidence === "failed") {
      decision = "to_failed";
    } else {
      // unknown
      decision = mode === "expire" ? "to_failed" : "needs_verification";
    }

    counts[decision] += 1;
    if (decision === "to_paid") toPaid.push(r.id);
    if (decision === "to_failed") toFailed.push(r.id);
    if (sample.length < 25) {
      sample.push({
        reference_no: r.reference_no ?? null,
        ageMinutes: Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : -1,
        decision,
        evidence,
      });
    }
  }

  const summary = {
    ok: true,
    dryRun,
    mode,
    timeoutMinutes,
    scope: { selectedPendingRows: rows.length, paidInScope, failedInScope },
    plan: counts,
    sample,
  };

  if (dryRun) {
    return NextResponse.json({ ...summary, wrote: false });
  }

  // 3) WRITE — pending-only guarded updates, batched. PAID never downgraded.
  let updatedPaid = 0;
  let updatedFailed = 0;
  const writeBatch = async (ids: string[], status: "PAID" | "FAILED") => {
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const { data: upd, error: uerr } = await db
        .from("payments")
        .update({ status })
        .in("id", chunk)
        .in("status", PENDING_STATUSES) // re-assert pending guard at write time
        .select("id");
      if (uerr) throw new Error(uerr.message);
      const n = (upd as { id: string }[] | null)?.length ?? 0;
      if (status === "PAID") updatedPaid += n;
      else updatedFailed += n;
      if (i + BATCH < ids.length) await sleep(150); // gentle rate-limit
    }
  };

  try {
    await writeBatch(toPaid, "PAID");
    await writeBatch(toFailed, "FAILED");
  } catch (e) {
    return NextResponse.json({ ...summary, wrote: true, error: (e as Error).message, updatedPaid, updatedFailed }, { status: 500 });
  }

  return NextResponse.json({ ...summary, wrote: true, updatedPaid, updatedFailed });
}
