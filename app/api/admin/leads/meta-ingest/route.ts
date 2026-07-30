/**
 * Admin: Meta Lead Ads ingestion observability + manual reconcile / retry.
 * GET  — recent ingestions + counts + token/config health
 * POST — { action: "reconcile" | "retry_pending" }
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMetaLeadsEnabled } from "@/lib/legacy-migration/flags";
import {
  listFormLeads,
  listPageLeadForms,
  missingMetaConfig,
} from "@/lib/meta/leadAds";
import {
  ingestCapturedGraphLead,
  retryPendingMetaIngestions,
} from "@/lib/meta/ingestMetaLead";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function tokenHealth(): {
  configured: boolean;
  missing: string[];
  enabled: boolean;
  pageIdSet: boolean;
} {
  const missing = missingMetaConfig().filter((m) => m !== "META_LEADS_ENABLED=true");
  return {
    configured: missing.length === 0,
    missing: missingMetaConfig(),
    enabled: isMetaLeadsEnabled(),
    pageIdSet: !!process.env.META_PAGE_ID,
  };
}

export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
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
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { action?: string; hours?: number };
    const action = body.action || "retry_pending";

    if (action === "retry_pending") {
      const result = await retryPendingMetaIngestions(50);
      return NextResponse.json({ ok: true, action, ...result });
    }

    if (action === "reconcile") {
      const pageId = process.env.META_PAGE_ID;
      if (!pageId) {
        return NextResponse.json({ ok: false, error: "META_PAGE_ID not set" }, { status: 400 });
      }
      const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 168);
      const sinceUnix = Math.floor(Date.now() / 1000) - hours * 3600;
      const forms = await listPageLeadForms(pageId);
      const summary = {
        forms: forms.length,
        scanned: 0,
        created: 0,
        attached_existing: 0,
        duplicate: 0,
        failed: 0,
        pending_retry: 0,
      };
      for (const form of forms) {
        const leads = await listFormLeads(form.id, { maxPages: 3, sinceUnix });
        for (const g of leads) {
          summary.scanned += 1;
          const r = await ingestCapturedGraphLead(pageId, { ...g, form_id: form.id }, {
            source: "admin_reconcile",
          });
          if (r.outcome in summary) {
            (summary as Record<string, number>)[r.outcome] += 1;
          }
        }
      }
      return NextResponse.json({ ok: true, action, hours, summary });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
