/**
 * AI Counselor Agent — WORKER ENDPOINT GUARD. PHASE 5.
 *
 * Shared entry gate for every `/api/ai-agent/worker/*` endpoint. It:
 *   1. Returns a 404 when AI_AGENT_HMAC_SECRET is unset — so the whole worker
 *      surface is INVISIBLE by default (nothing is exposed in production).
 *   2. Reads the RAW request body and verifies the HMAC signature + timestamp +
 *      nonce (replay guard) before the caller does anything.
 *   3. Returns the parsed JSON body only after verification passes.
 *
 * Callers use it like:
 *   const gate = await guardWorkerRequest(req);
 *   if (!gate.ok) return gate.response;   // 404 / 401 already formed
 *   const body = gate.body;               // verified, parsed JSON
 */

import { NextResponse } from "next/server";
import { getAiAgentWorkerConfig } from "@/lib/ai-agent/config";
import { verifyHmacRequest, HMAC_HEADERS } from "./hmac";

export interface WorkerGuardOk {
  ok: true;
  body: Record<string, unknown>;
  rawBody: string;
}
export interface WorkerGuardFail {
  ok: false;
  response: NextResponse;
}
export type WorkerGuardResult = WorkerGuardOk | WorkerGuardFail;

export async function guardWorkerRequest(req: Request): Promise<WorkerGuardResult> {
  const { hmacSecret, hmacMaxSkewMs } = getAiAgentWorkerConfig();

  // Disabled by default: without a secret the entire surface returns 404 so it
  // cannot even be probed in production.
  if (!hmacSecret) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const rawBody = await req.text().catch(() => "");
  const result = verifyHmacRequest({
    rawBody,
    timestamp: req.headers.get(HMAC_HEADERS.timestamp),
    nonce: req.headers.get(HMAC_HEADERS.nonce),
    signature: req.headers.get(HMAC_HEADERS.signature),
    secret: hmacSecret,
    maxSkewMs: hmacMaxSkewMs,
  });

  if (!result.ok) {
    // "disabled" shouldn't be reachable here (secret present), but treat it as
    // 404 for safety. Everything else is a 401 with no detail.
    const status = result.reason === "disabled" ? 404 : 401;
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status }) };
  }

  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      /* tolerate empty/non-JSON bodies; body stays {} */
    }
  }
  return { ok: true, body, rawBody };
}
