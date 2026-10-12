/**
 * Cutover containment: when enabled, only RPC session writers may mutate
 * enrollment money fields or receipts. PAID payments remain durable; drain
 * via finalize_course_payment_guarded afterward.
 */
import "server-only";
import { getSupabaseAdmin } from "../supabase";
import { tgLog } from "../telegram/log";

export async function setFinalizeContainment(enabled: boolean, reason: string, by = "agent"): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("payment_finalize_settings").upsert({
    id: 1,
    containment_enabled: enabled,
    containment_reason: reason,
    updated_at: new Date().toISOString(),
    updated_by: by,
  });
  if (error) {
    tgLog("finalize_containment_set_failed", { error: error.message, enabled }, "error");
    return false;
  }
  return true;
}

export async function getFinalizeContainment(): Promise<{ enabled: boolean; reason: string | null }> {
  const db = getSupabaseAdmin();
  if (!db) return { enabled: false, reason: null };
  const { data } = await db
    .from("payment_finalize_settings")
    .select("containment_enabled, containment_reason")
    .eq("id", 1)
    .maybeSingle();
  return {
    enabled: !!data?.containment_enabled,
    reason: (data?.containment_reason as string) || null,
  };
}

/** Drain PAID course payments lacking a completed finalize ledger row. */
export async function drainDeferredFinalizations(limit = 50): Promise<{
  attempted: number;
  ok: number;
  failed: number;
}> {
  const db = getSupabaseAdmin();
  if (!db) return { attempted: 0, ok: 0, failed: 0 };
  const { data: rows } = await db
    .from("payments")
    .select("id, reference_no, enrollment_id")
    .in("status", ["PAID", "captured"])
    .not("enrollment_id", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  const candidates = (rows || []) as { id: string; reference_no: string; enrollment_id: string }[];
  let attempted = 0;
  let ok = 0;
  let failed = 0;
  for (const p of candidates) {
    if (attempted >= limit) break;
    const { data: ledger } = await db
      .from("payment_finalize_ledger")
      .select("payment_id, status")
      .eq("payment_id", p.id)
      .maybeSingle();
    if (ledger?.status === "completed") continue;
    attempted++;
    const { data, error } = await db.rpc("finalize_course_payment_guarded", {
      p_reference_no: p.reference_no,
      p_due_fills: null,
    });
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      failed++;
      tgLog(
        "finalize_drain_failed",
        { ref: p.reference_no, error: error?.message || JSON.stringify(data) },
        "warn",
      );
    } else {
      ok++;
    }
  }
  return { attempted, ok, failed };
}
