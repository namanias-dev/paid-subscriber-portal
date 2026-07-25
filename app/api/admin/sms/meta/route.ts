import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { getWebinars, getLeads, getAllCourses } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Lightweight pickers for the Send / Automations tabs.
 *
 * `includeLegacy: false` is spelled EXPLICITLY here. It used to rely on the
 * default of `getLeads()`, which made this SMS-adjacent surface silently
 * dependent on a default living in another file — one edit there would have
 * leaked 178k legacy sources into the send dropdowns. Phase 2 gives the CRM an
 * explicit legacy scope control, so every protected consumer must now state its
 * exclusion in its own source. Enforced by
 * `tests/legacy-crm-phase2/protected-consumers.test.ts`.
 */
export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [webinars, leads, courses] = await Promise.all([
    getWebinars(),
    getLeads({ includeLegacy: false }),
    getAllCourses(),
  ]);
  const leadSources = [...new Set(leads.map((l) => l.source).filter(Boolean))].sort();
  const leadStages = [...new Set(leads.map((l) => l.status).filter(Boolean))].sort();
  return NextResponse.json({
    ok: true,
    isSuperAdmin: await requireSuperAdmin(),
    // Operational content management (templates + variables). True for Admin and
    // Super Admin. Send-safety controls stay keyed off isSuperAdmin above.
    canManageSms: await requirePermission("manage_sms"),
    webinars: webinars.map((w) => ({ id: w.id, slug: w.slug, title: w.title, datetime: w.datetime })),
    courses: courses.map((c) => ({ id: c.id, slug: c.slug, title: c.title, price: c.price })),
    leadSources,
    leadStages,
  });
}
