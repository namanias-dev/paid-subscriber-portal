/**
 * Access-override governance. Grants restore playback; they must not silently
 * halt collections (reminders use schedule state). Caps + mandatory reason live here.
 */
export const ACCESS_GRANT_MAX_DAYS_DEFAULT = 7;
/** Surface for follow-up when a grant is this close to ending and money is still owed. */
export const ACCESS_GRANT_EXPIRING_SOON_DAYS = 2;

export type GrantPolicyError =
  | "reason_required"
  | "expiry_required"
  | "expiry_in_past"
  | "duration_exceeds_cap"
  | "indefinite_forbidden";

export function grantDurationDays(expiresAt: string, now = Date.now()): number | null {
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return null;
  return Math.ceil((exp - now) / 86_400_000);
}

/**
 * Validate a grant. `elevated` allows >7 days. Indefinite (null expiry) is always rejected.
 */
export function validateAccessGrant(input: {
  expiresAt: string | null | undefined;
  reason: string | null | undefined;
  elevated: boolean;
  now?: number;
}): { ok: true; days: number } | { ok: false; error: GrantPolicyError; detail: string } {
  const reason = (input.reason || "").trim();
  if (!reason) return { ok: false, error: "reason_required", detail: "A reason is required for every access grant." };
  if (!input.expiresAt) {
    return { ok: false, error: "indefinite_forbidden", detail: "Grants must have an expiry — open-ended access is not allowed." };
  }
  const now = input.now ?? Date.now();
  const days = grantDurationDays(input.expiresAt, now);
  if (days == null) return { ok: false, error: "expiry_required", detail: "Expiry date is invalid." };
  if (days <= 0) return { ok: false, error: "expiry_in_past", detail: "Expiry must be in the future." };
  if (days > ACCESS_GRANT_MAX_DAYS_DEFAULT && !input.elevated) {
    return {
      ok: false,
      error: "duration_exceeds_cap",
      detail: `Grants longer than ${ACCESS_GRANT_MAX_DAYS_DEFAULT} days require an elevated permission (manage_staff).`,
    };
  }
  return { ok: true, days };
}
