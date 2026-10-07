import { requirePermission } from "@/lib/adminGuard";
import { NextResponse } from "next/server";
import { listCampaignLinks } from "@/lib/marketing/campaignLinks";
import { getCampaignLinkMetrics, EMPTY_METRICS } from "@/lib/marketing/campaignLinkAnalytics";
import { resolveRange, type RangePreset } from "@/lib/analytics/queries";
import { CAMPAIGN_SITE_URL } from "@/lib/marketing/campaignLink";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);
const PERM = "manage_students_leads" as const;

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  if (!(await requirePermission(PERM))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
  const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
  const { from, to } = resolveRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
  const [links, metrics] = await Promise.all([listCampaignLinks({ status: "all" }), getCampaignLinkMetrics({ from, to })]);

  const head = [
    "name", "short_link", "destination", "source", "medium", "campaign", "adset", "ad", "creative",
    "clicks", "unique_visitors", "registrations", "leads", "checkout_started", "orders",
    "paid_admissions", "paid_webinars", "revenue", "click_to_registration_pct", "registration_to_paid_pct", "status",
  ];
  const lines = [head.join(",")];
  for (const l of links) {
    const m = metrics.get(l.short_code.toLowerCase()) || EMPTY_METRICS;
    lines.push([
      esc(l.name), esc(`${CAMPAIGN_SITE_URL}/go/${l.short_code}`), esc(l.destination_url),
      esc(l.source), esc(l.medium), esc(l.campaign), esc(l.adset_name), esc(l.ad_name), esc(l.creative_name),
      m.clicks, m.uniqueVisitors, m.registrations, m.leads, m.checkoutStarted, m.orders,
      m.paidAdmissions, m.paidWebinars, m.revenue,
      m.clickToRegistration ?? "", m.registrationToPaid ?? "", esc(l.status),
    ].join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-links-${preset}.csv"`,
    },
  });
}
