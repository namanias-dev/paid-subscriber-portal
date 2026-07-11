import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { TOOLS } from "@/lib/tools/registry";
import { canExecute } from "@/lib/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const tools = TOOLS.map((t) => {
    const gate = canExecute(t.risk);
    return { ...t, available: t.readonly && t.implemented && gate.allowed, blockedReason: gate.allowed ? undefined : gate.reason };
  });
  return NextResponse.json({ ok: true, tools });
}
