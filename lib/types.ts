import type { LeaderboardSettings } from "./leaderboardConfig";
import type { AttributionState } from "./attribution";

export type PlanId = "1m" | "3m" | "6m" | "12m" | "lifetime";

export type ContentType =
  | "current_affairs"
  | "mcq"
  | "booklet"
  | "recording"
  | "live_link"
  | "pyq"
  | "test_series"
  | "answer_writing"
  | "notes"
  | "maps";

export type CourseCategory =
  | "Foundation"
  | "Optional"
  | "Test Series"
  | "Mains"
  | "Specialist"
  | "Mentorship"
  | "Entry"
  | "PCS";

export type LearningMode = "Online" | "Offline" | "Hybrid" | "Recorded";

export interface Student {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  /** LMS subscription plan. NULL = a course/webinar customer (no LMS subscription), still a first-class student. */
  plan: PlanId | null;
  months: number | null;
  access_code: string;
  start_date: string;
  expiry_date: string | null;
  amount_paid: number | null;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  target_year: number | null;
  optional_subject: string | null;
  streak_count: number;
  last_active_date: string | null;
  is_active: boolean;
  /** Optional internal admin notes (never shown to the student). */
  notes?: string | null;
  created_at: string;
}

export interface ContentItem {
  id: string;
  type: ContentType;
  subject: string | null;
  paper: string | null;
  /** Optional faculty/teacher name for a recording/lecture (display + search). */
  faculty?: string | null;
  title: string;
  description: string | null;
  drive_link: string | null;
  youtube_link: string | null;
  date: string | null;
  duration: string | null;
  is_published: boolean;
  /** @deprecated single-course assignment — kept for back-compat; prefer `course_ids`. */
  course_id: string | null;
  /** Course/batch ids this item is assigned to (one item → many batches, no duplication). */
  course_ids?: string[];
  /** Optional class/session number for ordering recordings & notes (e.g. 1, 2, 12). */
  class_no?: number | null;
  /** External Telegram link (alongside Drive + YouTube). Links only for source_type='link'. */
  telegram_link?: string | null;
  drip_date: string | null;
  created_at: string;

  // ---- Hosted lecture recordings (direct-to-Cloudflare-R2) ----
  /** 'link' (external YT/Drive/Telegram — default, unchanged) or 'hosted' (R2 video). */
  source_type?: LectureSourceType;
  /** 'enrolled' (entitlement-gated, default) or 'public' (free/marketing, bypasses gating). */
  visibility?: LectureVisibility;
  /** Lifecycle of the hosted upload. */
  upload_status?: LectureUploadStatus;
  /** Final R2 object key for the playable MP4 (never sent raw to the client). */
  processed_key?: string | null;
  thumbnail_key?: string | null;
  notes_pdf_key?: string | null;
  duration_seconds?: number | null;
  file_size?: number | null;
  /** R2 size (bytes) of the attached notes PDF (notes_pdf_key), when uploaded. */
  notes_pdf_size?: number | null;
  /** R2 size (bytes) of the custom thumbnail (thumbnail_key), when uploaded. */
  thumbnail_size?: number | null;
  resolution?: string | null;
  /** Opt-in (default false) to serve a public lecture via the R2 public CDN base URL. */
  public_cdn?: boolean;
  // Resumable multipart upload state (so an interrupted upload can resume).
  multipart_upload_id?: string | null;
  multipart_key?: string | null;
  multipart_parts?: MultipartPart[];
  multipart_total_parts?: number | null;
  multipart_chunk_size?: number | null;
}

export type LectureSourceType = "link" | "hosted";
export type LectureVisibility = "enrolled" | "public";
export type LectureUploadStatus = "idle" | "uploading" | "paused" | "completed" | "failed";

/** One completed part of an R2 multipart upload. */
export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/** Resume-watching + completion tracking for a hosted lecture, per learner. */
export interface LectureWatchProgress {
  id: string;
  learner_id: string;
  recording_id: string;
  last_position_seconds: number;
  completed: boolean;
  completed_at: string | null;
  watch_count: number;
  last_watched_at: string;
  created_at: string;
  updated_at: string;
}

export type CourseAccessOverrideMode = "grant" | "revoke";

/** Admin manual access override per learner (phone) per course — always wins. */
export interface CourseAccessOverride {
  id: string;
  phone: string;
  course_id: string;
  mode: CourseAccessOverrideMode;
  /** null = lifetime grant. */
  expires_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-student, per-Class-Hub-section "last seen" — powers the NEW badge. */
export interface ClassHubView {
  id: string;
  student_id: string;
  course_id: string;
  section: string;
  last_seen_at: string;
}

export interface Bookmark {
  id: string;
  student_id: string;
  content_id: string;
  created_at: string;
}

export interface ContentProgress {
  id: string;
  student_id: string;
  content_id: string;
  completed: boolean;
  completed_at: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface AccessLog {
  id: string;
  student_id: string | null;
  action: string;
  timestamp: string;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  durationLabel: string;
  months: number | null;
  days: number | null;
  price: number;
  badge?: string;
  highlight?: boolean;
  bullets: string[];
  envKey: string;
}

export interface SessionPayload {
  student_id: string;
  name: string;
  plan: PlanId;
  expiry_date: string | null;
}

/** A post-payment buyer, keyed by phone, who logs in with phone + login code. */
export interface Buyer {
  id: string;
  phone: string;
  name: string | null;
  login_code: string;
  /** True for an auto-provisioned STAFF test account — excluded from "real student" analytics. */
  is_staff?: boolean;
  /**
   * True for a non-paying LEAD account auto-created from the quiz lead form, so
   * the lead can log back in to retake quizzes and see results. Carries ZERO
   * entitlements — the central access gate default-denies all paid content.
   * Cleared automatically if/when the lead ever makes a real payment.
   */
  is_lead?: boolean;
  /** Session/access version — bumped on real access changes to invalidate stale device sessions. */
  session_version?: number;
  created_at: string;
  updated_at?: string;
}

export interface BuyerSessionPayload {
  buyer_id: string;
  phone: string;
  name: string | null;
  /** Session/access version embedded at sign time; validated against the buyer's current version. */
  sv?: number;
}

export interface AdminSessionPayload {
  admin_id: string;
  username: string;
  role: string;
  /** Display name of the role (e.g. "Content Admin"). */
  role_name?: string;
  /** Effective permissions resolved from role + per-account override. */
  permissions?: import("./permissions").PermissionSet;
  /** Forces a password change prompt after login. */
  must_change_password?: boolean;
}

// ----------------------------- Shared rich content -----------------------------
export interface FAQItem {
  q: string;
  a: string;
}

export type ContactLinkType = "whatsapp" | "phone" | "email" | "telegram" | "website";
export interface ContactLink {
  type: ContactLinkType;
  /** Raw value: phone digits for whatsapp/phone, email address, or URL. */
  value: string;
  label?: string;
}

export interface PdfResource {
  label: string;
  url: string;
}

/**
 * A reusable document in the central Brochure / Resources Library. Uploaded once,
 * referenced (by id) from many courses/webinars so files are never duplicated.
 */
export interface LibraryDoc {
  id: string;
  title: string;
  category?: string | null;
  file_url: string;
  /** Size in bytes (for the public download card). */
  file_size?: number | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

/** A YouTube orientation/starter video shown in the student Class Hub. */
export interface OrientationVideo {
  title?: string | null;
  description?: string | null;
  url: string;
}

/** Whether a linked library video plays first ("orientation") or as a "starter". */
export type OrientationRole = "orientation" | "starter";

/** What a library video can be attached to (course / webinar After-Registration). */
export type OrientationTargetType = "course" | "webinar";

/**
 * Join row: one library video (content_items) assigned to the After-Registration
 * section of ONE course/webinar, with a role + sort order. The SAME content_id
 * can appear in many rows (many courses/webinars) — the video is never re-uploaded.
 */
export interface OrientationAssignment {
  id: string;
  content_id: string;
  target_type: OrientationTargetType;
  target_id: string;
  role: OrientationRole;
  sort_order: number;
  created_at: string;
}

/** An assignment resolved with its underlying library video (for rendering). */
export interface AssignedOrientationVideo {
  assignment_id: string;
  content: ContentItem;
  role: OrientationRole;
  sort_order: number;
}

/** Whether a lecture comment was written by an enrolled learner or by staff. */
export type CommentAuthorKind = "student" | "staff";

/**
 * A comment/question on a specific lecture (content_items recording). Top-level
 * when parent_comment_id is null; otherwise a one-level reply. Soft-deleted via
 * deleted_at — rows are never hard-deleted.
 */
export interface LectureComment {
  id: string;
  recording_id: string;
  course_id: string | null;
  author_kind: CommentAuthorKind;
  author_id: string;
  author_name: string;
  author_phone: string | null;
  author_role: string | null;
  body: string;
  parent_comment_id: string | null;
  is_pinned: boolean;
  is_hidden: boolean;
  is_answered: boolean;
  notified_at: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/**
 * Per-course "After Registration" / Class Hub configuration. Shown only to
 * enrolled students (Phase 1 gating = active enrollment; Phase 2 = payment).
 */
export interface CourseAfterRegistration {
  /** Sanitized rich-text welcome message. */
  welcome_html?: string | null;
  /** Zoom / live-class join URL (same pattern as webinars). */
  zoom_link?: string | null;
  /** Passcode / join instructions note. */
  zoom_note?: string | null;
  /** Free-text class timing (IST), e.g. "Mon–Sat, 7–9 AM". */
  class_timing?: string | null;
  /** Optional next live class instant (UTC ISO) for the IST countdown. */
  next_class_at?: string | null;
  videos?: OrientationVideo[];
  /** Library document ids for downloadable study material. */
  doc_ids?: string[];
  /** Reorderable flexible content blocks (heading + rich text + media). */
  blocks?: PageSection[];
}

export interface Coupon {
  code: string;
  type: "percent" | "flat";
  value: number;
  /** ISO date; null/undefined = never expires. */
  expires_at?: string | null;
  /** null/undefined = unlimited. */
  max_uses?: number | null;
  used?: number;
  active?: boolean;
}

// ----------------------------- Landing page config (shared by Course + Webinar) -----------------------------

/** Admin-controlled seats display. When show=false the seats line is hidden entirely. */
export interface SeatConfig {
  show?: boolean;
  total?: number | null;
  remaining?: number | null;
  /** Optional custom text that overrides the auto-generated seats line. */
  text_override?: string | null;
  show_filling_fast?: boolean;
  /** Defaults to "Seats Filling Fast". */
  filling_fast_text?: string | null;
}

/** Per-item contact + WhatsApp CTA. Numbers stored as normalized digits (e.g. 919876543210). */
export interface WhatsAppConfig {
  /** Display/call number (E.164 or digits). */
  phone?: string | null;
  /** WhatsApp number in 91XXXXXXXXXX form. */
  whatsapp?: string | null;
  show_cta?: boolean;
  /** Defaults to "WhatsApp Now". */
  cta_text?: string | null;
  prefill_message?: string | null;
}

export type VideoPlacement = "before_about" | "after_about" | "hero";
export interface VideoConfig {
  show?: boolean;
  title?: string | null;
  subtitle?: string | null;
  url?: string | null;
  /** Defaults to "before_about". */
  placement?: VideoPlacement;
}

export interface MentorInfo {
  name?: string | null;
  credentials?: string | null;
  /** Plain text or sanitized HTML. */
  bio?: string | null;
  image_url?: string | null;
}

export interface SeoConfig {
  title?: string | null;
  description?: string | null;
  keywords?: string | null;
  og_image?: string | null;
  canonical_slug?: string | null;
}

export interface Review {
  id?: string;
  name: string;
  photo_url?: string | null;
  /** 1-5 */
  rating: number;
  text: string;
  /** e.g. "AIR 351", "Selected in UPSC CSE". */
  result?: string | null;
  city?: string | null;
  video_url?: string | null;
  visible?: boolean;
  order?: number;
}

/** Used for "What you will learn" and "What you will get" icon/bullet cards. */
export interface LearnItem {
  title: string;
  desc?: string | null;
  /** Optional emoji or short icon string. */
  icon?: string | null;
}

/** Flexible admin-composed content block rendered after the fixed sections. */
export interface PageSection {
  id?: string;
  title: string;
  subtitle?: string | null;
  /** Sanitized HTML. */
  content?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  order?: number;
  visible?: boolean;
}

// ----------------------------- Courses -----------------------------
export interface Lecture {
  title: string;
  duration?: string;
  youtube_link?: string | null;
}
export interface CourseModule {
  title: string;
  lectures: Lecture[];
}
export interface Course {
  id: string;
  slug: string;
  title: string;
  category: CourseCategory;
  description: string;
  long_description: string | null;
  image: string | null;
  modes: LearningMode[];
  language: string;
  target_years: string;
  batch_start: string | null;
  duration: string | null;
  price: number;
  original_price: number | null;
  /** Optional one-shot discounted price applied ONLY when paying the full fee in one go. Falls back to `price` when null. */
  pay_in_full_price: number | null;
  gst: boolean;
  /** @deprecated EMI is auto-calculated at checkout from `emi_config`. Retained for backward compatibility only. */
  emi_amount: number | null;
  /** @deprecated EMI is auto-calculated at checkout from `emi_config`. Retained for backward compatibility only. */
  emi_months: number | null;
  faculty: string;
  capacity: number | null;
  seats_left: number | null;
  status: "draft" | "published" | "closed";
  brochure_link: string | null;
  demo_video: string | null;
  razorpay_link: string | null;
  included: string[];
  not_included: string[];
  /** Per-section visibility on the public course page. Default ON (true) so
   * existing courses render exactly as before until an admin toggles them off. */
  show_included?: boolean;
  show_not_included?: boolean;
  curriculum: CourseModule[];
  schedule: string | null;
  featured: boolean;
  /** Manual sort order for the public listing (ascending). New courses append to the end. */
  display_order?: number | null;
  created_at: string;
  // --- Rich content + media (optional; added for registration pages) ---
  cover_image_url?: string | null;
  mobile_image_url?: string | null;
  faqs?: FAQItem[];
  contact_links?: ContactLink[];
  pdf_resources?: PdfResource[];
  coupons?: Coupon[];
  /** Visibility toggle — false hides from the public site (Task 7). Defaults to true. */
  active?: boolean;
  // --- Premium landing page (optional; all backward compatible) ---
  /** Rich (sanitized) HTML for "About" — preferred over long_description when present. */
  about_html?: string | null;
  /** Hero badge label (e.g. "Foundation Course"). Falls back to category. */
  badge_label?: string | null;
  seat_config?: SeatConfig;
  whatsapp_config?: WhatsAppConfig;
  video_config?: VideoConfig;
  mentor?: MentorInfo;
  seo?: SeoConfig;
  what_you_learn?: LearnItem[];
  who_should_attend?: string[];
  what_you_get?: LearnItem[];
  reviews?: Review[];
  sections?: PageSection[];
  // --- Phase 1 courses upgrade ---
  /** Central library document ids (brochures/resources) shown publicly. */
  brochure_ids?: string[];
  /** Structured batch timing tags (Morning / Afternoon / Evening / Weekend). */
  batch_timings?: string[];
  /** After-registration / Class Hub config (enrolled students only). */
  after_registration?: CourseAfterRegistration;
  /** Book-Your-Seat + EMI plan config (Phase 2). */
  emi_config?: CourseEmiConfig;
  /** "Mission Control": exactly what enrolling in this course unlocks. */
  entitlements?: CourseEntitlements;
  // --- Batches / variants (Phase 1: data layer only, default-batch fallback) ---
  /**
   * Sellable variants of this course (mode + timing + own price/date/seats).
   * PHASE 1: purely additive. The course-level fields above remain the canonical
   * pricing source until a batch is explicitly chosen at checkout in a later phase.
   * Every existing course is backfilled with exactly one "default batch" mirroring
   * its current values, referenced by `default_batch_id`.
   */
  batches?: CourseBatch[];
  /** Id of the batch used as the fallback/default (mirrors the course-level fields). */
  default_batch_id?: string | null;
}

/**
 * One sellable variant ("batch") of a course. A default batch mirrors the
 * course-level price/date/mode fields exactly so behaviour is unchanged until a
 * batch is explicitly selected. `mode`/`timing` are arrays (mirroring the course's
 * `modes` / `batch_timings`) so a default batch is a lossless snapshot.
 */
export interface CourseBatch {
  id: string;
  /** Human label for staff/receipts, e.g. "Morning · Online". */
  label: string | null;
  /**
   * Delivery mode for this batch. The current model is ONE mode per batch
   * (one batch = one offering), but legacy/backfilled batches may still hold an
   * ARRAY (mirroring the old Course.modes). Always read via batchModes()/
   * batchModeLabel() in lib/installments so both shapes are handled safely.
   */
  mode: LearningMode | LearningMode[];
  /**
   * Timing for this batch. ONE timing per batch in the current model; legacy
   * batches may hold an ARRAY. Always read via batchTimings()/batchTimingLabel().
   */
  timing: string | string[];
  /** Batch start date (UTC ISO; mirrors Course.batch_start). */
  start_date: string | null;
  /** Optional batch end date (UTC ISO). */
  end_date: string | null;
  /** Standard / total fee for this batch (mirrors Course.price). */
  price: number;
  /** Strikethrough anchor (mirrors Course.original_price). */
  original_price: number | null;
  /** One-shot pay-in-full price (mirrors Course.pay_in_full_price). */
  pay_in_full_price: number | null;
  /** Book-Your-Seat + EMI config for this batch (mirrors Course.emi_config). */
  emi_config: CourseEmiConfig;
  /** Total seats (mirrors Course.capacity). */
  capacity: number | null;
  /** Seats remaining (mirrors Course.seats_left). */
  seats_left: number | null;
}

/**
 * Per-course "Access & Entitlements" (Mission Control). Defines exactly what a
 * student gets when they enrol — the SINGLE SOURCE OF TRUTH consumed by the
 * central entitlement check (`lib/entitlements.ts`). All fields optional and
 * backward-compatible: an absent/empty config means "Class Hub only" (legacy).
 */
export interface CourseEntitlements {
  /** Lifetime access, or limited (expires N days after enrolment / at student expiry). */
  access_type?: "lifetime" | "limited";
  /** For limited access: days of access from the enrolment date. */
  access_days?: number | null;
  /** Unlock ALL free quizzes (practice tests) for enrolled students. */
  quizzes_all_free?: boolean;
  /** Specific quizzes/test-series unlocked by this course (incl. PAID ones), by quiz id. */
  quiz_ids?: string[];
  /** Grant access to recorded lectures (Class Hub recordings / orientation videos). */
  recorded?: boolean;
  /** Unlock ALL free Current Affairs compilations. */
  ca_all_free?: boolean;
  /** Specific (paid) Current Affairs compilations unlocked, by CaPdf id. */
  ca_pdf_ids?: string[];
  /** Specific study-material / PDFs from the central library, by LibraryDoc id. */
  library_doc_ids?: string[];
  /** Grant Class Hub / live classes access (default true for any paid course). */
  class_hub?: boolean;
}

export interface Enrollment {
  id: string;
  student_id: string;
  course_id: string;
  status: "active" | "completed" | "cancelled";
  fee_total: number;
  fee_collected: number;
  pending: number;
  installments: { label: string; amount: number; due: string; paid: boolean }[];
  progress: number;
  enrolled_at: string;
}

// ============================ PHASE 2: Book-Your-Seat + EMI ============================

/** Admin per-course config for the "Book Your Seat + EMI" payment plan. */
export interface CourseEmiConfig {
  /** Master switch. When false, only one-time "Pay Full" is available. */
  enabled?: boolean;
  /** Allow the one-time full payment option (default true). */
  allow_full?: boolean;
  /** Fixed seat-booking amount (used when custom seat is off). */
  seat_amount?: number | null;
  /** Allow the student to enter a custom seat amount ≥ min_seat_amount. */
  allow_custom_seat?: boolean;
  /** Minimum seat amount when custom is allowed. */
  min_seat_amount?: number | null;
  /** Enabled installment counts, e.g. [3, 6, 10]. */
  installment_counts?: number[];
  /** Days from seat-booking date to the FIRST installment due date (default 7). */
  first_interval_days?: number;
  /** Calendar-month gap between subsequent installments (default 1). */
  interval_months?: number;
  /** Optional best-value framing shown on the Pay-Full card. */
  best_value_note?: string | null;
}

export type InstallmentKind = "seat" | "installment" | "full";

/**
 * Per-line status. `paid` boolean stays the canonical "money received" flag for
 * backward compatibility; `status` adds non-outstanding states an admin can set.
 * "waived" and "cancelled" are NOT outstanding and never block course access.
 */
export type InstallmentLineStatus = "pending" | "paid" | "overdue" | "waived" | "cancelled";

/** One line in a course enrollment's payment schedule (seat + installments). */
export interface InstallmentItem {
  /** 0 = seat/full (today); 1..N = installments. */
  no: number;
  kind: InstallmentKind;
  label: string;
  amount: number;
  /** Due date (UTC ISO at IST midday). null for the seat/full item (due today). */
  due: string | null;
  paid: boolean;
  paid_at?: string | null;
  reference_no?: string | null;
  gateway_ref?: string | null;
  receipt_no?: string | null;
  // --- Payment-plan management extensions (all optional; stored in the JSONB) ---
  /** Explicit line status. Absent → derived from `paid`/`due`. */
  status?: InstallmentLineStatus;
  /**
   * Optional explicit grace-end date. When set, the SAME 15-day access rule uses
   * this instead of (due + 15 days) — it is not a second grace mechanism.
   */
  grace?: string | null;
  /** Amount actually received against this line (usually equals `amount` when paid). */
  paid_amount?: number | null;
  /** Ledger payment id that settled this line, if any. */
  payment_id?: string | null;
  /** True for a staff-built custom installment (never exposed in public checkout). */
  is_custom?: boolean;
  /** Admin username/id who created this custom line. */
  created_by?: string | null;
  /** Why a line was cancelled/superseded/waived. */
  cancelled_reason?: string | null;
  /** Free-text staff note for this line. */
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type CourseEnrollmentStatus =
  | "pending"
  | "seat_booked"
  | "partially_paid"
  | "fully_paid"
  | "cancelled";

export type CoursePlanType = "full" | "emi";

/** Precise payment plan an admin can convert between (superset of plan_type). */
export type PaymentPlan = "FULL" | "EMI" | "CUSTOM_INSTALLMENTS";

/**
 * A course purchase keyed by buyer phone (matches the existing buyer/portal
 * identity). Holds the chosen plan + full installment schedule + paid cache.
 * The payment ledger is the existing `payments` table (linked via enrollment_id).
 */
export interface CourseEnrollment {
  id: string;
  phone: string;
  student_name: string;
  email: string | null;
  /**
   * Resolved students.id for this enrollment's phone (unique). Not stored on the
   * enrollment row — attached by admin APIs so the UI can deep-link to the right
   * student profile by id (never by name). Null when no students row exists yet.
   */
  student_id?: string | null;
  course_id: string;
  course_slug: string;
  course_title: string;
  /** Snapshot of batch start + timing for receipts/history. */
  batch_label: string | null;
  plan_type: CoursePlanType;
  /** GST-inclusive total course fee snapshot. */
  total_fee: number;
  /** Sum of captured payments (denormalized cache; ledger is source of truth). */
  amount_paid: number;
  installment_count: number;
  status: CourseEnrollmentStatus;
  schedule: InstallmentItem[];
  created_at: string;
  updated_at: string;
  // --- Payment-plan management (additive; admin-driven plan conversion) ---
  /** Precise plan (FULL/EMI/CUSTOM_INSTALLMENTS). Falls back to plan_type when absent. */
  payment_plan?: PaymentPlan | null;
  previous_payment_plan?: PaymentPlan | null;
  payment_plan_changed_at?: string | null;
  payment_plan_changed_by?: string | null;
  payment_plan_change_reason?: string | null;
  /** When true, show the student a one-time "your plan changed" notice on next login. */
  plan_change_notice_pending?: boolean | null;
  plan_change_notice_seen_at?: string | null;
  /** Set on a cancelled duplicate → points at the canonical enrollment it was merged into. */
  superseded_by?: string | null;
  // --- Total-fee discount (additive; staff-applied concession on the total) ---
  /** Cumulative rupee discount applied to the total fee (0/absent = none). */
  discount_amount?: number | null;
  /** The list/original total fee before any discount (captured on first discount). */
  original_total_fee?: number | null;
  /** Latest discount reason/note (audit convenience; full trail in the change log). */
  discount_reason?: string | null;
  discount_applied_by?: string | null;
  discount_applied_at?: string | null;
}

/** Immutable audit record of a single payment-plan change. */
export interface EnrollmentPlanChangeLog {
  id: string;
  enrollment_id: string;
  student_id: string | null;
  phone: string | null;
  course_id: string | null;
  old_plan: string | null;
  new_plan: string | null;
  old_outstanding: number;
  new_outstanding: number;
  reason: string | null;
  changed_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Immutable payment receipt. A correction issues a new receipt, never edits one. */
export interface PaymentReceipt {
  id: string;
  receipt_no: string;
  enrollment_id: string | null;
  payment_id: string | null;
  reference_no: string | null;
  phone: string;
  student_name: string;
  email: string | null;
  course_title: string;
  batch_label: string | null;
  payment_kind: InstallmentKind;
  /** "Book Your Seat", "Installment 2 of 6", "Full Payment". */
  payment_label: string;
  amount: number;
  gateway_ref: string | null;
  total_fee: number;
  paid_to_date: number;
  remaining: number;
  installments_summary: string;
  status: "Seat Booked" | "Partially Paid" | "Fully Paid";
  /** Payment method, e.g. "Cash", "Bank Transfer", "Offline UPI", or a gateway name. Null for older/online records. */
  method?: string | null;
  issued_at: string;
}

// ----------------------------- CRM -----------------------------
export type LeadStatus =
  | "New"
  | "Contacted"
  | "Demo Booked"
  | "Demo Attended"
  | "Negotiation"
  | "Admitted"
  | "Lost";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city: string | null;
  state: string | null;
  source: string;
  campaign: string | null;
  course_interest: string | null;
  target_year: number | null;
  mode_pref: string | null;
  called: boolean;
  status: LeadStatus;
  temperature: "Interested" | "Warm" | "Cold" | "Junk";
  demo_booked: boolean;
  demo_attended: boolean;
  webinar_registered: boolean;
  webinar_attended: boolean;
  admitted: boolean;
  course: string | null;
  total_fee: number | null;
  amount_collected: number | null;
  pending_balance: number | null;
  follow_up_date: string | null;
  counsellor: string | null;
  created_at: string;
  /** Last-touch update time (bumped on every merged touchpoint). */
  updated_at?: string | null;
  /**
   * Full touchpoint history for a de-duplicated lead — every source/campaign the
   * person arrived through, oldest first. The row's own `source`/`campaign` mirror
   * the LATEST touch; `first_source`/`first_campaign` preserve the first touch.
   */
  sources?: LeadSourceTouch[];
  /** First-touch attribution, preserved when later touches overwrite source/campaign. */
  first_source?: string | null;
  first_campaign?: string | null;
  /**
   * Marketing attribution (first-party, first-touch-wins). Captured from the
   * landing URL's utm_* / gclid params via the nsa_attr cookie at submit time.
   * `channel` is the coarse, filterable tag (e.g. "Google Ads"); `attribution`
   * keeps the full first/last-touch state. All additive + nullable.
   */
  channel?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  landing_page_path?: string | null;
  referrer?: string | null;
  attribution?: AttributionState | null;
  /**
   * Soft-merge pointer. When set, this row is a duplicate folded into the canonical
   * lead with this id and is hidden from every list/segment. Null = active/canonical.
   */
  merged_into?: string | null;
  /** How many duplicate rows were merged into this canonical lead. */
  merged_count?: number;
}

/** One touchpoint in a de-duplicated lead's source history. */
export interface LeadSourceTouch {
  source: string | null;
  campaign?: string | null;
  course_interest?: string | null;
  at: string;
  lead_id?: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  type: string;
  note: string;
  counsellor: string | null;
  timestamp: string;
}

export interface LeadFormConfig {
  id: string;
  name: string;
  slug: string;
  campaign: string;
  fields: string[];
  submissions: number;
  created_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  data: Record<string, string>;
  created_at: string;
}

// ----------------------------- Webinars -----------------------------
/** Cross-sell / course promo block shown on the logged-in webinar card. */
export interface CrossSell {
  enabled?: boolean;
  title?: string;
  description?: string;
  href?: string;
  promo_code?: string;
  cta_label?: string;
  /** When to show the promo on the user's card. */
  show_timing?: "always" | "after_webinar";
}

export interface Webinar {
  id: string;
  slug: string;
  title: string;
  description: string;
  datetime: string;
  link: string | null;
  price: number;
  /** "live" (Zoom join + recording after) or "recorded" (recording only). Defaults to live. */
  session_type?: "live" | "recorded";
  /** Optional short note shown inside the "How to join" steps (e.g. "Passcode: 1234"). */
  join_note?: string | null;
  /** Post-registration deliverables (entitlement-gated; shown only in the portal). */
  materials?: PdfResource[];
  /** Course cross-sell / promo block on the user's webinar card. */
  cross_sell?: CrossSell;
  capacity: number | null;
  /**
   * LEGACY/seeded display counter — NOT a reliable registration count (some rows
   * were seeded for marketing). Never show this publicly. The honest public count
   * is computed on-read via getWebinarRegisteredCount(s) (paid-distinct for paid
   * webinars, registration rows for free ones).
   */
  registrations: number;
  recording_link: string | null;
  // --- Hosted recording (uploaded video FILE; reuses the lecture R2 pipeline) ---
  /** Upload lifecycle for a hosted recording: null|uploading|completed|failed. */
  recording_upload_status?: "uploading" | "completed" | "failed" | null;
  /** Active R2 multipart upload id (for resume). */
  recording_upload_id?: string | null;
  /** R2 key being/was uploaded (multipart target). */
  recording_multipart_key?: string | null;
  /** Final playable R2 object key. Present + status "completed" => hosted recording ready. */
  recording_key?: string | null;
  /**
   * When true, recording_key REFERENCES an R2 object owned by another row (a
   * course/lecture content_item reused as this webinar's recording). The shared
   * object must never be deleted when the webinar's recording is removed/replaced.
   * Webinar-owned uploads keep this false.
   */
  recording_is_reference?: boolean | null;
  recording_duration_seconds?: number | null;
  recording_file_size?: number | null;
  /**
   * Public registration-count visibility (Problem 1). null/true => show
   * (threshold-gated honest count); false => hide the count entirely. Defaults to
   * showing so existing webinars are unaffected.
   */
  show_registration_count?: boolean | null;
  status: "upcoming" | "live" | "completed";
  created_at: string;
  /** Optional end time so admins can extend / set a window (Task 8). */
  end_datetime?: string | null;
  // --- Rich content + media (optional; added for registration pages) ---
  long_description?: string | null;
  cover_image_url?: string | null;
  mobile_image_url?: string | null;
  faqs?: FAQItem[];
  contact_links?: ContactLink[];
  pdf_resources?: PdfResource[];
  coupons?: Coupon[];
  /** Visibility toggle — false hides from the public site (Task 7). Defaults to true. */
  active?: boolean;
  // --- Premium landing page (optional; all backward compatible) ---
  /** Rich (sanitized) HTML for "About" — preferred over long_description when present. */
  about_html?: string | null;
  /** Hero badge label (e.g. "Live Webinar"). Falls back to status/price. */
  badge_label?: string | null;
  seat_config?: SeatConfig;
  whatsapp_config?: WhatsAppConfig;
  video_config?: VideoConfig;
  mentor?: MentorInfo;
  seo?: SeoConfig;
  what_you_learn?: LearnItem[];
  who_should_attend?: string[];
  what_you_get?: LearnItem[];
  reviews?: Review[];
  sections?: PageSection[];
  /** Central library document ids (brochures/resources) shown publicly. */
  brochure_ids?: string[];
  // --- Lifecycle controls (additive; see lib/webinarLifecycle.ts) ---
  /** Admin intent for registration. EFFECTIVE status (incl. computed ENDED) is derived on-read. */
  registration_status?: "OPEN" | "CLOSED" | "DISABLED" | "DRAFT" | null;
  /** When true, registration auto-closes once `registration_closes_at` (or start) passes. Default true. */
  auto_close_registration?: boolean | null;
  /** Custom registration cutoff (UTC ISO). Defaults to `datetime` (start) when null. */
  registration_closes_at?: string | null;
  /** Stamped when a session is marked ended (display/audit only). */
  ended_at?: string | null;
  /** Lineage to the duplicated "next" session and the "previous" one. */
  next_webinar_id?: string | null;
  previous_webinar_id?: string | null;
}

export interface WebinarRegistration {
  id: string;
  webinar_id: string;
  name: string;
  phone: string;
  attended: boolean;
  created_at: string;
  // --- First-party attribution (additive; stamped at registration) ---
  attribution_source?: string | null;
  attribution_campaign?: string | null;
  attribution_fbclid?: string | null;
  attribution_fbc?: string | null;
  // --- Late-registration migration provenance (additive) ---
  moved_from_webinar_id?: string | null;
  moved_to_webinar_id?: string | null;
  moved_at?: string | null;
  moved_by?: string | null;
  move_reason?: string | null;
  is_moved_registration?: boolean | null;
}

// ----------------------------- Finance -----------------------------
/**
 * Payment lifecycle.
 *   PENDING   — initiated, within the active window. No access.
 *   VERIFYING — window passed; we are re-checking with ICICI. No access yet.
 *   ABANDONED — ICICI shows no successful payment (clicked Pay, never completed). Hot lead.
 *   FAILED    — ICICI explicitly returned failure/cancellation. No access.
 *   PAID      — ICICI success (callback OR Verify URL). Access granted.
 * `captured`/`pending`/`refunded` are legacy/Razorpay statuses, kept for back-compat.
 */
export type PaymentStatus =
  | "captured"
  | "pending"
  | "refunded"
  /** Checkout opened / "Pay" clicked — a mere intent, NOT money in flight. Created
   *  on button click; promoted to PAID/FAILED by the gateway callback, or expired
   *  to ABANDONED when no confirmation ever arrives. Never counts as paid or as
   *  "needs verification". */
  | "INITIATED"
  | "PENDING"
  | "VERIFYING"
  | "ABANDONED"
  | "PAID"
  | "FAILED";

export interface Payment {
  id: string;
  student_name: string;
  phone: string;
  item: string;
  item_type: "course" | "plan" | "webinar";
  amount: number;
  status: PaymentStatus;
  razorpay_payment_id: string | null;
  mode: string | null;
  created_at: string;
  // ICICI Eazypay fields (optional — keeps existing/Razorpay records valid)
  reference_no?: string | null;
  gateway?: string | null;
  sub_merchant_id?: string | null;
  item_slug?: string | null;
  email?: string | null;
  gateway_ref?: string | null;
  payment_mode?: string | null;
  total_amount?: number | null;
  transaction_amount?: number | null;
  response_code?: string | null;
  transaction_date?: string | null;
  verified_signature?: boolean | null;
  // --- Background ICICI re-verification (backoff scheduling + audit) ---
  /** How many times we've queried ICICI's Verify URL for this row. */
  verify_attempts?: number | null;
  /** Last time we queried ICICI's Verify URL (UTC ISO). */
  last_verify_at?: string | null;
  /** Last raw `status=` token ICICI returned, for audit. */
  verify_status?: string | null;
  /**
   * Settlement state for a PAID row (ICICI Verify URL): "settled" = money in our
   * merchant account (Success); "in_progress" = money confirmed but still
   * reconciling/settling (RIP/SIP) — access is granted, settlement is pending.
   * Null for non-paid rows or when unknown.
   */
  settlement_status?: "settled" | "in_progress" | null;
  // --- Phase 2: Book-Your-Seat + EMI ledger links (nullable; one-time payments leave these null) ---
  enrollment_id?: string | null;
  payment_kind?: "one_time" | "seat" | "installment" | "full" | null;
  /** Installment number this payment settles (0 = seat/full). */
  installment_no?: number | null;
  receipt_no?: string | null;
  /**
   * Chosen course batch id for this attempt (Phase 3 multi-batch). Null for
   * single-batch / no-batch courses. Used to make the short-window enrollment
   * dedup batch-aware so switching batch + re-clicking is a new, correctly-priced
   * attempt rather than a reuse of the previous batch's amount.
   */
  batch_id?: string | null;
  // --- Attribution (analytics; normalized first-touch source snapshot) ---
  attribution_source?: string | null;
  attribution_campaign?: string | null;
  // --- Recoverable soft-delete (super-admin Trash; never hard-deleted) ---
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
  // --- Supersession (canonical group status; paid-wins). The attempt's own
  // status is NEVER changed — these flag an unpaid attempt as moot because
  // another attempt for the SAME student+item+purpose was paid/approved. ---
  is_superseded?: boolean | null;
  superseded_by_payment_id?: string | null;
  superseded_at?: string | null;
  superseded_reason?: string | null;
  // --- Late-registration migration (webinar): item_slug is re-pointed to the
  // target webinar so portal access follows; these preserve the original linkage
  // + who/when/why. No revenue is duplicated — the same row simply moves. ---
  moved_from_webinar_id?: string | null;
  moved_to_webinar_id?: string | null;
  moved_at?: string | null;
  moved_by?: string | null;
  move_reason?: string | null;
  is_moved_registration?: boolean | null;
}

// ----------------------------- Payment proof (self-service recovery) -----------------------------
/** Proof lifecycle — INDEPENDENT of payment status. "none" = no proof row yet. */
export type PaymentProofStatus = "submitted" | "reupload_requested" | "accepted" | "rejected";

export interface PaymentProofFile {
  key: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export interface PaymentProofAudit {
  action: string;
  by: string | null;
  at: string;
  note?: string | null;
}

/**
 * A student-submitted proof-of-payment for a specific payment row. Separate from
 * the ICICI verify engine — uploading proof never grants access.
 */
export interface PaymentProof {
  id: string;
  payment_id: string;
  reference_no: string | null;
  phone: string;
  item_type: string | null;
  item_slug: string | null;
  item: string | null;
  status: PaymentProofStatus;
  files: PaymentProofFile[];
  student_note: string | null;
  admin_reason: string | null;
  audit: PaymentProofAudit[];
  created_at: string;
  updated_at: string;
}

/** Action types recorded in the immutable payment_action_log ledger. */
export type PaymentActionType =
  | "proof_upload"
  | "approve"
  | "reject"
  | "reupload_request"
  | "note"
  | "reverse"
  | "edit"
  | "soft_delete"
  | "restore"
  | "permanent_delete"
  | "supersede"
  | "unsupersede"
  | "verify";

/**
 * One immutable, append-only entry in the payment action ledger. Captures who did
 * what to which payment, the status transition, the reason, and any file refs.
 * Never updated or deleted — the full lifecycle is reconstructed by ordering rows.
 */
export interface PaymentActionLog {
  id: string;
  action: PaymentActionType;
  payment_id: string | null;
  reference_no: string | null;
  enrollment_id: string | null;
  student_id: string | null;
  phone: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_is_super: boolean;
  old_status: string | null;
  new_status: string | null;
  reason: string | null;
  files: PaymentProofFile[];
  file_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** One detected group of duplicate active enrollments (same phone + course). */
export interface DuplicateEnrollmentGroup {
  phone: string;
  course_id: string;
  course_title: string;
  student_name: string;
  count: number;
  /** True if more than one of the duplicates carries real (PAID) money. */
  hasMultiplePaid: boolean;
  enrollments: {
    id: string;
    status: string;
    total_fee: number;
    amount_paid: number;
    created_at: string;
  }[];
}

/** Immutable audit row written for each duplicate-enrollment merge. */
export interface EnrollmentMergeLog {
  id: string;
  phone: string | null;
  course_id: string | null;
  course_title: string | null;
  kept_enrollment_id: string;
  cancelled_enrollment_ids: string[];
  repointed_payment_ids: string[];
  abandoned_payment_ids: string[];
  old_outstanding: number;
  new_outstanding: number;
  old_enrollment_count: number;
  reason: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Per-staff rollup for the super-admin Accountability report. */
export interface StaffAccountabilityRow {
  actor_id: string;
  actor_name: string | null;
  actor_role: string | null;
  uploads: number;
  approvals: number;
  reversals: number;
  rejections: number;
  last_action_at: string | null;
}

export interface Referral {
  id: string;
  referrer_name: string;
  referrer_phone: string;
  referee_name: string;
  tier: 1000 | 3000 | 5000;
  admitted: boolean;
  payout_status: "pending" | "paid";
  created_at: string;
}

// ----------------------------- Staff -----------------------------
export type StaffRole = "Super Admin" | "Counsellor" | "Content Manager";
export interface Staff {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  email: string | null;
  active: boolean;
  created_at: string;
}

/**
 * Internal comp access granted to a staff member (admin_users.id) so they can
 * view a course/webinar through the normal student-facing experience for QA,
 * training and support. This is NOT a payment — it never touches payments,
 * course_enrollments or webinar_registrations, and is excluded from all
 * revenue / seat / "registrations today" metrics.
 */
export interface StaffAccessGrant {
  id: string;
  /** admin_users.id of the staff member receiving access. */
  admin_id: string;
  kind: "course" | "webinar";
  /** courses.id or webinars.id (both text). */
  ref_id: string;
  /** username/admin_id of whoever granted it (audit). */
  granted_by: string | null;
  /** Optional temporary-access expiry; null = no expiry. */
  expires_at: string | null;
  created_at: string;
}

// ----------------------------- RBAC (roles + admin accounts) -----------------------------
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: import("./permissions").PermissionSet;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

export type AdminAccountStatus = "active" | "disabled";

/** An admin login account (row in admin_users) — password hash never leaves the server. */
export interface AdminAccount {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  /** 10-digit mobile used as the staff member's USER-PORTAL test login (unique). */
  phone: string | null;
  role_id: string | null;
  /** Legacy free-text role label (kept for backward compatibility / display). */
  role: string | null;
  status: AdminAccountStatus;
  must_change_password: boolean;
  permissions_override: import("./permissions").PermissionSet | null;
  created_by: string | null;
  last_login_at: string | null;
  created_at: string;
}

// ----------------------------- Site / Home settings -----------------------------
export type HeroButtonStyle = "primary" | "saffron" | "secondary" | "gold";

export interface HeroButton {
  enabled: boolean;
  label: string;
  href: string;
  style?: HeroButtonStyle;
}

export interface HeroStat {
  value: number;
  suffix: string;
  label: string;
}

export interface HeroConfig {
  badge?: string;
  headline?: string;
  subheading?: string;
  /** Transparent PNG portrait of the mentor, shown in the hero. */
  portrait_url?: string | null;
  portrait_alt?: string | null;
  stats?: HeroStat[];
  buttons?: HeroButton[];
}

export interface PopupConfig {
  enabled?: boolean;
  /** Seconds before the popup auto-opens. */
  delay_seconds?: number;
  heading?: string;
  subtext?: string;
  button_text?: string;
  success_message?: string;
  /** Course-interest dropdown options. */
  interest_options?: string[];
}

/** Editable text for the home page's fixed sections. All optional with defaults. */
export interface HomeContent {
  /** Header logo height in px (logo image scales to this). */
  logo_height?: number;
  /** Show the wordmark text next to the logo. */
  show_wordmark?: boolean;
  /** Main wordmark text (bold). */
  wordmark?: string;
  /** Smaller wordmark sub-text / tagline under the main wordmark. */
  wordmark_sub?: string;
  trust_bar?: string[];
  why_heading?: string;
  why_sub?: string;
  modes_heading?: string;
  modes_sub?: string;
  courses_heading?: string;
  courses_sub?: string;
  results_heading?: string;
  results_sub?: string;
  free_heading?: string;
  band_heading?: string;
  band_subtext?: string;
  band_primary_label?: string;
  band_primary_href?: string;
  band_secondary_label?: string;
  band_secondary_href?: string;
  testimonials_heading?: string;
  locations_heading?: string;
  locations_sub?: string;
  faq_heading?: string;
  lead_heading?: string;
  lead_sub?: string;
  /** Quizzes: require a Name+Phone lead form before a guest starts any quiz. Default ON. */
  quiz_lead_gate?: boolean;
  /** Quizzes home page: inspiring quote shown in place of the old disclaimer. */
  quiz_quote?: string;
  quiz_quote_author?: string;
}

/** Editable brand & contact details shown across the site (footer, contact, home). */
export interface BrandConfig {
  name?: string;
  short_name?: string;
  tagline?: string;
  address?: string;
  support_phone?: string;
  support_email?: string;
  whatsapp?: string;
  /** Google Maps link opened by "Get Directions". */
  maps_url?: string;
  /** Optional Google Maps embed URL for the iframe; derived from address when empty. */
  maps_embed_url?: string;
  instagram?: string;
  youtube?: string;
  telegram?: string;
}

export interface Topper {
  id: string;
  name: string;
  /** e.g. "AIR 122" */
  rank: string;
  /** e.g. "UPSC CSE 2024" */
  exam?: string;
  image_url?: string | null;
  year?: number | null;
  order?: number;
}

export interface NavItemSetting {
  visible?: boolean;
  order?: number;
}
export interface NavConfig {
  /** Per-tab overrides keyed by href, e.g. { "/webinars": { visible: false } }. */
  overrides?: Record<string, NavItemSetting>;
}

export interface AboutValue {
  icon?: string;
  title?: string;
  desc?: string;
}
export interface AboutContent {
  hero_eyebrow?: string;
  hero_title?: string;
  hero_intro?: string;
  mentor_heading?: string;
  mentor_body?: string;
  mentor_quote?: string;
  values_heading?: string;
  values?: AboutValue[];
}

export interface SiteSettings {
  id: string;
  logo_url?: string | null;
  logo_alt?: string | null;
  hero: HeroConfig;
  popup: PopupConfig;
  content: HomeContent;
  brand: BrandConfig;
  toppers: Topper[];
  nav: NavConfig;
  about: AboutContent;
  /** Admin-managed leaderboard config (global exclude list + tuned Reliability C). */
  leaderboard: LeaderboardSettings;
  updated_at?: string;
}

// ============================ QUIZ / TEST PLATFORM ============================
// UPSC Prelims-style MCQ practice. All new tables are additive & backward-compatible.

export type QuizOptionKey = "A" | "B" | "C" | "D" | "E";
export type QuizDifficulty = "Easy" | "Moderate" | "Difficult" | "UPSC-level";
export type QuizLanguage = "English" | "Hindi" | "Bilingual";
export type QuestionStatus = "draft" | "published" | "archived";
export type QuestionQuality = "unreviewed" | "approved" | "flagged";

export interface QuestionOptions {
  A: string;
  B: string;
  C: string;
  D: string;
  E?: string | null;
}

export interface Question {
  id: string;
  question_html: string;
  question_image: string | null;
  passage_id: string | null;
  options: QuestionOptions;
  correct_option: QuizOptionKey;
  explanation_html: string | null;
  short_explanation: string | null;
  subject: string | null;
  topic: string | null;
  subtopic: string | null;
  difficulty: QuizDifficulty;
  tags: string[];
  source: string | null;
  source_url: string | null;
  is_pyq: boolean;
  pyq_year: number | null;
  current_affairs_date: string | null;
  language: QuizLanguage;
  status: QuestionStatus;
  quality_status: QuestionQuality;
  allow_in_public_quiz: boolean;
  allow_in_paid_quiz: boolean;
  marks_override: number | null;
  negative_marks_override: number | null;
  duplicate_check_hash: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type QuizType =
  | "Daily" | "CurrentAffairs" | "Topic" | "Subject" | "Sectional"
  | "FullMock" | "Course" | "PaidSubscriber" | "FreePublic";
export type QuizExamType = "PrelimsGS" | "CSAT" | "General";
export type QuizStatus = "draft" | "published" | "scheduled" | "archived" | "disabled";

export interface QuizScoringSettings {
  negative_marks_type?: "fraction" | "fixed";
  no_penalty_for_blank?: boolean;
  total_marks?: number;
  passing_marks?: number | null;
  show_percentile?: boolean;
  show_rank?: boolean;
  expected_cutoff?: number | null;
}
export interface QuizTimingSettings {
  time_limit_enabled?: boolean;
  start_at?: string | null;
  end_at?: string | null;
  scheduled_release?: string | null;
  scheduled_close?: string | null;
  auto_submit_on_time_end?: boolean;
  server_time_validation?: boolean;
  resume_allowed?: boolean;
  max_resume_count?: number | null;
  show_timer?: boolean;
}
export interface QuizAttemptSettings {
  access_without_login?: boolean;
  login_required?: boolean;
  retry_allowed?: boolean;
  score_count?: "best" | "latest";
  randomize_question_order?: boolean;
  randomize_option_order?: boolean;
  one_at_a_time?: boolean;
  tab_switch_warning?: boolean;
}
export interface QuizResultSettings {
  show_result_immediately?: boolean;
  show_score?: boolean;
  show_correct_answers?: boolean;
  show_explanations?: boolean;
  show_topic_analysis?: boolean;
  show_rank_percentile?: boolean;
  show_answer_key?: boolean;
  show_pdf_download?: boolean;
  reveal_explanations_after?: string | null;
  capture_lead_before_result?: boolean;
}
export interface QuizAccessRules {
  allowed_course_ids?: string[];
  allowed_batch_ids?: string[];
  allowed_plan_ids?: string[];
  allowed_user_ids?: string[];
  allowed_user_types?: string[];
  active_from?: string | null;
  active_to?: string | null;
  expires_at?: string | null;
}
export interface QuizSeo {
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  canonical_url?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  indexable?: boolean;
  include_in_sitemap?: boolean;
  structured_data_enabled?: boolean;
  public_summary?: string;
  faq?: { q: string; a: string }[];
}

export interface Quiz {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  instructions_html: string | null;
  type: QuizType;
  exam_type: QuizExamType;
  subject: string | null;
  topic: string | null;
  quiz_date: string | null;
  quiz_month: string | null;
  quiz_year: number | null;
  difficulty: QuizDifficulty;
  language: QuizLanguage;
  thumbnail: string | null;
  status: QuizStatus;
  is_public: boolean;
  requires_login: boolean;
  requires_payment: boolean;
  time_limit_minutes: number | null;
  marks_per_question: number;
  negative_marking_enabled: boolean;
  negative_fraction: number;
  max_attempts: number | null;
  scoring_settings: QuizScoringSettings;
  timing_settings: QuizTimingSettings;
  attempt_settings: QuizAttemptSettings;
  result_settings: QuizResultSettings;
  access_rules: QuizAccessRules;
  seo: QuizSeo;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Snapshot stored on quiz_questions / quiz_answers so historical results never change. */
export interface QuestionSnapshot {
  question_html?: string;
  question_image?: string | null;
  options?: QuestionOptions;
  correct_option?: QuizOptionKey;
  explanation_html?: string | null;
  short_explanation?: string | null;
  subject?: string | null;
  topic?: string | null;
  difficulty?: QuizDifficulty;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_id: string;
  order_index: number;
  section: string | null;
  marks: number | null;
  negative_marks: number | null;
  snapshot: QuestionSnapshot;
  created_at: string;
}

export type QuizAttemptStatus =
  | "IN_PROGRESS" | "SUBMITTED" | "AUTO_SUBMITTED" | "EXPIRED" | "ABANDONED";

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  user_id: string | null;
  guest_session_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_mobile: string | null;
  status: QuizAttemptStatus;
  started_at: string;
  submitted_at: string | null;
  expires_at: string | null;
  time_taken_seconds: number | null;
  score: number;
  max_score: number;
  correct_count: number;
  incorrect_count: number;
  unattempted_count: number;
  accuracy: number;
  negative_marks: number;
  percentile: number | null;
  rank: number | null;
  result_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface QuizAnswer {
  id: string;
  attempt_id: string;
  quiz_id: string;
  question_id: string;
  selected_option: QuizOptionKey | null;
  is_correct: boolean;
  is_unattempted: boolean;
  marks_awarded: number;
  negative_marks_deducted: number;
  time_spent_seconds: number | null;
  marked_for_review: boolean;
  answer_snapshot: QuestionSnapshot;
  created_at: string;
  updated_at: string;
}

export type ImportJobType = "GOOGLE_SHEET" | "CSV" | "BULK_TEXT";
export type ImportJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ImportJobError {
  row: number;
  message: string;
}

export interface ImportJob {
  id: string;
  type: ImportJobType;
  source_config: Record<string, unknown>;
  status: ImportJobStatus;
  total_rows: number;
  success_count: number;
  error_count: number;
  errors: ImportJobError[];
  created_by: string | null;
  created_at: string;
}

// ========================= CURRENT AFFAIRS =========================
/** Article-type is a FILTER/badge, never a separate public route. */
export type CaArticleType = "daily" | "editorial" | "prelims_facts" | "mains_analysis";
export type CaStatus = "draft" | "scheduled" | "published" | "archived" | "disabled";
export type CaExamRelevance = "prelims" | "mains" | "interview" | "both";
export type CaDifficulty = "easy" | "medium" | "hard";
export type CaGsPaper = "GS1" | "GS2" | "GS3" | "GS4" | "Essay" | "Prelims";

/** SEO block stored on articles, categories and tags. */
export interface CaSeo {
  title?: string | null;
  description?: string | null;
  keywords?: string | null;
  canonical_slug?: string | null;
  canonical_override?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  noindex?: boolean;
  nofollow?: boolean;
  structured_data_enabled?: boolean;
  faq_schema_enabled?: boolean;
  faq?: { q: string; a: string }[];
}

/** Top "Quick Revision" box shown above the article body. */
export interface CaQuickRevision {
  bullets?: string[];
  why_in_news?: string | null;
  upsc_relevance?: string | null;
  exam_angle?: string | null;
}

/** UPSC relevance metadata (admin-only + badges). */
export interface CaUpsc {
  topic?: string | null;
  subtopic?: string | null;
  gs_papers?: CaGsPaper[];
  syllabus_tags?: string[];
  exam_relevance?: CaExamRelevance | null;
  difficulty?: CaDifficulty | null;
  source_type?: string | null;
  source_note?: string | null;
}

/** Flexible ordered section (reuses the PageSection shape). */
export type CaSection = PageSection;

export interface CaArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  article_type: CaArticleType;
  status: CaStatus;
  /** Effective go-live timestamp; future = scheduled, hidden from public. */
  publish_at: string | null;
  /** The current-affairs calendar date this article belongs to (YYYY-MM-DD). */
  ca_date: string | null;
  author: string | null;
  reading_time: number | null;
  featured_image: string | null;
  thumbnail_image: string | null;
  mobile_image: string | null;
  body_html: string | null;
  sections: CaSection[];
  category_slug: string | null;
  tags: string[];
  quick_revision: CaQuickRevision;
  upsc: CaUpsc;
  important: boolean;
  trending: boolean;
  show_on_home: boolean;
  in_daily: boolean;
  in_monthly: boolean;
  related_quiz_slug: string | null;
  pdf_ids: string[];
  cross_sell: CrossSell;
  seo: CaSeo;
  views: number;
  created_at: string;
  updated_at: string;
}

export interface CaCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo: CaSeo;
  order: number;
  created_at: string;
}

// ============================ UPSC RESOURCES (SEO content hub) ============================
export type ResourceStatus = "draft" | "scheduled" | "published" | "archived";
export type ResourceExamRelevance = "prelims" | "mains" | "interview" | "beginner" | "all";
export type ResourceDifficulty = "beginner" | "intermediate" | "advanced";

/** A reusable call-to-action block the admin can attach to an article. */
export interface ResourceCta {
  /** Preset kind drives the default icon/label; "custom" allows a free link. */
  kind: "webinar" | "course" | "quiz" | "whatsapp" | "centre" | "pdf" | "custom";
  title?: string | null;
  description?: string | null;
  cta_label?: string | null;
  href?: string | null;
  enabled?: boolean;
}

/** Related-content selectors (by slug) that also feed the internal-link graph. */
export interface ResourceRelated {
  resource_slugs?: string[];
  quiz_slugs?: string[];
  webinar_slugs?: string[];
  course_slugs?: string[];
}

/**
 * A UPSC Resource — an evergreen SEO article/guide, separate from (but linkable
 * to) Current Affairs. Supports a chronological "Day 1 → Exam" journey.
 */
export interface Resource {
  id: string;
  slug: string;
  title: string;
  /** Short excerpt / summary; also the meta-description fallback. */
  summary: string;
  body_html: string | null;
  sections: PageSection[];
  /** Category slug, e.g. beginner | strategy | books | syllabus | optional | prelims | mains | local | notes. */
  category: string | null;
  subject: string | null;
  exam_relevance: ResourceExamRelevance | null;
  target_year: string | null;
  difficulty: ResourceDifficulty | null;
  status: ResourceStatus;
  publish_at: string | null;
  author: string | null;
  reading_time: number | null;
  featured_image: string | null;
  tags: string[];
  pdf_ids: string[];
  /** FAQ items — power an on-page FAQ block + FAQPage JSON-LD. */
  faq: { q: string; a: string }[];
  /** Ordered CTA blocks rendered on the article. */
  cta_blocks: ResourceCta[];
  related: ResourceRelated;
  focus_keyword: string | null;
  seo: CaSeo;
  // --- Chronological journey ---
  /** Journey stage label, e.g. "Stage 1: Getting Started". Empty = not in journey. */
  journey_stage: string | null;
  /** Order within the whole roadmap (ascending). */
  order_index: number;
  /** Marks a local-SEO page → enables LocalBusiness schema + local CTAs. */
  is_local: boolean;
  views: number;
  created_at: string;
  updated_at: string;
}

export interface CaTag {
  id: string;
  slug: string;
  name: string;
  seo: CaSeo;
  created_at: string;
}

export type CaPdfKind = "daily" | "monthly" | "general";

export interface CaPdf {
  id: string;
  title: string;
  kind: CaPdfKind;
  /** For daily PDFs (YYYY-MM-DD) or monthly PDFs (YYYY-MM). */
  date_ref: string | null;
  category_slug: string | null;
  file_url: string | null;
  cover_image: string | null;
  description: string | null;
  is_free: boolean;
  requires_login: boolean;
  requires_lead: boolean;
  /** Reserved hook for future auto-generation from compiled articles. */
  generated: boolean;
  download_count: number;
  created_at: string;
  updated_at: string;
}

/** Admin-pinned manual announcement shown alongside auto "What's New" items. */
export interface Announcement {
  id: string;
  title: string;
  href: string | null;
  badge: string | null;
  active: boolean;
  /** Show in the slim rotating bar at the top of the homepage. */
  pinned: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CaLead {
  id: string;
  phone: string;
  name: string | null;
  source: string | null;
  city: string | null;
  target_year: string | null;
  interested_course: string | null;
  created_at: string;
}

export interface CaBookmark {
  id: string;
  user_phone: string;
  article_slug: string;
  created_at: string;
}

export type CaEventType = "view" | "pdf_download" | "cta_click" | "quiz_click" | "lead";

export interface CaEvent {
  id: string;
  type: CaEventType;
  ref: string | null;
  created_at: string;
}
