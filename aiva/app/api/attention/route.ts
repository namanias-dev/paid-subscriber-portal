import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getAttention } from "@/lib/insights/attention";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only ranked attention flags for the Command Center strip. Super-Admin only. */
export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const { flags } = await getAttention();
  await writeAudit({
    actor_id: gate.session.admin_id,
    actor_username: gate.session.username,
    action: "read:attention",
    outcome: "read",
  });
  return NextResponse.json({ ok: true, flags });
}
