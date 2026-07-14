/**
 * Deterministic idempotency-key builders. PURE. These are the backbone of the
 * "can never double-send / double-enroll" guarantee: the same logical action
 * always yields the same key, so DB UNIQUE constraints collapse duplicates.
 */

/** One enrollment per (version, contact, triggering event). */
export function enrollmentDedupeKey(versionId: string, phone: string | null, eventId: string | null): string {
  return `enroll:${versionId}:${phone ?? "nophone"}:${eventId ?? "noevent"}`;
}

/** One pending job per (enrollment, node). */
export function jobDedupeKey(enrollmentId: string, nodeKey: string): string {
  return `job:${enrollmentId}:${nodeKey}`;
}

/**
 * The send idempotency key handed to the chokepoint as `dedupeKey`. Deterministic
 * across retries + duplicated jobs so the chokepoint's insert-first UNIQUE dedupe
 * guarantees at most one real send per (enrollment, node).
 */
export function sendIdempotencyKey(enrollmentId: string, nodeKey: string): string {
  return `jr:${enrollmentId}:${nodeKey}`;
}
