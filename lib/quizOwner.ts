import { cookies } from "next/headers";
import { getStudentSession } from "./session";
import type { QuizAttempt } from "./types";

export const QUIZ_GUEST_COOKIE = "quiz_guest";

/** Verify the current request owns the given attempt (logged-in user or guest cookie). */
export async function ownsAttempt(attempt: QuizAttempt): Promise<boolean> {
  if (attempt.user_id) {
    const s = await getStudentSession();
    return !!s && s.student_id === attempt.user_id;
  }
  if (attempt.guest_session_id) {
    return cookies().get(QUIZ_GUEST_COOKIE)?.value === attempt.guest_session_id;
  }
  return false;
}
