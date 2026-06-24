import type { Student, SessionPayload } from "./types";
import { isExpired } from "./dates";
import { getStudentById } from "./dataProvider";
import { getStudentSession } from "./session";

export type AccessBlockReason = "expired" | "revoked";

/** True when the student may currently access gated content (not revoked, not expired). */
export function studentAccessActive(student: Pick<Student, "is_active" | "expiry_date">): boolean {
  return !!student.is_active && !isExpired(student.expiry_date);
}

/** Why a student is blocked, if at all (revoke takes priority over expiry). */
export function studentBlockReason(student: Pick<Student, "is_active" | "expiry_date">): AccessBlockReason | null {
  if (!student.is_active) return "revoked";
  if (isExpired(student.expiry_date)) return "expired";
  return null;
}

export interface ResolvedStudentAccess {
  session: SessionPayload | null;
  student: Student | null;
  /** True only when there IS a session + student AND they are blocked (revoked/expired). */
  blocked: boolean;
  reason: AccessBlockReason | null;
}

/**
 * Server-side, DB-fresh access resolution for the logged-in student. Unlike the
 * JWT (a 7-day snapshot), this re-reads `is_active` + `expiry_date` so admin
 * revoke / auto-expiry take effect immediately on the next gated request.
 */
export async function resolveStudentAccess(): Promise<ResolvedStudentAccess> {
  const session = await getStudentSession();
  if (!session) return { session: null, student: null, blocked: false, reason: null };
  const student = await getStudentById(session.student_id);
  if (!student) return { session, student: null, blocked: false, reason: null };
  const reason = studentBlockReason(student);
  return { session, student, blocked: !!reason, reason };
}
