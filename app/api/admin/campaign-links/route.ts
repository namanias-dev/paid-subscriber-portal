import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getAdminSession } from "@/lib/session";
import {
  createCampaignLink,
  listCampaignLinks,
  type CampaignLinkStatus,
  type DestinationType,
} from "@/lib/marketing/campaignLinks";
import { getCampaignLinkMetrics, EMPTY_METRICS } from "@/lib/marketing/campaignLinkAnalytics";
import { resolveRange, type RangePreset } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);
const PERM = "manage_students_leads" as const;

export async function GET(req: Request) {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const { from, to } = resolveRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
    const status = (url.searchParams.get("status") || "all") as CampaignLinkStatus | "all";
    const source = url.searchParams.get("source");
    const destination_type = (url.searchParams.get("destination_type") as DestinationType) || null;
    const search = url.searchParams.get("search");

    const [links, metrics] = await Promise.all([
      listCampaignLinks({ status, source, destination_type, search, limit: 100 }),
      getCampaignLinkMetrics({ from, to }),
    ]);

    const rows = links.map((l) => ({ link: l, metrics: metrics.get(l.short_code.toLowerCase()) || EMPTY_METRICS }));
    return NextResponse.json({ ok: true, range: { from, to }, rows });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load campaign links." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const session = await getAdminSession();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const link = await createCampaignLink({
      name: String(body.name || ""),
      destination_url: String(body.destination_url || ""),
      destination_type: (body.destination_type as DestinationType) || "custom",
      destination_id: (body.destination_id as string) ?? null,
      description: (body.description as string) ?? null,
      customAlias: (body.customAlias as string) ?? null,
      source: (body.source as string) ?? null,
      medium: (body.medium as string) ?? null,
      platform: (body.platform as string) ?? null,
      campaign: (body.campaign as string) ?? null,
      campaign_id_external: (body.campaign_id_external as string) ?? null,
      adset_name: (body.adset_name as string) ?? null,
      adset_id_external: (body.adset_id_external as string) ?? null,
      ad_name: (body.ad_name as string) ?? null,
      ad_id_external: (body.ad_id_external as string) ?? null,
      creative_name: (body.creative_name as string) ?? null,
      content: (body.content as string) ?? null,
      term: (body.term as string) ?? null,
      placement: (body.placement as string) ?? null,
      channel: (body.channel as string) ?? null,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      owner: (body.owner as string) ?? session?.username ?? null,
      created_by: session?.username ?? null,
    });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create link.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
