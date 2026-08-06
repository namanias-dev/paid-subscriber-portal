/**
 * Canonical "Registrations so far" for Sales webinar_registration alerts.
 *
 * Paid webinars: distinct paid seats (same definition as webinar_payment /
 * digest / Overview — never raw webinar_registrations row count).
 * Free webinars: distinct phones on webinar_registrations for that webinar id.
 *
 * webinar_id already scopes to one session/date — no cross-webinar bleed.
 */
import { getSupabaseAdmin } from "../../supabase";
import { paidWebinarRegistrationCount } from "../../webinarReg";

/** Legacy buggy count: raw webinar_registrations rows for webinar_id (no distinct). */
export async function legacyRawWebinarRegistrationRowCount(
  webinarId: string,
): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { count } = await db
      .from("webinar_registrations")
      .select("id", { count: "exact", head: true })
      .eq("webinar_id", webinarId);
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

export async function countDistinctWebinarRegistrationPhones(
  webinarId: string,
): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("webinar_registrations")
      .select("phone")
      .eq("webinar_id", webinarId);
    if (error || !data) return null;
    const phones = new Set<string>();
    for (const row of data) {
      const p = String((row as { phone?: string }).phone || "")
        .replace(/\D/g, "")
        .slice(-10);
      if (p.length === 10) phones.add(p);
    }
    return phones.size;
  } catch {
    return null;
  }
}

/**
 * Canonical sales count for one webinar (id = that session / date).
 */
export async function countSalesWebinarRegistrationsSoFar(
  webinarId: string,
): Promise<number | null> {
  const { getPayments, getWebinars } = await import("../../dataProvider");
  const webinars = await getWebinars();
  const w = webinars.find((x) => x.id === webinarId) || null;
  if (!w) return null;
  const price = Number(w.price) || 0;
  if (price > 0) {
    const payments = await getPayments();
    const key = String(w.slug || w.id).trim();
    return key ? paidWebinarRegistrationCount(payments, key) : null;
  }
  return countDistinctWebinarRegistrationPhones(webinarId);
}
