import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listTemplateOptions } from "@/lib/journey-automation/builderStore";

export const dynamic = "force-dynamic";

/**
 * DLT-approved template options for the SMS node selector. Each option binds to a
 * real automation_templates row (→ sms_templates FK), so a journey can only ever
 * reference an approved template. Requires journey_view.
 */
export async function GET() {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const options = await listTemplateOptions();
  return NextResponse.json({ ok: true, options });
}
