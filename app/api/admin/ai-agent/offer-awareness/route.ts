/**
 * ADMIN AGENT API — offer awareness.
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 * Returns the SAME live offers the public agent can talk about (via the shared
 * offerResolver — published+active courses, OPEN webinars only), plus explicit
 * warnings when there's no active webinar / no active course so an admin can see
 * at a glance what the agent will and won't pitch. No PII.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getLiveOffers } from "@/lib/ai-agent/offerResolver";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const offers = await getLiveOffers(true);
    const warnings: string[] = [];
    if (offers.webinars.length === 0) {
      warnings.push("No active masterclass/webinar is open for registration — the agent will not pitch any webinar.");
    }
    if (offers.courses.length === 0) {
      warnings.push("No published+active course is live — the agent will not recommend any course.");
    }
    return NextResponse.json({
      ok: true,
      offers,
      counts: { courses: offers.courses.length, webinars: offers.webinars.length },
      warnings,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load offers." }, { status: 500 });
  }
}
