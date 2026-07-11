/**
 * WORKER API — signed health check (HMAC-gated). PHASE 5.
 *
 * Lets the local worker verify its HMAC secret + clock are correct before doing
 * real work. Returns 404 when AI_AGENT_HMAC_SECRET is unset (surface invisible
 * by default), 401 on a bad signature, and { ok:true } on success. Returns no
 * PII and touches no data.
 */
import { NextResponse } from "next/server";
import { guardWorkerRequest } from "@/lib/ai-agent/security/workerGuard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await guardWorkerRequest(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ ok: true, service: "ai-agent-worker", ts: new Date().toISOString() });
}
