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
  plan: PlanId;
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
  created_at: string;
}

export interface ContentItem {
  id: string;
  type: ContentType;
  subject: string | null;
  paper: string | null;
  title: string;
  description: string | null;
  drive_link: string | null;
  youtube_link: string | null;
  date: string | null;
  duration: string | null;
  is_published: boolean;
  course_id: string | null;
  drip_date: string | null;
  created_at: string;
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

export interface AdminSessionPayload {
  admin_id: string;
  username: string;
  role: StaffRole;
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
  gst: boolean;
  emi_amount: number | null;
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
  curriculum: CourseModule[];
  schedule: string | null;
  featured: boolean;
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
export interface Webinar {
  id: string;
  slug: string;
  title: string;
  description: string;
  datetime: string;
  link: string | null;
  price: number;
  capacity: number | null;
  registrations: number;
  recording_link: string | null;
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
}

export interface WebinarRegistration {
  id: string;
  webinar_id: string;
  name: string;
  phone: string;
  attended: boolean;
  created_at: string;
}

// ----------------------------- Finance -----------------------------
export type PaymentStatus = "captured" | "pending" | "refunded" | "PENDING" | "PAID" | "FAILED";

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
