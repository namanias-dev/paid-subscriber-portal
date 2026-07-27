/**
 * HARD SEND GUARD — the durable protection against a half-rendered message
 * reaching a real handset.
 *
 * A real student received the literal text `installment no. {No_of_Installment}
 * of Rs.{Fee_in_Rs}`. Two things had to be true for that to happen: the parser
 * missed the tokens (fixed in ./templates), and NOTHING between "render" and
 * "call the gateway" ever looked at the rendered body and asked whether it
 * still contained braces. This file is that missing check.
 *
 * It is enforced in two places on purpose:
 *   • lib/sms/service — sendSms + sendBatch screening, so a blocked recipient
 *     gets a named skip reason the UI can show instead of a silent failure.
 *   • lib/sms/gateway — immediately before EVERY outbound fetch, so a path that
 *     does not go through sendSms (retryLog, resendCampaignFailed, and anything
 *     added later) still cannot get an unrendered body out. The service-level
 *     check is the good error message; the gateway-level check is the guarantee.
 *
 * `{` and `}` are GSM-7 extension characters, so validateBody() considers a
 * braced body perfectly valid to send. Length/charset validation was never
 * going to catch this — only an explicit placeholder check does.
 */
import { isResolvedValue } from "./variableRegistry";

/** Any leftover brace means a token was not substituted. */
const LEFTOVER_BRACE_RE = /[{}]/;

export type SendBlockReason = "unresolved_placeholder" | "unresolved_variable" | "empty_body";

export interface SendGuardResult {
  ok: boolean;
  reason: SendBlockReason | null;
  /** Staff-facing explanation, safe to surface in the UI. Never contains PII. */
  detail: string | null;
  /** The specific tokens/keys that failed, for logs and the preview modal. */
  offenders: string[];
}

const PASS: SendGuardResult = { ok: true, reason: null, detail: null, offenders: [] };

/** The `{...}` tokens still present in a rendered body (first-seen order). */
export function leftoverPlaceholders(text: string): string[] {
  const out: string[] = [];
  const re = /\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tok = m[1].trim();
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

/**
 * The one check every send path runs. Fails CLOSED: an unrenderable body is
 * never "probably fine".
 *
 * @param text rendered message body about to be sent
 * @param resolved optional map of the values used to render it; each is
 *   re-checked for null/empty/NaN/"undefined" so a token that rendered to a
 *   plausible-looking dud is caught too
 */
export function checkRenderedBody(
  text: string,
  resolved?: Record<string, string | number | null | undefined>,
): SendGuardResult {
  if (!text || !text.trim()) {
    return { ok: false, reason: "empty_body", detail: "Rendered message body is empty.", offenders: [] };
  }

  if (LEFTOVER_BRACE_RE.test(text)) {
    const offenders = leftoverPlaceholders(text);
    return {
      ok: false,
      reason: "unresolved_placeholder",
      detail: offenders.length
        ? `Message still contains unresolved placeholder(s): ${offenders.map((o) => `{${o}}`).join(", ")}.`
        : "Message still contains a stray { or } character.",
      offenders,
    };
  }

  if (resolved) {
    const bad = Object.entries(resolved)
      .filter(([, v]) => v !== undefined && !isResolvedValue(v))
      .map(([k]) => k);
    if (bad.length) {
      return {
        ok: false,
        reason: "unresolved_variable",
        detail: `Variable(s) resolved to an empty or invalid value: ${bad.join(", ")}.`,
        offenders: bad,
      };
    }
  }

  return PASS;
}

/**
 * Thrown-free assertion used at the gateway boundary. Returns the guard result
 * so the caller can turn a block into a FAILED log rather than an exception —
 * SMS sends are fire-and-forget and must never throw into a request handler.
 */
export function guardOutboundBody(text: string): SendGuardResult {
  return checkRenderedBody(text);
}
