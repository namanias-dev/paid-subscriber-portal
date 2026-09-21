/**
 * One authenticated portal/dashboard hit per student per IST day.
 * Fire-and-forget from the activity route. Deduped by unique `dedupe_key`,
 * so a retry or a second device does not create a second row.
 * Not a login: token refresh and anonymous traffic never reach here.
 */
import { writeEvent } from "./server";
import { istTodayYMD } from "../dates";
import { normPhone } from "../phone";

export async function recordPortalActivity(input: {
  buyerId?: string | null;
  studentId?: string | null;
  phone?: string | null;
  surface: "portal" | "dashboard";
}): Promise<boolean> {
  const buyerId = (input.buyerId || "").trim() || null;
  const studentId = (input.studentId || "").trim() || null;
  const phone = normPhone(input.phone);
  const who = buyerId || studentId || phone;
  if (!who) return false;
  const ymd = istTodayYMD();
  return writeEvent({
    event_name: "portal_active",
    buyer_id: buyerId,
    phone,
    dedupe_key: `portal_active:${who}:${ymd}`,
    page_path: input.surface === "dashboard" ? "/dashboard" : "/portal",
    props: {
      surface: input.surface,
      student_id: studentId,
    },
  });
}
