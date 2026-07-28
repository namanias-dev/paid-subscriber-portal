/** Canonical event names (shared by client beacon + server emitters). */
export type EventName =
  // traffic
  | "page_view"
  | "session_start"
  // webinar funnel
  | "webinar_view"
  | "click_register_pay"
  | "registration_attempt"
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
  // resources / downloads
  | "resource_download_click"
  // free-download smart lead gate (PII-free: only file id/kind ever sent)
  | "download_lead_prompt"
  | "download_lead_submit"
  // announcements ("What's New")
  | "announcement_click"
  // consent
  | "consent_updated"
  // AI counsellor agent (guided flow) — PII-free funnel events
  | "ai_widget_opened"
  | "ai_widget_dismissed"
  | "ai_message_sent"
  | "ai_quick_reply"
  | "ai_lead_created"
  | "ai_webinar_register_click"
  | "ai_payment_start_click"
  | "ai_whatsapp_click"
  | "ai_callback_requested"
  | "ai_payment_recovery_click"
  | "ai_resource_click"
  | "ai_offer_click"
  | "ai_conversion_attributed"
  // cinematic home PREVIEW (/home-cinematic) — PII-free funnel + diagnostics.
  // Every one of these is emitted ONLY from the flag-gated preview route, so with
  // NEXT_PUBLIC_CINEMATIC_HOME_ENABLED unset none of them is reachable.
  | "cinematic_home_view"
  | "cinematic_mode_loaded"
  | "cinematic_fallback_used"
  | "hero_masterclass_click"
  | "hero_course_click"
  | "hero_quiz_click"
  | "journey_stage_viewed"
  | "journey_selector_completed"
  | "journey_recommendation_clicked"
  | "mentor_cta_clicked"
  | "course_card_clicked"
  | "result_card_clicked"
  | "portal_showcase_clicked"
  | "whatsapp_clicked"
  | "final_cta_clicked"
  | "scroll_depth_25"
  | "scroll_depth_50"
  | "scroll_depth_75"
  | "scroll_depth_100";

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
  "registration_attempt",
  "click_enroll",
  "enrolled_card_viewed",
  "zoom_link_clicked",
  "course_opened",
  "resource_download_click",
  "download_lead_prompt",
  "download_lead_submit",
  "announcement_click",
  "consent_updated",
  // AI counsellor agent — all low-risk, PII-free funnel signals emitted from the
  // widget. Anything that grants access / moves money stays server-emitted.
  "ai_widget_opened",
  "ai_widget_dismissed",
  "ai_message_sent",
  "ai_quick_reply",
  "ai_lead_created",
  "ai_webinar_register_click",
  "ai_payment_start_click",
  "ai_whatsapp_click",
  "ai_callback_requested",
  "ai_payment_recovery_click",
  "ai_resource_click",
  "ai_offer_click",
  "ai_conversion_attributed",
  // Cinematic home preview. All are view/click signals with no PII and no
  // access/money semantics, so the browser is allowed to emit them — same
  // classification the AI-agent funnel events above already carry.
  "cinematic_home_view",
  "cinematic_mode_loaded",
  "cinematic_fallback_used",
  "hero_masterclass_click",
  "hero_course_click",
  "hero_quiz_click",
  "journey_stage_viewed",
  "journey_selector_completed",
  "journey_recommendation_clicked",
  "mentor_cta_clicked",
  "course_card_clicked",
  "result_card_clicked",
  "portal_showcase_clicked",
  "whatsapp_clicked",
  "final_cta_clicked",
  "scroll_depth_25",
  "scroll_depth_50",
  "scroll_depth_75",
  "scroll_depth_100",
]);

/** High-volume traffic events that the retention job may prune after 90 days. */
export const PRUNABLE_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "page_view",
  "session_start",
]);
