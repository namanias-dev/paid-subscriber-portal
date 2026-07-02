/**
 * JustGoSMS HTTP gateway call (BACKEND-ONLY). Credentials are read from env at
 * call time and NEVER logged or returned to the client. The exact `number` wire
 * format is configurable via SMS_NUMBER_FORMAT (confirm against a JustGoSMS sample).
 */
import { SMS_API_BASE_URL, SMS_DLR_BASE_URL, SMS_DEFAULT_ROUTE, SMS_DEFAULT_SENDER_ID, smsNumberFormat } from "./config";
import type { SmsLogStatus } from "./types";

export interface GatewaySendInput {
  digits10: string;
  message: string;
  templateId: string; // DLT template id (gateway templateid)
  senderId?: string;
  route?: string;
}

export interface GatewayResult {
  ok: boolean;
  /**
   * ONLY reflects whether the gateway ACCEPTED the request. "SENT" here means
   * "Submitted Successfully" (accepted for delivery) — it is NEVER a delivery
   * confirmation. Real DELIVERED/FAILED must come from the DLR status source
   * (fetchDeliveryStatus / the pull poller), not from this send response.
   */
  status: "SENT" | "FAILED";
  messageId: string | null;
  /** Sanitised response for the log (no credentials). */
  response: { httpStatus?: number; body?: string; error?: string };
}

function wireNumber(digits10: string): string {
  return smsNumberFormat() === "91prefix" ? `91${digits10}` : digits10;
}

/** Best-effort message-id extraction from common aggregator responses. */
function extractMessageId(body: string): string | null {
  const m =
    body.match(/(?:message-?id|msgid|id)["':=\s]+([A-Za-z0-9._-]{4,})/i) ||
    body.match(/\b([0-9]{8,})\b/);
  return m ? m[1] : null;
}

/** Heuristic success detection for plain-text HTTP gateways. */
function looksSuccessful(httpStatus: number, body: string): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  return !/(error|invalid|fail|unauthori|insufficient|denied|reject)/i.test(body);
}

export async function sendViaGateway(input: GatewaySendInput): Promise<GatewayResult> {
  const authKey = process.env.SMS_API_AUTH_KEY;
  const username = process.env.SMS_API_USERNAME;
  const password = process.env.SMS_API_PASSWORD;
  if (!authKey || !username || !password) {
    return { ok: false, status: "FAILED", messageId: null, response: { error: "gateway_not_configured" } };
  }

  const params = new URLSearchParams({
    "authentic-key": authKey,
    username,
    password,
    route: input.route || SMS_DEFAULT_ROUTE,
    number: wireNumber(input.digits10),
    templateid: input.templateId,
    message: input.message,
    senderid: input.senderId || SMS_DEFAULT_SENDER_ID,
  });

  try {
    const res = await fetch(`${SMS_API_BASE_URL}?${params.toString()}`, { method: "GET", cache: "no-store" });
    const body = (await res.text()).slice(0, 2000);
    const ok = looksSuccessful(res.status, body);
    return {
      ok,
      status: ok ? "SENT" : "FAILED",
      messageId: ok ? extractMessageId(body) : null,
      response: { httpStatus: res.status, body },
    };
  } catch (e) {
    return { ok: false, status: "FAILED", messageId: null, response: { error: (e as Error).message } };
  }
}

// ---------------------------------------------------------------------------
// Delivery reports (DLR) — PULL via http-dlr.php + shared status mapping.
// Used by BOTH the pull poller and the push callback so there is one source of
// truth for how a provider status string maps to our log status.
// ---------------------------------------------------------------------------

/**
 * Map any provider/callback status token to our canonical log status.
 * Order matters:
 *  1. DELIVERED  -> confirmed on handset (checked before in-flight so it wins).
 *  2. in-flight  -> "Submitted"/"Sent"/pending == accepted by gateway, NOT terminal.
 *  3. FAILED     -> everything else that is a REAL settled status.
 *
 * IMPORTANT — JustGoSMS "Other": http-dlr.php only ever returns "Submitted" then
 * settles on "Other" for non-delivered messages; the portal's report-summary shows
 * those exact msg-ids as FAILED. So a settled "Other" (and any real status token we
 * don't otherwise recognise) is a NON-DELIVERY and must map to FAILED — never SENT
 * or UNKNOWN-and-forgotten. Only a genuinely empty/unparseable response is UNKNOWN,
 * and callers gate on `DeliveryPullResult.ok` so lookup errors never reach here.
 */
export function mapDeliveryStatus(raw: string | null | undefined): SmsLogStatus {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "UNKNOWN";
  if (/(DELIVR|DELIVERED|DELIVERD|^DL$|SUCCESS|^1$)/.test(s) && !/UNDELIV/.test(s)) return "DELIVERED";
  if (/(SUBMIT|SENT|ACCEPT|PENDING|QUEUE|ENROUTE|EN-ROUTE|BUFFER|AWAIT)/.test(s)) return "SENT";
  // Any other real status (UNDELIV / FAIL / REJECT / EXPIR / DND / OTHER / …) = not delivered.
  return "FAILED";
}

export interface DeliveryPullResult {
  ok: boolean;
  /** Raw status word from the gateway (e.g. "Submitted", "Delivered", "Other"). */
  statusText: string | null;
  mapped: SmsLogStatus;
  number: string | null;
  raw: string;
  error?: string;
}

/** Pull the delivery status of ONE message id from http-dlr.php. */
export async function fetchDeliveryStatus(msgId: string): Promise<DeliveryPullResult> {
  const username = process.env.SMS_API_USERNAME;
  const password = process.env.SMS_API_PASSWORD;
  if (!username || !password) return { ok: false, statusText: null, mapped: "UNKNOWN", number: null, raw: "", error: "gateway_not_configured" };
  const params = new URLSearchParams({ username, password, msg_id: msgId });
  try {
    const res = await fetch(`${SMS_DLR_BASE_URL}?${params.toString()}`, { method: "GET", cache: "no-store" });
    const raw = (await res.text()).slice(0, 2000).trim();
    // Typical body: "Number : 919988791797, Status : Submitted<br>"
    const statusMatch = raw.match(/status\s*:\s*([A-Za-z0-9 _-]+)/i);
    const numberMatch = raw.match(/number\s*:\s*(\d+)/i);
    const statusText = statusMatch ? statusMatch[1].trim() : null;
    const known = /valid message id|invalid|not found|no record/i.test(raw) ? false : !!statusText;
    return { ok: known, statusText, mapped: mapDeliveryStatus(statusText), number: numberMatch ? numberMatch[1] : null, raw };
  } catch (e) {
    return { ok: false, statusText: null, mapped: "UNKNOWN", number: null, raw: "", error: (e as Error).message };
  }
}
