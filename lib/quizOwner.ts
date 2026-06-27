import { cookies } from "next/headers";
import { resolveLearner } from "./entitlements";
import type { QuizAttempt } from "./types";

export const QUIZ_GUEST_COOKIE = "quiz_guest";

/**
 * Verify the current request owns the given attempt. Attempts are tracked
 * against the canonical `students.id` (`user_id`), which a logged-in learner —
 * buyer OR LMS student — resolves to. Guests are matched by their cookie.
 */
export async function ownsAttempt(attempt: QuizAttempt): Promise<boolean> {
  if (attempt.user_id) {
    const learner = await resolveLearner();
    return !!learner && learner.studentId === attempt.user_id;
  }
  // Guest attempt: matched by the browser cookie...
  if (attempt.guest_session_id && cookies().get(QUIZ_GUEST_COOKIE)?.value === attempt.guest_session_id) {
    return true;
  }
  // ...or, for a returning LEAD logged in on another device, by their own phone.
  // (A logged-in learner may only ever match attempts made with THEIR number.)
  if (attempt.guest_mobile) {
    const learner = await resolveLearner();
    if (learner?.phone && learner.phone === attempt.guest_mobile) return true;
  }
  return false;
}
