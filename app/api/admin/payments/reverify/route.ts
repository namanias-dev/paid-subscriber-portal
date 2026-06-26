import { NextResponse } from "next/server";
import { reverifyPayments, type ReverifyOptions } from "@/lib/dataProvider";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";
// ICICI Verify calls are rate-limited and batched; give the function room to run.
export const maxDuration = 60;

/**
 * Admin "Re-verify payments" — re-checks NON-paid payments against ICICI's
 * Verify URL (live) + stored callback evidence, updating PAID / FAILED /
 * ABANDONED accordingly. Powers the global button (all or filtered), the per-row
 * button (referenceNos), and the Step-0 recovery run.
 *
 * Read body:
 *   { dryRun?, referenceNos?, statuses?, itemTypes?, limit?, storedOnly?, withDetails? }
 *
 * Safety: never touches a PAID/captured row, never downgrades, idempotent.
 * A timer/admin can never PRODUCE a FAILED here — only an ICICI answer can.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAnyPermission(["manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Forbidden — payments access required." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<ReverifyOptions>;
  const opts: ReverifyOptions = {
    dryRun: body.dryRun === true,
    referenceNos: Array.isArray(body.referenceNos) ? body.referenceNos.filter(Boolean).slice(0, 1000) : undefined,
    statuses: Array.isArray(body.statuses) && body.statuses.length ? body.statuses : undefined,
    itemTypes: Array.isArray(body.itemTypes) && body.itemTypes.length ? body.itemTypes : undefined,
    limit: typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 1000) : 500,
    storedOnly: body.storedOnly === true,
    withDetails: body.withDetails === true,
  };

  try {
    const result = await reverifyPayments(opts);
    return NextResponse.json({ ok: true, dryRun: !!opts.dryRun, result });
  } catch (e) {
    console.error("[admin/payments/reverify] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
