/**
 * Server-only loader for enrollment fee state.
 * Keep dataProvider out of lib/enrollmentFeeState.ts so client bundles
 * (admin course-payments via installments) never pull next/headers.
 */
import { getCourseEnrollmentById } from "./dataProvider";
import { enrollmentFeeStateFromEnrollment, type EnrollmentFeeState } from "./enrollmentFeeState";

export async function getEnrollmentFeeState(
  enrollmentId: string,
  now = Date.now(),
): Promise<EnrollmentFeeState | null> {
  const enr = await getCourseEnrollmentById(enrollmentId);
  if (!enr) return null;
  return enrollmentFeeStateFromEnrollment(enr, now);
}
