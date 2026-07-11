/**
 * WORKER API — live offer knowledge (HMAC-gated). PHASE 5.
 *
 * Returns the SAME public-safe live offers the guided-flow engine can pitch (via
 * the shared offerResolver — published+active courses, OPEN webinars only). This
 * lets the worker's refreshOfferKnowledge task summarize what's currently on
 * offer. No PII is ever involved. offerResolver is the single source of truth for
 * prices/dates — the model NEVER sees or sets them authoritatively.
 *
 * DISABLED (404) unless AI_AGENT_HMAC_SECRET is set.
 */
import { NextResponse } from "next/server";
import { guardWorkerRequest } from "@/lib/ai-agent/security/workerGuard";
import { getLiveOffers } from "@/lib/ai-agent/offerResolver";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await guardWorkerRequest(req);
  if (!gate.ok) return gate.response;

  try {
    const offers = await getLiveOffers(true);
    return NextResponse.json({
      ok: true,
      offers,
      counts: { courses: offers.courses.length, webinars: offers.webinars.length },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load offers." }, { status: 500 });
  }
}
