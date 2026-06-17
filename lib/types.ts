export type PlanId = "1m" | "3m" | "6m" | "12m" | "lifetime";

export type ContentType =
  | "current_affairs"
  | "mcq"
  | "booklet"
  | "recording"
  | "live_link"
  | "pyq"
  | "test_series"
  | "answer_writing";

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
}
