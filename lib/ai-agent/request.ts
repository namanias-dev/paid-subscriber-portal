/**
 * AI Counselor Agent — shared PUBLIC-request helpers.
 *
 * Reads session identity, consent, and attribution from the SAME first-party
 * cookies the rest of the site uses (nsa_sid / nsa_consent / nsa_attr), so the
 * agent never invents a parallel identity or consent model.
 */

import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  CONSENT_COOKIE,
  ATTR_COOKIE,
  parseConsentCookie,
  parseAttrCookie,
  flattenForStamp,
  metaIdentityFromState,
  type ConsentState,
} from "@/lib/attribution";

export interface AgentRequestContext {
  ip: string;
  /** Session id: explicit body value wins, else the nsa_sid cookie, else "". */
  sessionId: string;
  consent: ConsentState;
  attribution: {
    source: string | null;
    campaign: string | null;
    fbclid: string | null;
    fbc: string | null;
  };
}

export function ipOf(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Build the request context. `bodySessionId` lets a client pass an explicit
 * session id (e.g. a widget-generated id) which takes precedence over the cookie.
 */
export function getAgentContext(req: Request, bodySessionId?: string | null): AgentRequestContext {
  const jar = cookies();
  const cookieSid = jar.get(SESSION_COOKIE)?.value || "";
  const consent =
    parseConsentCookie(jar.get(CONSENT_COOKIE)?.value) || {
      analytics: false,
      marketing: false,
      version: 0,
    };
  const attrState = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);
  const flat = flattenForStamp(attrState);
  const meta = metaIdentityFromState(attrState);

  return {
    ip: ipOf(req),
    sessionId: (bodySessionId && String(bodySessionId).trim()) || cookieSid || "",
    consent,
    attribution: {
      source: flat.source,
      campaign: flat.campaign,
      fbclid: meta.fbclid,
      fbc: meta.fbc,
    },
  };
}

/** Basic email shape check (defensive; not RFC-perfect). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
