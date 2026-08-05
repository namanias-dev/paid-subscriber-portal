import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2]!.trim().replace(/^["']|["']$/g, "");
  process.env[m[1]!.trim()] = v;
}

async function main() {
  const { getSupabaseAdmin } = await import("../lib/supabase");
  const { salesAlertsEnabled, salesDigestEnabled } = await import("../lib/telegram/sales/settings");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no db");
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const q = async (table: string, col: string, extra?: (x: any) => any) => {
    let x = db.from(table).select("id", { count: "exact", head: true }).gte(col, since);
    if (extra) x = extra(x);
    const { count, error } = await x;
    return { count: count ?? 0, error: error?.message || null };
  };
  const events = {
    payments_paid_updated: await q("payments", "updated_at", (x) => x.in("status", ["PAID", "paid"])),
    enrollments: await q("course_enrollments", "created_at"),
    proofs_submitted: await q("installment_payment_proofs", "submitted_at"),
    proofs_approved: await q("installment_payment_proofs", "reviewed_at", (x) =>
      x.in("status", ["approved", "approved_recorded"]),
    ),
    leads: await q("leads", "created_at"),
  };
  const { data: flags } = await db
    .from("app_feature_flags")
    .select("key,enabled,kill_switch")
    .in("key", ["sales_alerts_enabled", "sales_digest_enabled"]);
  const { data: snaps } = await db
    .from("telegram_report_snapshots")
    .select("slot_key,kind,metrics,created_at")
    .gte("created_at", since)
    .like("slot_key", "sales:%")
    .order("created_at", { ascending: false })
    .limit(50);
  console.log(
    JSON.stringify(
      {
        since,
        events,
        flagsDB: flags,
        alertsFn: await salesAlertsEnabled(),
        digestFn: await salesDigestEnabled(),
        snaps: (snaps || []).map((s) => ({
          kind: s.kind,
          key: s.slot_key,
          at: s.created_at,
          event: (s.metrics as any)?.event,
          mid: (s.metrics as any)?.message_id,
          reason: (s.metrics as any)?.reason,
        })),
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
