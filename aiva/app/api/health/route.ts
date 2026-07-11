import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getHealth } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const report = await getHealth();
  return NextResponse.json({ ok: true, report });
}
