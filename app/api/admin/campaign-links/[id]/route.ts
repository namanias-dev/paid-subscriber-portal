import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  getCampaignLink,
  updateCampaignLink,
  setCampaignLinkStatus,
  type CampaignLinkInput,
  type CampaignLinkStatus,
} from "@/lib/marketing/campaignLinks";
import { getCampaignLinkMetrics, getRecentClicks, EMPTY_METRICS } from "@/lib/marketing/campaignLinkAnalytics";
import { resolveRange, type RangePreset } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);
const PERM = "manage_students_leads" as const;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const link = await getCampaignLink(params.id);
    if (!link) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const { from, to } = resolveRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
    const [metrics, clicks] = await Promise.all([
      getCampaignLinkMetrics({ from, to }),
      getRecentClicks(link.id, 50),
    ]);
    return NextResponse.json({
      ok: true,
      link,
      metrics: metrics.get(link.short_code.toLowerCase()) || EMPTY_METRICS,
      clicks,
      range: { from, to },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load link." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.status === "string") {
      const status = body.status as CampaignLinkStatus;
      if (!["active", "paused", "archived"].includes(status)) {
        return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
      }
      const link = await setCampaignLinkStatus(params.id, status);
      if (!link) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
      return NextResponse.json({ ok: true, link });
    }
    const patch = body as Partial<CampaignLinkInput>;
    const link = await updateCampaignLink(params.id, patch);
    if (!link) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not update link.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
