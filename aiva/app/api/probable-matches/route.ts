import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getProbableMatches } from "@/lib/insights/drill";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only list of the name_probable webinar→enrollment matches for human review. Super-Admin only. */
export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const result = await getProbableMatches();
  await writeAudit({
    actor_id: gate.session.admin_id,
    actor_username: gate.session.username,
    action: "read:probable-matches",
    outcome: "read",
  });
  return NextResponse.json(result);
}
