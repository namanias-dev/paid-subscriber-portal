/** Canonical event names (shared by client beacon + server emitters). */
export type EventName =
  // traffic
  | "page_view"
  | "session_start"
  // webinar funnel
  | "webinar_view"
  | "click_register_pay"
  | "registration_created"
  // course funnel
  | "course_view"
  | "click_enroll"
  | "enrollment_created"
  // payment
  | "payment_initiated"
  | "payment_status_changed"
  | "payment_paid"
  | "payment_abandoned"
  | "payment_proof_uploaded"
  // staff
  | "staff_review"
  // identity
  | "login"
  | "logout"
  | "identity_stitched"
  // post-enrollment engagement
  | "enrolled_card_viewed"
  | "zoom_link_clicked"
  | "course_opened"
  // consent
  | "consent_updated";

/**
 * Events the CLIENT beacon (/api/track) is allowed to emit. Anything that
 * grants access / moves money / proves identity is SERVER-emitted only and must
 * never be trusted from the browser.
 */
export const CLIENT_ALLOWED_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "page_view",
  "session_start",
  "webinar_view",
  "course_view",
  "click_register_pay",
  "click_enroll",
  "enrolled_card_viewed",
  "zoom_link_clicked",
  "course_opened",
  "consent_updated",
]);

/** High-volume traffic events that the retention job may prune after 90 days. */
export const PRUNABLE_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "page_view",
  "session_start",
]);
