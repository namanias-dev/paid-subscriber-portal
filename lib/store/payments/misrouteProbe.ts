/**
 * Misrouting detector. The point of this file is that silence is not evidence.
 *
 * Isolation says a store reference can never end up in the academy ledger: the
 * dispatcher claims store callbacks before course code runs, applyCallbackAdvisory
 * is UPDATE-only so an escapee would match zero rows, and the payments.item_type
 * check constraint refuses a store row outright. Three layers, all believed to
 * hold — which is exactly the situation in which nobody notices when one stops.
 *
 * So we look, every cron tick. If a single row in public.payments ever carries a
 * NIASN reference, ops is paged immediately rather than finding it in a revenue
 * reconciliation weeks later.
 *
 * This is the ONE file permitted to read an academy table, and only like this:
 * a count, head-only, no columns returned, no mutation verb anywhere in the file.
 * The isolation guard enforces both halves of that sentence — see
 * scripts/ci/guard-store-domain-isolation.mjs, READ_ONLY_PROBE_ALLOWLIST.
 */
import { storeDb } from "@/lib/store/db";
import { storeOpsAlert } from "@/lib/store/alerts";
import { STORE_REFERENCE_SQL_LIKE } from "@/lib/store/references";

export interface StoreMisrouteProbeResult {
  checked: boolean;
  academyRowsWithStoreReference: number;
  alerted: boolean;
}

export async function storeMisrouteProbe(): Promise<StoreMisrouteProbeResult> {
  const db = storeDb();
  if (!db) return { checked: false, academyRowsWithStoreReference: 0, alerted: false };

  const { count, error } = await db
    .from("payments")
    .select("*", { count: "exact", head: true })
    .like("reference_no", STORE_REFERENCE_SQL_LIKE);

  if (error) {
    console.warn("[store/misrouteProbe] probe failed:", error.message);
    return { checked: false, academyRowsWithStoreReference: 0, alerted: false };
  }

  const found = count || 0;
  if (found === 0) return { checked: true, academyRowsWithStoreReference: 0, alerted: false };

  const alerted = await storeOpsAlert(
    [
      "🚨 <b>ISOLATION BREACH — store reference in the academy ledger</b>",
      `rows in <code>payments</code> with a NIASN reference: <b>${found}</b>`,
      "This should be impossible. Academy revenue figures are now suspect.",
      "Do not delete the rows: capture them, then work out which layer failed.",
    ].join("\n"),
  );
  console.error(`[store/misrouteProbe] ISOLATION BREACH: ${found} payments rows carry a store reference`);
  return { checked: true, academyRowsWithStoreReference: found, alerted };
}
