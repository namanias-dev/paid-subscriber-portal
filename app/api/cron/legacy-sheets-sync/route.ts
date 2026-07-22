/**
 * Phase 2B — ongoing Google Sheets sync cron endpoint.
 *
 * DEFAULT OFF. Returns 501 (Not Implemented) with a diagnostic body until an
 * operator flips SHEETS_SYNC_ENABLED=true AND supplies GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.
 *
 * When enabled: this route walks every included tab, applies the exact same
 * transform + dedupe as the one-time importer, and inserts NEW phones only.
 * Existing phones are left alone (first-touch stays frozen). Watermark is
 * advanced in `public.legacy_import_sync_state` so subsequent runs are cheap.
 *
 * IMPORTANT: The sync inserts rows WITHOUT firing `lead_created` events. Live
 * sheet arrivals are ambiguous (organic vs re-imported vs manual paste), so the
 * safest default is to never enrol them into Journey Automations or SMS blasts.
 * A future flip to fire events would require a bespoke source_form value and a
 * consent audit — filed as a TODO below, not shipped here.
 */

import { NextResponse } from "next/server";
import { isSheetsSyncEnabled } from "@/lib/legacy-migration/flags";
import { syncAllTabs } from "@/lib/legacy-migration/sheetsSync";

export const dynamic = "force-dynamic";

// TODO(sheets-sync-events): once we're comfortable that live sheet arrivals should
// trigger Journey Automation, wire a new source_form="legacy_sheet_live" here and
// call fireAutomationEvent(...). Keep the default OFF gating on that separately.

async function isCronAuthorized(request: Request): Promise<boolean> {
  // Vercel Cron sets `Authorization: Bearer $CRON_SECRET` on its outbound calls.
  // Also accept a plain-header opt-in for the same secret to allow manual replays.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSheetsSyncEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        status: "disabled",
        message:
          "Sheets sync is disabled. Set SHEETS_SYNC_ENABLED=true and GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON in the environment to activate.",
      },
      { status: 501 },
    );
  }
  try {
    const outcomes = await syncAllTabs();
    return NextResponse.json({ ok: true, outcomes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
