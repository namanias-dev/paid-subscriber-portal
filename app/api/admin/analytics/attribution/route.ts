import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getMetaAttribution, resolveRange, type RangePreset } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";
const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);

export async function GET(req: Request) {
  try {
    if (!(await requirePermission("view_revenue"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const { from, to } = resolveRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
    const excludeAdmin = url.searchParams.get("excludeAdmin") === "1";
    const report = await getMetaAttribution({ from, to, excludeAdmin });
    return NextResponse.json({ ok: true, report });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load attribution report." }, { status: 500 });
  }
}
