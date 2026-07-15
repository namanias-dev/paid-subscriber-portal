/**
 * SERVER helper: read the visitor's first-party attribution cookie (nsa_attr)
 * from the current request and turn it into a lead attribution stamp. Used by the
 * public lead-capture routes so every lead carries its Google Ads / UTM origin.
 *
 * Attribution is first-party + non-PII (utm/gclid/referrer we already receive in
 * the URL), captured under the same legitimate-interest basis as the rest of the
 * site's essential analytics — no new tracking script, no PII.
 */
import { cookies } from "next/headers";
import { ATTR_COOKIE, parseAttrCookie } from "@/lib/attribution";
import { leadAttributionFromState, type LeadAttribution } from "./leadAttribution";

/** Lead attribution derived from the request's nsa_attr cookie (empty when absent). */
export function requestLeadAttribution(): LeadAttribution {
  try {
    const raw = cookies().get(ATTR_COOKIE)?.value;
    return leadAttributionFromState(parseAttrCookie(raw));
  } catch {
    return leadAttributionFromState(null);
  }
}
