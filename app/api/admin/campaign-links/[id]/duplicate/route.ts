import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getAdminSession } from "@/lib/session";
import { duplicateCampaignLink, type CampaignLinkInput } from "@/lib/marketing/campaignLinks";

export const dynamic = "force-dynamic";
const PERM = "manage_students_leads" as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const session = await getAdminSession();
    const body = (await req.json().catch(() => ({}))) as Partial<CampaignLinkInput>;
    const link = await duplicateCampaignLink(params.id, { ...body, created_by: session?.username ?? null });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not duplicate link.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
