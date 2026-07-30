/**
 * Meta Lead Ads webhook — realtime leadgen receiver.
 *
 * GET  = hub.verify_token handshake (needed before META_LEADS_ENABLED).
 * POST = signed leadgen notification → Graph fetch → CRM ingest.
 *
 * Always ACK 200 for valid signatures after processing (including duplicates /
 * Graph failures stored as pending_retry) so Meta does not retry forever.
 */

import { NextResponse } from "next/server";
import { isMetaLeadsEnabled } from "@/lib/legacy-migration/flags";
import {
  missingMetaConfig,
  verifyMetaSignature,
  type MetaLeadgenPayload,
} from "@/lib/meta/leadAds";
import { ingestMetaLeadFromWebhook } from "@/lib/meta/ingestMetaLead";

export const dynamic = "force-dynamic";
/** Allow Graph + DB headroom; still aim for << 5s. */
export const maxDuration = 30;

const rateMap = new Map<string, { n: number; reset: number }>();

function rateLimit(ip: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const cur = rateMap.get(ip);
  if (!cur || now > cur.reset) {
    rateMap.set(ip, { n: 1, reset: now + windowMs });
    return true;
  }
  if (cur.n >= limit) return false;
  cur.n += 1;
  return true;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** GET = handshake. Meta sends hub.mode=subscribe + hub.verify_token + hub.challenge. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_LEADGEN_VERIFY_TOKEN;

  if (!expected) {
    return NextResponse.json(
      { ok: false, status: "disabled", missing: ["META_LEADGEN_VERIFY_TOKEN"] },
      { status: 501 },
    );
  }
  if (mode !== "subscribe" || token !== expected) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!challenge) return NextResponse.json({ ok: false, error: "Missing hub.challenge" }, { status: 400 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/** POST = notification. Signature required. */
export async function POST(request: Request) {
  const started = Date.now();
  const ip = clientIp(request);
  if (!rateLimit(ip)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }

  const rawBody = await request.text();
  const sig = request.headers.get("x-hub-signature-256");
  const signatureValid = verifyMetaSignature(rawBody, sig);
  if (!signatureValid) {
    console.warn("[meta-leadgen] invalid signature", { ip, ms: Date.now() - started });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  if (!isMetaLeadsEnabled()) {
    // ACK so subscription setup does not retry-storm while secrets are being filled.
    return NextResponse.json({
      ok: true,
      status: "disabled",
      missing: missingMetaConfig(),
      ms: Date.now() - started,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const payloads = extractLeadgenPayloads(body);
  if (payloads.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - started });
  }

  const results = [];
  for (const p of payloads) {
    const r = await ingestMetaLeadFromWebhook(p, {
      rawWebhook: body,
      signatureValid: true,
      startedAt: started,
    });
    results.push({
      leadgen_id: r.leadgenId,
      outcome: r.outcome,
      lead_id: r.leadId,
      ms: r.handlerMs,
      // phone last-4 only if present in error-free path — omit PII
    });
    console.info("[meta-leadgen]", {
      leadgen_id: r.leadgenId,
      outcome: r.outcome,
      ms: r.handlerMs,
      err: r.error ? r.error.slice(0, 120) : undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    ms: Date.now() - started,
  });
}

export function extractLeadgenPayloads(body: unknown): MetaLeadgenPayload[] {
  if (!body || typeof body !== "object") return [];
  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return [];
  const out: MetaLeadgenPayload[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const changes = (e as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      if (!c || typeof c !== "object") continue;
      const field = (c as { field?: string }).field;
      if (field && field !== "leadgen") continue;
      const v = (c as { value?: unknown }).value;
      if (!v || typeof v !== "object") continue;
      const val = v as Record<string, unknown>;
      const leadgenId = typeof val.leadgen_id === "string" ? val.leadgen_id : String(val.leadgen_id ?? "");
      const pageId = typeof val.page_id === "string" ? val.page_id : String(val.page_id ?? "");
      const formId = typeof val.form_id === "string" ? val.form_id : String(val.form_id ?? "");
      const createdTime = typeof val.created_time === "number" ? val.created_time : Number(val.created_time ?? 0);
      if (!leadgenId || !pageId || !formId) continue;
      out.push({
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        created_time: Number.isFinite(createdTime) ? createdTime : 0,
        ad_id: typeof val.ad_id === "string" ? val.ad_id : undefined,
        adgroup_id: typeof val.adgroup_id === "string" ? val.adgroup_id : undefined,
        campaign_id: typeof val.campaign_id === "string" ? val.campaign_id : undefined,
      });
    }
  }
  return out;
}
