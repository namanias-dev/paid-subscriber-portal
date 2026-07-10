/**
 * PUBLIC AGENT API — GET live offers.
 *
 * Returns ONLY live, bookable offers (published+active courses; OPEN webinars via
 * the lifecycle helper), fully PII-stripped, with SERVER-sourced prices. No
 * secrets, no admin data. Rate-limited per IP + per session.
 */
import { NextResponse } from "next/server";
import { getLiveOffers } from "@/lib/ai-agent/offerResolver";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = getAgentContext(req);
  const ipLimit = hit(`ai:offers:ip:${ctx.ip}`, 60, 60);
  const sidLimit = ctx.sessionId ? hit(`ai:offers:sid:${ctx.sessionId}`, 60, 60) : { allowed: true };
  if (!ipLimit.allowed || !sidLimit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  try {
    const offers = await getLiveOffers();
    return NextResponse.json({ ok: true, offers });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not load offers." }, { status: 500 });
  }
}
