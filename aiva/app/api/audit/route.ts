import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { readAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const entries = await readAudit(200);
  return NextResponse.json({ ok: true, entries });
}
