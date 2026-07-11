import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getApprovalInbox } from "@/lib/agents/models";
import { flags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const items = await getApprovalInbox();
  return NextResponse.json({ ok: true, items, readOnly: flags.readOnly });
}
