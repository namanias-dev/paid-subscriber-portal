import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listAssignableCounsellors, queueDepths, type LeadScope } from "@/lib/legacy-crm/bulkAssign";

export const dynamic = "force-dynamic";

/**
 * Who a lead can be assigned to, and how deep each queue already is.
 *
 * This endpoint exists because `leads.assigned_to` is free text with no foreign
 * key. Until now the only assignment UI was a text input, so a typo produced a
 * lead owned by nobody — "My Queue" matches the username exactly, so the lead
 * simply stopped appearing for anyone. At single-lead scale that is a nuisance;
 * at 1,000 rows it is a silent hole in the pipeline.
 *
 * Eligibility is `manage_students_leads`, the same permission that gates the
 * worklist, because assigning work to someone who cannot open the screen is
 * never deliberate. Disabled accounts are excluded.
 *
 * Gated on `manage_students_leads` rather than `manage_staff`: this returns the
 * usernames of people who handle leads, which anyone working the worklist can
 * already see in the assignee column. It deliberately does not return emails,
 * phone numbers, ids or permission sets.
 */
export async function GET(req: Request) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const scope: LeadScope =
    scopeParam === "live" || scopeParam === "all" ? scopeParam : "legacy";

  try {
    const [counsellors, depths] = await Promise.all([
      listAssignableCounsellors(),
      queueDepths(scope),
    ]);
    const depthBy = new Map(depths.map((d) => [d.username, d.depth]));

    return NextResponse.json({
      ok: true,
      scope,
      counsellors: counsellors.map((c) => ({
        username: c.username,
        name: c.name,
        role: c.role,
        queueDepth: depthBy.get(c.username) ?? 0,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to list assignees." },
      { status: 500 },
    );
  }
}
