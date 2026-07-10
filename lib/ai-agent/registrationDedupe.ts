/**
 * AI Counselor Agent — WEBINAR REGISTRATION DEDUPE PRE-CHECK (Phase 4 groundwork).
 *
 * `webinar_registrations` has NO unique constraint on `phone` or
 * `(webinar_id, phone)` — only a PK on `id`. So dedupe MUST be enforced in code.
 * This helper is a reusable pre-check: given (webinar_id, phone) it returns the
 * existing registration row if one is already present, else null.
 *
 * PHASE 1 SCOPE: this is a READ-ONLY helper only. It does NOT alter
 * registerWebinar() or the public webinar-register form behavior — those stay
 * exactly as they are. It exists so a later phase can call it BEFORE inserting to
 * avoid creating duplicate registrations.
 *
 * The public register route stores phone as bare 10 digits
 * (`phone.replace(/\D/g, "")`), so we normalize the same way before matching.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { normPhone } from "@/lib/phone";

export interface WebinarRegistrationRow {
  id: string;
  webinar_id: string | null;
  name: string | null;
  phone: string | null;
  attended: boolean | null;
  created_at: string | null;
}

/**
 * Return the existing registration for (webinar_id, phone), or null if none.
 * Returns null (never throws) when Supabase is unconfigured or on any read error.
 */
export async function findExistingRegistration(
  webinarId: string,
  phone: string,
): Promise<WebinarRegistrationRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const normalized = normPhone(phone);
  if (!webinarId || !normalized) return null;

  try {
    // Fast path: exact match on the 10-digit form the public form stores.
    const { data } = await db
      .from("webinar_registrations")
      .select("id,webinar_id,name,phone,attended,created_at")
      .eq("webinar_id", webinarId)
      .eq("phone", normalized)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as WebinarRegistrationRow;

    // Fallback: scan this webinar's rows and compare normalized phones, so rows
    // stored in a non-canonical format (legacy) still dedupe correctly.
    const { data: rows } = await db
      .from("webinar_registrations")
      .select("id,webinar_id,name,phone,attended,created_at")
      .eq("webinar_id", webinarId);
    for (const r of (rows as WebinarRegistrationRow[]) ?? []) {
      if (normPhone(r.phone) === normalized) return r;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convenience boolean wrapper. */
export async function isAlreadyRegistered(webinarId: string, phone: string): Promise<boolean> {
  return (await findExistingRegistration(webinarId, phone)) !== null;
}

/*
 * ============================================================================
 * FUTURE MIGRATION — NOT APPLIED IN PHASE 1 (do NOT add to the migration file).
 * ============================================================================
 * Once historical duplicates are cleaned, a DB-level unique index makes dedupe
 * bullet-proof (defense-in-depth alongside the app-level check above). Creating
 * it now would FAIL because existing duplicate (webinar_id, phone) rows exist.
 *
 * STEP 1 — find duplicates:
 *   SELECT webinar_id, phone, count(*)
 *   FROM public.webinar_registrations
 *   GROUP BY webinar_id, phone
 *   HAVING count(*) > 1;
 *
 * STEP 2 — keep the earliest row per (webinar_id, phone), delete the rest
 *          (review carefully; back up first):
 *   DELETE FROM public.webinar_registrations a
 *   USING public.webinar_registrations b
 *   WHERE a.webinar_id = b.webinar_id
 *     AND a.phone = b.phone
 *     AND a.created_at > b.created_at;
 *
 * STEP 3 — only AFTER duplicates are gone, add the guard:
 *   CREATE UNIQUE INDEX IF NOT EXISTS webinar_registrations_webinar_phone_uidx
 *     ON public.webinar_registrations (webinar_id, phone);
 * ============================================================================
 */
