import { NextResponse } from "next/server";
import { getLeads, getLeadsPaged, addLead } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { lookupLegacyLeadsByPhones } from "@/lib/marketing/legacyLeadMatch";

export const dynamic = "force-dynamic";

/**
 * Kanban / list endpoint. Legacy-imported rows (`attribution.legacy === true`)
 * are HIDDEN by default so the CRM doesn't inflate from ~1.3k to ~175k rows
 * overnight after the backfill runs. Pass `?include_legacy=1` (or `=true`) to
 * see the legacy universe — used by the future "Show legacy" toggle.
 */
export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const includeLegacyParam = url.searchParams.get("include_legacy");
    const includeLegacy = includeLegacyParam === "1" || includeLegacyParam === "true";
    if (includeLegacy) {
      // Full historical universe is ~175k rows. Interactive callers must page.
      const requested = Number(url.searchParams.get("limit") || 50);
      const limit = Math.min(100, Math.max(1, Number.isFinite(requested) ? requested : 50));
      const cursor = url.searchParams.get("cursor") || undefined;
      const page = await getLeadsPaged({ includeLegacy: true, limit, cursor });
      return NextResponse.json({
        ok: true,
        leads: page.rows,
        includeLegacy: true,
        paged: true,
        nextCursor: page.nextCursor,
        limit: page.limit,
        total: page.total,
      });
    }
    const leads = await getLeads({ includeLegacy: false });
    // Additive historical match for the CURRENT live set only (~1.1k phones).
    const legacyLeadByPhone = includeLegacy
      ? {}
      : await lookupLegacyLeadsByPhones(leads.map((l) => l.phone));
    return NextResponse.json({ ok: true, leads, includeLegacy, legacyLeadByPhone });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load leads." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.name || !body.phone) return NextResponse.json({ ok: false, error: "Name and phone required." }, { status: 400 });
    const lead = await addLead(body, "admin_manual");
    return NextResponse.json({ ok: true, lead });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to add lead." }, { status: 500 });
  }
}
