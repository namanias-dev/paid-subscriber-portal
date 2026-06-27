/**
 * JustGoSMS HTTP gateway call (BACKEND-ONLY). Credentials are read from env at
 * call time and NEVER logged or returned to the client. The exact `number` wire
 * format is configurable via SMS_NUMBER_FORMAT (confirm against a JustGoSMS sample).
 */
import { SMS_API_BASE_URL, SMS_DEFAULT_ROUTE, SMS_DEFAULT_SENDER_ID, smsNumberFormat } from "./config";

export interface GatewaySendInput {
  digits10: string;
  message: string;
  templateId: string; // DLT template id (gateway templateid)
  senderId?: string;
  route?: string;
}

export interface GatewayResult {
  ok: boolean;
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
