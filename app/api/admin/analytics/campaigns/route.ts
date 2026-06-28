import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getCampaignBreakdown, resolveRange, type RangePreset, type BreakdownDimension } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";
const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);
const DIMS: ReadonlySet<BreakdownDimension> = new Set(["campaign", "medium", "landing_path", "device"]);

export async function GET(req: Request) {
  try {
    if (!(await requirePermission("view_revenue"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const dimRaw = (url.searchParams.get("dimension") || "campaign") as BreakdownDimension;
    const dimension = DIMS.has(dimRaw) ? dimRaw : "campaign";
    const { from, to } = resolveRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
    const excludeAdmin = url.searchParams.get("excludeAdmin") === "1";
    const breakdown = await getCampaignBreakdown({ from, to, dimension, excludeAdmin });
    return NextResponse.json({ ok: true, breakdown });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load breakdown." }, { status: 500 });
  }
}
