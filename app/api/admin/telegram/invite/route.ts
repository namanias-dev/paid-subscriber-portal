import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { genericCampaignLink, inviteLinkForLead } from "@/lib/telegram/deepLinks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["manage_students_leads", "telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  const campaign = url.searchParams.get("campaign");

  if (leadId) {
    const link = await inviteLinkForLead(leadId);
    if (!link) {
      return NextResponse.json(
        { ok: false, error: "bot_username_not_configured" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, link, leadId });
  }

  if (campaign) {
    const link = await genericCampaignLink(campaign);
    if (!link) {
      return NextResponse.json(
        { ok: false, error: "bot_username_not_configured" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, link, campaign });
  }

  return NextResponse.json({ ok: false, error: "leadId_or_campaign_required" }, { status: 400 });
}
