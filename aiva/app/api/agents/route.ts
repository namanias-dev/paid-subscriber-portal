import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { allAgents } from "@/lib/agents/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  return NextResponse.json({ ok: true, agents: allAgents() });
}
