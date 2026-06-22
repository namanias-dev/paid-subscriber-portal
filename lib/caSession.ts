import { getStudentSession, getBuyerSession } from "./session";
import { getStudentById } from "./dataProvider";
import { normalizeIndianMobile } from "./phone";

/**
 * The phone identity of the currently logged-in user (Buyer OR Student),
 * normalized to E.164 so bookmarks/leads match across both session types.
 * Returns null when nobody is logged in.
 */
export async function getCurrentUserPhone(): Promise<string | null> {
  const buyer = await getBuyerSession();
  if (buyer?.phone) {
    const n = normalizeIndianMobile(buyer.phone);
    return n.ok && n.e164 ? n.e164 : buyer.phone;
  }
  const student = await getStudentSession();
  if (student?.student_id) {
    const s = await getStudentById(student.student_id);
    if (s?.phone) {
      const n = normalizeIndianMobile(s.phone);
      return n.ok && n.e164 ? n.e164 : s.phone;
    }
  }
  return null;
}
