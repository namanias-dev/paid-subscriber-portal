import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getAllLeadsRaw } from "@/lib/dataProvider";
import { istInputToISO } from "@/lib/dates";
import { aggregateLeadCampaigns } from "@/lib/marketing/campaignReport";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * First-party Campaign Performance: groups CRM leads by utm_campaign / channel
 * over an IST date range and joins the downstream webinar-reg / sign-up flags
 * already on each lead. Read-only, gated by the Leads permission. No spend/CPC
 * (that needs the Google Ads API — see lib/marketing/googleAdsStub.ts).
 */
export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");
    if (!fromStr || !toStr || !YMD.test(fromStr) || !YMD.test(toStr)) {
      return NextResponse.json({ ok: false, error: "from/to (YYYY-MM-DD) required." }, { status: 400 });
    }
    const fromISO = istInputToISO(`${fromStr}T00:00`);
    const toISO = istInputToISO(`${toStr}T23:59`);
    const fromMs = new Date(fromISO).getTime();
    const toMs = new Date(toISO).getTime();

    const all = await getAllLeadsRaw();
    const inRange = all.filter((l) => {
      if (l.merged_into) return false;
      const ms = new Date(l.created_at).getTime();
      return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
    });

    const report = aggregateLeadCampaigns(inRange);
    return NextResponse.json({ ok: true, range: { from: fromISO, to: toISO }, report });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load campaign performance." }, { status: 500 });
  }
}
