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
  // Once per authenticated student per IST day. Server-written only, after a
  // real portal/dashboard session — never from the public beacon.
  | "portal_active"
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
  | "scroll_depth_100"
  // Notes Store commerce funnel — PII-free (product/subject/price/qty only; never
  // name, phone, address, order token or payment payloads).
  | "notes_store_viewed"
  | "notes_product_viewed"
  | "notes_product_clicked"
  | "notes_bundle_viewed"
  | "notes_sample_opened"
  | "notes_sample_impression"
  | "notes_sample_page_view"
  | "notes_sample_completed"
  | "notes_sample_buy_clicked"
  | "notes_physical_video_impression"
  | "notes_physical_video_play"
  | "notes_physical_video_25"
  | "notes_physical_video_50"
  | "notes_physical_video_75"
  | "notes_physical_video_completed"
  | "notes_physical_video_buy_clicked"
  | "notes_added_to_cart"
  | "notes_removed_from_cart"
  | "notes_checkout_started"
  | "notes_coupon_applied"
  | "notes_payment_failed"
  | "notes_order_completed"
  | "notes_interest_submitted"
  | "notes_interest_section_viewed"
  | "subject_interest_selected"
  | "subject_interest_removed"
  | "subject_interest_saved"
  | "available_note_clicked_from_interest"
  | "waitlist_interest_saved"
  | "interest_preferences_updated"
  | "notes_teaching_section_viewed"
  | "notes_teaching_preview_started"
  | "notes_teaching_video_opened"
  | "notes_teaching_sound_enabled"
  | "notes_teaching_video_25"
  | "notes_teaching_video_50"
  | "notes_teaching_video_75"
  | "notes_teaching_video_completed"
  | "notes_teaching_video_changed"
  | "notes_teaching_inline_play"
  | "notes_teaching_inline_pause"
  | "notes_teaching_fullscreen_entered"
  | "notes_shop_after_teaching_clicked"
  | "notes_offer_impression"
  | "notes_offer_cta_clicked"
  | "notes_offer_product_view"
  | "notes_offer_cart_applied"
  | "notes_offer_checkout_started"
  | "notes_offer_order_completed";

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
  // Notes Store commerce funnel — view/click/cart signals, no PII, no access or
  // money semantics (order completion is confirmed server-side; this is a funnel
  // signal only). Same classification as the course/AI funnel events above.
  "notes_store_viewed",
  "notes_product_viewed",
  "notes_product_clicked",
  "notes_bundle_viewed",
  "notes_sample_opened",
  "notes_sample_impression",
  "notes_sample_page_view",
  "notes_sample_completed",
  "notes_sample_buy_clicked",
  "notes_physical_video_impression",
  "notes_physical_video_play",
  "notes_physical_video_25",
  "notes_physical_video_50",
  "notes_physical_video_75",
  "notes_physical_video_completed",
  "notes_physical_video_buy_clicked",
  "notes_added_to_cart",
  "notes_removed_from_cart",
  "notes_checkout_started",
  "notes_coupon_applied",
  "notes_payment_failed",
  "notes_order_completed",
  "notes_interest_submitted",
  "notes_interest_section_viewed",
  "subject_interest_selected",
  "subject_interest_removed",
  "subject_interest_saved",
  "available_note_clicked_from_interest",
  "waitlist_interest_saved",
  "interest_preferences_updated",
  "notes_teaching_section_viewed",
  "notes_teaching_preview_started",
  "notes_teaching_video_opened",
  "notes_teaching_sound_enabled",
  "notes_teaching_video_25",
  "notes_teaching_video_50",
  "notes_teaching_video_75",
  "notes_teaching_video_completed",
  "notes_teaching_video_changed",
  "notes_teaching_inline_play",
  "notes_teaching_inline_pause",
  "notes_teaching_fullscreen_entered",
  "notes_shop_after_teaching_clicked",
  "notes_offer_impression",
  "notes_offer_cta_clicked",
  "notes_offer_product_view",
  "notes_offer_cart_applied",
  "notes_offer_checkout_started",
  "notes_offer_order_completed",
]);

/** High-volume traffic events that the retention job may prune after 90 days. */
export const PRUNABLE_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "page_view",
  "session_start",
]);
