import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { getWebinars, getLeads } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Lightweight pickers for the Send / Automations tabs. */
export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [webinars, leads] = await Promise.all([getWebinars(), getLeads()]);
  const leadSources = [...new Set(leads.map((l) => l.source).filter(Boolean))].sort();
  const leadStages = [...new Set(leads.map((l) => l.status).filter(Boolean))].sort();
  return NextResponse.json({
    ok: true,
    isSuperAdmin: await requireSuperAdmin(),
    webinars: webinars.map((w) => ({ id: w.id, slug: w.slug, title: w.title, datetime: w.datetime })),
    leadSources,
    leadStages,
  });
}
