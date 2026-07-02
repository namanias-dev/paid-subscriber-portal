import { NextResponse } from "next/server";
import { findLogsByMessageIds, updateLog } from "@/lib/sms/store";
import { mapDeliveryStatus } from "@/lib/sms/gateway";

export const dynamic = "force-dynamic";

/**
 * JustGoSMS delivery-receipt (DLR) callback. The gateway pushes the handset
 * outcome for a previously-submitted message here; we promote the matching
 * sms_logs row SENT -> DELIVERED / FAILED using the SAME mapDeliveryStatus() the
 * pull poller uses, so push and pull always agree. (A pull path via http-dlr.php
 * also runs on the cron; this push route just makes updates near-instant when the
 * panel is configured with a Delivery URL.)
 *
 * Security: requires ?token=<SMS_DLR_TOKEN> (falls back to CRON_SECRET). If no
 * secret is configured on the server the endpoint refuses (503) so it can't be
 * spoofed. Accepts GET (query) or POST (form / JSON) and tolerates the common
 * field-name variants panels use.
 *
 * Configure on the JustGoSMS panel (Delivery URL / Reseller URL), using their
 * placeholder tokens, e.g.:
 *   https://namanias.com/api/v1/sms/dlr?token=<SECRET>&msgid={msgid}&status={status}&number={number}
 */
const FIELD = {
  msgid: ["msgid", "msg-id", "msg_id", "messageid", "message_id", "message-id", "id", "smsid", "sms_id"],
  status: ["status", "dlr", "dlrstatus", "dlr_status", "deliverystatus", "delivery_status", "state"],
  number: ["number", "mobile", "msisdn", "to", "recipient"],
};

function pick(get: (k: string) => string | null, keys: string[]): string | null {
  for (const k of keys) {
    const v = get(k) ?? get(k.toUpperCase()) ?? get(k.toLowerCase());
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** All plausible spellings of a gateway message id (base64 padded/unpadded/decoded). */
function idVariants(raw: string): string[] {
  const out = new Set<string>();
  const v = raw.trim();
  if (!v) return [];
  out.add(v);
  out.add(v.replace(/=+$/, ""));
  try {
    const dec = Buffer.from(v, "base64").toString("utf8");
    if (dec && /^[\w.\-]+$/.test(dec)) out.add(dec);
  } catch { /* not base64 */ }
  try {
    const enc = Buffer.from(v, "utf8").toString("base64");
    out.add(enc);
    out.add(enc.replace(/=+$/, ""));
  } catch { /* ignore */ }
  return [...out];
}

async function handle(rawId: string | null, statusRaw: string | null, number: string | null): Promise<NextResponse> {
  if (!rawId) return NextResponse.json({ ok: false, error: "missing_msgid" }, { status: 400 });
  const mapped = mapDeliveryStatus(statusRaw);
  // Act only on terminal states. "Submitted" (SENT) is still in-flight; a truly
  // empty status is UNKNOWN. Everything else — incl. "Other" — is terminal FAILED.
  if (mapped !== "DELIVERED" && mapped !== "FAILED") {
    return NextResponse.json({ ok: true, matched: 0, note: "status_non_terminal", received: statusRaw, mapped });
  }
  const logs = await findLogsByMessageIds(idVariants(rawId));
  if (!logs.length) return NextResponse.json({ ok: true, matched: 0, note: "no_matching_log", msgid: rawId });

  let updated = 0;
  for (const l of logs) {
    if (l.status === "DELIVERED") continue; // already final-positive
    const prior = (l.gateway_response && typeof l.gateway_response === "object") ? (l.gateway_response as Record<string, unknown>) : {};
    await updateLog(l.id, {
      status: mapped,
      gateway_response: { ...prior, dlr: { status: statusRaw, mapped, number, at: new Date().toISOString() } },
      ...(mapped === "FAILED" && !l.error_message ? { error_message: `dlr:${statusRaw}` } : {}),
    });
    updated++;
  }
  return NextResponse.json({ ok: true, matched: logs.length, updated, status: mapped });
}

function authed(url: URL, req: Request): boolean {
  const secret = process.env.SMS_DLR_TOKEN || process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — must be configured
  const provided = url.searchParams.get("token") || req.headers.get("authorization")?.replace("Bearer ", "") || "";
  return provided === secret;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!process.env.SMS_DLR_TOKEN && !process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "dlr_not_configured" }, { status: 503 });
  if (!authed(url, req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const get = (k: string) => url.searchParams.get(k);
  return handle(pick(get, FIELD.msgid), pick(get, FIELD.status), pick(get, FIELD.number));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!process.env.SMS_DLR_TOKEN && !process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "dlr_not_configured" }, { status: 503 });
  if (!authed(url, req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const params = new Map<string, string>();
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = await req.json();
      for (const [k, v] of Object.entries(j || {})) params.set(k, String(v));
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) params.set(k, String(v));
    }
  } catch { /* fall back to query below */ }
  const get = (k: string) => params.get(k) ?? url.searchParams.get(k);
  return handle(pick(get, FIELD.msgid), pick(get, FIELD.status), pick(get, FIELD.number));
}
