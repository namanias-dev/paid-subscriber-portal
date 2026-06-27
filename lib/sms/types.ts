/** Shared SMS domain types for the in-portal communications system. */

export type SmsUseCase = "PAYMENT" | "WEBINAR" | "POST_WEBINAR" | "ONBOARDING";
export type SmsMessageType = "service" | "promotional";
export type SmsTemplateStatus = "draft" | "pending" | "approved" | "active" | "inactive";
export type SmsLogStatus = "QUEUED" | "SENT" | "FAILED" | "DELIVERED" | "UNKNOWN";
export type SmsSentByType = "ADMIN" | "SYSTEM";

/** Canonical variable catalogue (only these may appear in a body). */
export type SmsVariable =
  | "name" | "first_name" | "mobile" | "login_code" | "login_url"
  | "item_name" | "item_short" | "amount" | "payment_status"
  | "webinar_date" | "webinar_time" | "support_number";

export interface SmsTemplate {
  id: string;
  name: string;
  use_case: SmsUseCase;
  gateway_template_id: string | null;
  sender_id: string;
  route: string;
  message_type: SmsMessageType;
  body_template: string;
  variables: string[];
  status: SmsTemplateStatus;
  is_active: boolean;
  auto_send_enabled: boolean;
  trigger_event: string | null;
  audience_type: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsLog {
  id: string;
  mobile: string;
  normalized_mobile: string;
  student_name: string | null;
  user_id: string | null;
  lead_id: string | null;
  registration_id: string | null;
  payment_id: string | null;
  course_id: string | null;
  webinar_id: string | null;
  template_id: string | null;
  template_name: string | null;
  gateway_template_id: string | null;
  sender_id: string | null;
  route: string | null;
  message_body: string;
  character_count: number | null;
  segments: number | null;
  status: SmsLogStatus;
  gateway_response: unknown;
  gateway_message_id: string | null;
  sent_by_user_id: string | null;
  sent_by_type: SmsSentByType;
  trigger_event: string | null;
  audience_type: string | null;
  dedupe_key: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface SmsAutoRule {
  trigger: string;
  template_id: string | null;
  enabled: boolean;
  delay_minutes: number | null;
  schedule_time: string | null;
  offset_minutes: number | null;
  audience_type: string | null;
  last_run_at: string | null;
  updated_by?: string | null;
  updated_at: string;
}

export interface SmsSettings {
  /** Soft kill switch (in addition to the hard SMS_ENABLED env). */
  enabled: boolean;
  /** 0 = unlimited. Falls back to SMS_DAILY_CAP env when unset. */
  dailyCap: number;
  /** 0 = unlimited global per-recipient cap across ALL templates. */
  perMobileDailyCap: number;
  /** Allowed send window in IST, "HH:MM". */
  windowStart: string;
  windowEnd: string;
  /** Post-webinar (T19) delay after webinar end, in minutes. */
  t19OffsetMinutes: number;
  /** When attendance is unknown, fall back to ALL registered for T19. */
  t19FallbackAllRegistered: boolean;
  updated_at?: string;
  updated_by?: string | null;
}
