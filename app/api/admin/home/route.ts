import { NextResponse } from "next/server";
import { getSiteSettings, updateSiteSettings } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import type { SiteSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const settings = await getSiteSettings();
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load settings." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Partial<SiteSettings>;

    // Clamp popup delay to a sane range so the popup can't be configured to never/instantly fire badly.
    if (body.popup && typeof body.popup.delay_seconds !== "undefined") {
      const d = Number(body.popup.delay_seconds);
      body.popup.delay_seconds = Number.isFinite(d) ? Math.min(120, Math.max(0, Math.round(d))) : 5;
    }

    const settings = await updateSiteSettings(body);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save settings.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
