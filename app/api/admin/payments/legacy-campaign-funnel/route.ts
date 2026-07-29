/**
 * Read-only legacy campaign → conversion funnel for the Payments analytics strip.
 * Separate from GET /api/admin/payments so the main page never blocks on it.
 * Short in-memory TTL — aggregate is ~16ms index-backed; cache stops stampede.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ttlCached } from "@/lib/ttlCache";
import {
  assertFunnelReconciles,
  mapRpcRows,
  sumFunnelRows,
  type LegacyCampaignFunnelResult,
} from "@/lib/marketing/legacyCampaignFunnel";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

export async function GET() {
  try {
    if (!(await requirePermission("manage_payments"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { value, cache } = await ttlCached("legacy-campaign-funnel-v1", TTL_MS, async () => {
      const db = getSupabaseAdmin();
      if (!db) throw new Error("No supabase admin");
      const t0 = Date.now();
      const { data, error } = await db.rpc("legacy_campaign_conversion_funnel");
      if (error) throw new Error(error.message);
      const rows = mapRpcRows((data || []) as Parameters<typeof mapRpcRows>[0]);
      for (const r of rows) {
        if (!assertFunnelReconciles(r)) {
          throw new Error(`Funnel reconciliation failed for campaign=${r.campaign}`);
        }
      }
      const totals = sumFunnelRows(rows);
      if (rows.length && !assertFunnelReconciles(totals)) {
        throw new Error("Funnel totals reconciliation failed");
      }
      const result: LegacyCampaignFunnelResult = {
        rows,
        totals,
        generatedAt: new Date().toISOString(),
        queryMs: Date.now() - t0,
      };
      return result;
    });

    return NextResponse.json({ ok: true, cache, funnel: value });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load funnel";
    console.error("[legacy-campaign-funnel]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
