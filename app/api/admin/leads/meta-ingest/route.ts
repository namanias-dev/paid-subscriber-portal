/**
 * Admin: Meta Lead Ads ingestion observability + manual reconcile / retry.
 * GET  — recent ingestions + counts + token/config health
 * POST — { action: "reconcile" | "retry_pending" }
 *
 * Reconcile/retry also accept Authorization: Bearer $CRON_SECRET for ops runs
 * (same pattern as other cron routes).
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMetaLeadsEnabled } from "@/lib/legacy-migration/flags";
import {
  missingMetaConfig,
  missingMetaPageToken,
  reconcileMetaLeadsLastHours,
} from "@/lib/meta/leadAds";
import { retryPendingMetaIngestions } from "@/lib/meta/ingestMetaLead";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function tokenHealth(): {
  configured: boolean;
  missing: string[];
  enabled: boolean;
  pageIdSet: boolean;
  pageTokenSet: boolean;
} {
  const missing = missingMetaConfig().filter((m) => m !== "META_LEADS_ENABLED=true");
  return {
    configured: missing.length === 0,
    missing: [...missingMetaConfig(), ...missingMetaPageToken()],
    enabled: isMetaLeadsEnabled(),
    pageIdSet: !!process.env.META_PAGE_ID,
    pageTokenSet: missingMetaPageToken().length === 0,
  };
}

async function allowMetaOps(request: Request): Promise<boolean> {
  if (await requirePermission("manage_students_leads")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    new URL(request.url).searchParams.get("secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return !!provided && provided === secret;
}

export async function GET(request: Request) {
  try {
    if (!(await allowMetaOps(request))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Database unavailable" }, { status: 503 });

    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ data: recent }, { data: dayRows }, { count: pendingCount }] = await Promise.all([
      db
        .from("meta_lead_ingestions")
        .select(
          "id,leadgen_id,lead_id,campaign_name,form_name,platform,outcome,error_message,handler_ms,ingested_at,meta_created_at,phone_key,no_usable_contact,signature_valid",
        )
        .order("ingested_at", { ascending: false })
        .limit(50),
      db
        .from("meta_lead_ingestions")
        .select("outcome,ingested_at")
        .gte("ingested_at", since24h),
      db
        .from("meta_lead_ingestions")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "pending_retry"),
    ]);

    const counts: Record<string, number> = {};
    for (const r of dayRows || []) {
      counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    }
    const lastReceived = recent?.[0]?.ingested_at || null;
    const silenceHours = lastReceived
      ? (Date.now() - new Date(lastReceived).getTime()) / 3600_000
      : null;

    return NextResponse.json({
      ok: true,
      report: {
        health: tokenHealth(),
        lastReceived,
        silenceHours,
        silenceAlert: silenceHours != null && silenceHours > 48,
        pendingRetry: pendingCount ?? 0,
        last24h: counts,
        recent: recent || [],
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!(await allowMetaOps(request))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { action?: string; hours?: number };
    const action = body.action || "retry_pending";

    if (action === "retry_pending") {
      const result = await retryPendingMetaIngestions(50);
      return NextResponse.json({ ok: true, action, ...result });
    }

    if (action === "reconcile") {
      const summary = await reconcileMetaLeadsLastHours(body.hours || 24);
      return NextResponse.json({ ok: true, action, hours: summary.hours, summary });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
