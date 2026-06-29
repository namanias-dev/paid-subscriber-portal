import { sendSms } from "./sms/service";
import { updateLectureComment } from "./dataProvider";
import { normalizeIndianMobile } from "./phone";
import type { LectureComment } from "./types";

/**
 * Notify a student, once, that staff replied to their lecture comment.
 *
 * In-app notifications don't exist yet, so this is a best-effort SMS that ONLY
 * fires when a DLT template id is configured via SMS_LECTURE_REPLY_TEMPLATE_ID
 * (and SMS is enabled). It is idempotent two ways: we stamp the REPLY's
 * notified_at so a retry is skipped, and sendSms dedupes on the reply id. If
 * unconfigured it silently no-ops — never blocks the reply, never spams.
 */
export async function notifyStudentOfReply(
  parent: LectureComment,
  reply: LectureComment,
  opts: { lectureTitle?: string | null; replierName?: string | null } = {},
): Promise<void> {
  try {
    if (parent.author_kind !== "student") return; // only notify the student who asked
    if (reply.notified_at) return; // already handled
    const mobile = normalizeIndianMobile(parent.author_phone || "");
    if (!mobile) return;

    // Mark first so concurrent retries don't double-send.
    await updateLectureComment(reply.id, { notified_at: new Date().toISOString() }).catch(() => null);

    const templateId = process.env.SMS_LECTURE_REPLY_TEMPLATE_ID;
    if (!templateId) return; // notifications not configured yet — safe no-op

    await sendSms({
      mobile: String(mobile),
      templateId,
      variables: {
        first_name: (parent.author_name || "Student").split(" ")[0],
        lecture: opts.lectureTitle || "your lecture",
      },
      sentBy: { type: "SYSTEM" },
      triggerEvent: "lecture_reply",
      dedupeKey: `lecture_reply:${reply.id}`,
      relatedEntity: { user_id: parent.author_id, student_name: parent.author_name },
    });
  } catch {
    /* notifications are best-effort — never break the reply */
  }
}
