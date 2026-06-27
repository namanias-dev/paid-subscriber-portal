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
  // Strong ownership: the attempt is claimed to this learner's canonical student id.
  // A returning LEAD's pre-login guest attempts are claimed to their student id at
  // LOGIN time (claimGuestAttempts, code-proven), so cross-device viewing works
  // through this path WITHOUT trusting a self-reported phone on every request.
  if (attempt.user_id) {
    const learner = await resolveLearner();
    return !!learner && learner.studentId === attempt.user_id;
  }
  // Unclaimed guest attempt: same-device only, matched by the browser cookie.
  // (We deliberately do NOT grant by `guest_mobile` here — that self-reported
  // number could be a typo'd/shared number and would leak another user's history.)
  if (attempt.guest_session_id && cookies().get(QUIZ_GUEST_COOKIE)?.value === attempt.guest_session_id) {
    return true;
  }
  return false;
}
