import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getRecentPulses } from "@/lib/events/projection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;
  const pulses = await getRecentPulses();
  return NextResponse.json({ ok: true, pulses });
}
