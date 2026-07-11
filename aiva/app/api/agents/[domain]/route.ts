import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getAgentSnapshot } from "@/lib/agents/models";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { domain: string } }) {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const snapshot = await getAgentSnapshot(params.domain);
  if (!snapshot) return NextResponse.json({ ok: false, error: "Unknown agent." }, { status: 404 });
  await writeAudit({ actor_id: gate.session.admin_id, actor_username: gate.session.username, action: `read:agent:${params.domain}`, outcome: "read" });
  return NextResponse.json({ ok: true, snapshot });
}
