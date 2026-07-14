/**
 * Enrollment eligibility. PURE (operates on already-fetched facts so it is fully
 * unit-testable). The matcher gathers facts via the StatePort, then this decides
 * whether a contact may enter a workflow. Fail-closed ordering: hard blocks first.
 */

export interface EligibilityFacts {
  normalizedPhone: string | null;
  phoneValid: boolean;
  optedOut: boolean;
  isStaffOrTest: boolean;
  /** Already has an active enrollment in this workflow. */
  alreadyEnrolledActive: boolean;
  /** Already in the converted/goal state at enroll time (e.g. already paid). */
  alreadyConverted: boolean;
  /** Passes canary controls (cap not exceeded / test-phone allowlist if set). */
  canaryAllowed: boolean;
}

export type EligibilityReason =
  | "ok"
  | "invalid_phone"
  | "opted_out"
  | "staff_or_test"
  | "already_enrolled"
  | "already_converted"
  | "canary_excluded";

export interface EligibilityResult { eligible: boolean; reason: EligibilityReason }

export function checkEligibility(f: EligibilityFacts): EligibilityResult {
  if (!f.normalizedPhone || !f.phoneValid) return { eligible: false, reason: "invalid_phone" };
  if (f.optedOut) return { eligible: false, reason: "opted_out" };
  if (f.isStaffOrTest) return { eligible: false, reason: "staff_or_test" };
  if (f.alreadyEnrolledActive) return { eligible: false, reason: "already_enrolled" };
  if (f.alreadyConverted) return { eligible: false, reason: "already_converted" };
  if (!f.canaryAllowed) return { eligible: false, reason: "canary_excluded" };
  return { eligible: true, reason: "ok" };
}

/** Canary gate: within max-enrollment cap AND (if a test-phone allowlist is set) on it. */
export function canaryAllows(
  phone: string | null,
  activeCount: number,
  cap: number | null,
  testPhones: string[] | null,
): boolean {
  if (cap != null && activeCount >= cap) return false;
  if (testPhones && testPhones.length > 0) {
    return !!phone && testPhones.map((p) => p.trim()).includes(phone.trim());
  }
  return true;
}
