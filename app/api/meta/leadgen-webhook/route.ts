/**
 * Phase 2C — Meta Lead Ads webhook stub.
 *
 * Meta's webhook subscription requires:
 *   - GET  handshake: echo `hub.challenge` when `hub.verify_token` matches ours.
 *   - POST notification: JSON body with `entry[].changes[].value.leadgen_id`.
 *
 * This route implements ONLY the handshake gate. The POST path is 501 until
 * META_LEADS_ENABLED=true AND all required env vars are set, in which case it
 * forwards to lib/meta/leadAds.ts (also a scaffold — the actual Graph API fetch
 * is deliberately unimplemented).
 *
 * NEVER enable in production without: (a) App Review pass for `leads_retrieval`,
 * (b) a stable long-lived-token refresh cron, and (c) a per-page opt-in check.
 */

import { NextResponse } from "next/server";
import { isMetaLeadsEnabled } from "@/lib/legacy-migration/flags";
import { fetchLeadgenRecord, missingMetaConfig, type MetaLeadgenPayload } from "@/lib/meta/leadAds";

export const dynamic = "force-dynamic";

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

/** POST = notification. Only opens a Graph fetch when the full config is present. */
export async function POST(request: Request) {
  if (!isMetaLeadsEnabled()) {
    return NextResponse.json(
      { ok: false, status: "disabled", missing: missingMetaConfig() },
      { status: 501 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const payloads = extractLeadgenPayloads(body);
  if (payloads.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  // Not implemented — the fetch throws until an operator wires the Graph fetch.
  try {
    for (const p of payloads) await fetchLeadgenRecord(p);
    return NextResponse.json({ ok: true, processed: payloads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 501 });
  }
}

function extractLeadgenPayloads(body: unknown): MetaLeadgenPayload[] {
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
        created_time: createdTime,
        ad_id: typeof val.ad_id === "string" ? val.ad_id : undefined,
        adgroup_id: typeof val.adgroup_id === "string" ? val.adgroup_id : undefined,
        campaign_id: typeof val.campaign_id === "string" ? val.campaign_id : undefined,
      });
    }
  }
  return out;
}
