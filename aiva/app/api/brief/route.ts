import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getDailyBrief } from "@/lib/revenue/dailyBrief";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const brief = await getDailyBrief(gate.session.name || "Aman");
  await writeAudit({ actor_id: gate.session.admin_id, actor_username: gate.session.username, action: "read:brief", outcome: "read" });
  return NextResponse.json({ ok: true, brief });
}
