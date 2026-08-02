import { TRIGGERS as SMS_TRIGGERS } from "../sms/templates";

export interface TelegramButton {
  label: string;
  url: string;
}

export interface FollowUpStep {
  delay_hours: number;
  body: string;
  image_url?: string | null;
  buttons?: TelegramButton[];
  stop_if_replied?: boolean;
  stop_if_converted?: boolean;
}

export type TelegramQueueStatus =
  | "queued"
  | "sent"
  | "failed"
  | "blocked"
  | "skipped"
  | "paused";

export type TelegramScheduleMode =
  | "on_trigger"
  | "send_now"
  | "datetime"
  | "recurring"
  | "manual";

export type TelegramBroadcastStatus =
  | "draft"
  | "queued"
  | "sending"
  | "done"
  | "cancelled";

/** SMS triggers plus Telegram-specific keys. */
export const TELEGRAM_TRIGGERS = {
  ...SMS_TRIGGERS,
  subscriber_joined: "subscriber_joined",
  subscriber_replied: "subscriber_replied",
  scheduled: "scheduled",
  manual: "manual",
} as const;

export type TelegramTrigger = (typeof TELEGRAM_TRIGGERS)[keyof typeof TELEGRAM_TRIGGERS];

export const TELEGRAM_TRIGGER_LIST: TelegramTrigger[] = Object.values(TELEGRAM_TRIGGERS);

export interface TelegramSubscriber {
  id: string;
  chat_id: string;
  telegram_user_id: string | null;
  username: string | null;
  first_name: string | null;
  linked_lead_id: string | null;
  linked_student_id: string | null;
  source: string | null;
  subscribed_at: string;
  is_active: boolean;
  unsubscribed_at: string | null;
  last_interaction_at: string;
  phone: string | null;
  first_inbound_ack_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramTemplate {
  id: string;
  name: string;
  body: string;
  image_url: string | null;
  buttons: TelegramButton[];
  variables: string[];
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramAutomation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  audience_id: string | null;
  schedule_mode: TelegramScheduleMode;
  schedule_at: string | null;
  recurring_cron: string | null;
  message_body: string;
  image_url: string | null;
  buttons: TelegramButton[];
  template_id: string | null;
  follow_ups: FollowUpStep[];
  stop_on_reply: boolean;
  stop_on_converted: boolean;
  created_by: string | null;
  updated_by: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramBroadcast {
  id: string;
  name: string | null;
  audience_id: string;
  message_body: string;
  image_url: string | null;
  buttons: TelegramButton[];
  status: TelegramBroadcastStatus;
  scheduled_at: string | null;
  audience_size: number;
  reachable_count: number;
  sent_count: number;
  failed_count: number;
  blocked_count: number;
  skipped_count: number;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TelegramSendQueueRow {
  id: string;
  chat_id: string;
  subscriber_id: string | null;
  status: TelegramQueueStatus;
  skip_reason: string | null;
  body: string;
  image_url: string | null;
  buttons: TelegramButton[];
  automation_id: string | null;
  broadcast_id: string | null;
  follow_up_index: number | null;
  attempt: number;
  max_attempts: number;
  scheduled_at: string;
  pause_until: string | null;
  last_error: string | null;
  telegram_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  sent_at: string | null;
}

export interface TelegramMessage {
  id: string;
  chat_id: string;
  subscriber_id: string | null;
  direction: "inbound" | "outbound";
  body: string | null;
  telegram_message_id: string | null;
  callback_data: string | null;
  is_read: boolean;
  sent_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TelegramSettings {
  id: string;
  bot_username: string | null;
  welcome_body: string | null;
  welcome_buttons: TelegramButton[];
  welcome_image_url: string | null;
  unknown_command_reply: string | null;
  first_inbound_ack_enabled: boolean;
  first_inbound_ack_body: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface TelegramReachable {
  chat_id: string;
  name: string | null;
  phone: string | null;
  subscriber_id: string;
}

export interface EnqueueSendInput {
  chat_id: string;
  subscriber_id?: string | null;
  body: string;
  image_url?: string | null;
  buttons?: TelegramButton[];
  automation_id?: string | null;
  broadcast_id?: string | null;
  follow_up_index?: number | null;
  scheduled_at?: string | null;
  status?: TelegramQueueStatus;
  skip_reason?: string | null;
  metadata?: Record<string, unknown>;
}

export type TelegramTemplateVars = {
  name?: string | null;
  course?: string | null;
  amount?: string | number | null;
  coupon?: string | null;
  webinar_date?: string | null;
  [key: string]: string | number | null | undefined;
};
