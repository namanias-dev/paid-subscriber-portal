import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
import { tgLog } from "./log";
import {
  DEFAULT_FIRST_INBOUND_ACK,
  DEFAULT_UNKNOWN_COMMAND,
  DEFAULT_WELCOME,
  defaultWelcomeButtons,
} from "./defaults";
import type { TelegramButton, TelegramSettings, TelegramSubscriber } from "./types";

function db() {
  return getSupabaseAdmin();
}

function nowIso() {
  return new Date().toISOString();
}

function asButtons(raw: unknown): TelegramButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || o.text || "").trim();
      const url = String(o.url || "").trim();
      if (!label || !url) return null;
      return { label, url };
    })
    .filter(Boolean) as TelegramButton[];
}

function mapSubscriber(row: Record<string, unknown>): TelegramSubscriber {
  return {
    id: String(row.id),
    chat_id: String(row.chat_id),
    telegram_user_id: row.telegram_user_id != null ? String(row.telegram_user_id) : null,
    username: row.username != null ? String(row.username) : null,
    first_name: row.first_name != null ? String(row.first_name) : null,
    linked_lead_id: row.linked_lead_id != null ? String(row.linked_lead_id) : null,
    linked_student_id: row.linked_student_id != null ? String(row.linked_student_id) : null,
    source: row.source != null ? String(row.source) : null,
    subscribed_at: String(row.subscribed_at || row.created_at),
    is_active: !!row.is_active,
    unsubscribed_at: row.unsubscribed_at != null ? String(row.unsubscribed_at) : null,
    last_interaction_at: String(row.last_interaction_at || row.updated_at || nowIso()),
    phone: row.phone != null ? String(row.phone) : null,
    first_inbound_ack_sent_at:
      row.first_inbound_ack_sent_at != null ? String(row.first_inbound_ack_sent_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export interface UpsertFromStartInput {
  chatId: string | number;
  userId?: string | number | null;
  username?: string | null;
  firstName?: string | null;
  payload?: string | null;
}

export interface UpsertFromStartResult {
  isNew: boolean;
  reactivated: boolean;
  subscriber: TelegramSubscriber;
}

async function linkLead(leadId: string, chatId: string): Promise<{ phone: string | null } | null> {
  const supabase = db();
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("leads").select("id, phone").eq("id", leadId).maybeSingle();
    if (!data) return null;
    await supabase.from("leads").update({ telegram_chat_id: chatId }).eq("id", leadId);
    const n = normalizeIndianMobile((data as { phone?: string }).phone);
    return { phone: n.ok && n.digits10 ? n.digits10 : null };
  } catch {
    return null;
  }
}

async function linkStudent(studentId: string, chatId: string): Promise<{ phone: string | null } | null> {
  const supabase = db();
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("students").select("id, phone").eq("id", studentId).maybeSingle();
    if (!data) return null;
    await supabase.from("students").update({ telegram_chat_id: chatId }).eq("id", studentId);
    const n = normalizeIndianMobile((data as { phone?: string }).phone);
    return { phone: n.ok && n.digits10 ? n.digits10 : null };
  } catch {
    return null;
  }
}

export async function upsertFromStart(input: UpsertFromStartInput): Promise<UpsertFromStartResult | null> {
  const supabase = db();
  if (!supabase) return null;
  const chatId = String(input.chatId);
  const payload = (input.payload || "").trim();
  const ts = nowIso();

  let linkedLeadId: string | null = null;
  let linkedStudentId: string | null = null;
  let phone: string | null = null;
  let source: string | null = null;

  if (payload.startsWith("lead_")) {
    const candidate = payload.slice("lead_".length) || null;
    if (candidate) {
      const linked = await linkLead(candidate, chatId);
      if (linked) {
        linkedLeadId = candidate;
        phone = linked.phone;
      } else {
        tgLog("lead_link_miss", { lead_id: candidate, chat_id: chatId }, "warn");
        source = payload.slice(0, 120);
      }
    }
  } else if (payload.startsWith("student_")) {
    const candidate = payload.slice("student_".length) || null;
    if (candidate) {
      const linked = await linkStudent(candidate, chatId);
      if (linked) {
        linkedStudentId = candidate;
        phone = linked.phone;
      } else {
        tgLog("student_link_miss", { student_id: candidate, chat_id: chatId }, "warn");
        source = payload.slice(0, 120);
      }
    }
  } else if (payload) {
    source = payload.slice(0, 120);
  }

  const { data: existing } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (existing) {
    const wasInactive = !existing.is_active;
    const patch: Record<string, unknown> = {
      telegram_user_id: input.userId != null ? String(input.userId) : existing.telegram_user_id,
      username: input.username ?? existing.username,
      first_name: input.firstName ?? existing.first_name,
      is_active: true,
      unsubscribed_at: null,
      last_interaction_at: ts,
      updated_at: ts,
    };
    if (linkedLeadId) patch.linked_lead_id = linkedLeadId;
    if (linkedStudentId) patch.linked_student_id = linkedStudentId;
    if (phone) patch.phone = phone;
    if (source && !existing.source) patch.source = source;
    if (wasInactive) patch.subscribed_at = ts;

    const { data, error } = await supabase
      .from("telegram_subscribers")
      .update(patch)
      .eq("chat_id", chatId)
      .select("*")
      .single();
    if (error || !data) {
      tgLog("subscriber_update_failed", { chat_id: chatId, error: error?.message || "no_data" }, "error");
      return null;
    }
    return {
      isNew: false,
      reactivated: wasInactive,
      subscriber: mapSubscriber(data as Record<string, unknown>),
    };
  }

  const row = {
    chat_id: chatId,
    telegram_user_id: input.userId != null ? String(input.userId) : null,
    username: input.username || null,
    first_name: input.firstName || null,
    linked_lead_id: linkedLeadId,
    linked_student_id: linkedStudentId,
    source,
    phone,
    is_active: true,
    subscribed_at: ts,
    last_interaction_at: ts,
    created_at: ts,
    updated_at: ts,
  };
  const { data, error } = await supabase.from("telegram_subscribers").insert(row).select("*").single();
  if (error || !data) {
    tgLog("subscriber_insert_failed", { chat_id: chatId, error: error?.message || "no_data" }, "error");
    return null;
  }
  return {
    isNew: true,
    reactivated: false,
    subscriber: mapSubscriber(data as Record<string, unknown>),
  };
}

export async function markInactive(chatId: string | number, reason?: string): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  const ts = nowIso();
  try {
    await supabase
      .from("telegram_subscribers")
      .update({
        is_active: false,
        unsubscribed_at: ts,
        updated_at: ts,
        last_interaction_at: ts,
      })
      .eq("chat_id", String(chatId));
    void reason;
  } catch {
    /* never break callers */
  }
}

export async function reactivate(chatId: string | number): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const ts = nowIso();
  const { data, error } = await supabase
    .from("telegram_subscribers")
    .update({
      is_active: true,
      unsubscribed_at: null,
      subscribed_at: ts,
      last_interaction_at: ts,
      updated_at: ts,
    })
    .eq("chat_id", String(chatId))
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return mapSubscriber(data as Record<string, unknown>);
}

export async function findActiveByChatId(chatId: string | number): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("chat_id", String(chatId))
    .eq("is_active", true)
    .maybeSingle();
  return data ? mapSubscriber(data as Record<string, unknown>) : null;
}

export async function findByChatId(chatId: string | number): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("chat_id", String(chatId))
    .maybeSingle();
  return data ? mapSubscriber(data as Record<string, unknown>) : null;
}

export async function linkByPhone(
  chatId: string | number,
  phone: string,
): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const digits = n.digits10;
  const ts = nowIso();

  let linkedLeadId: string | null = null;
  let linkedStudentId: string | null = null;
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", digits)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead?.id) {
      linkedLeadId = String(lead.id);
      await supabase.from("leads").update({ telegram_chat_id: String(chatId) }).eq("id", linkedLeadId);
    }
  } catch {
    /* ignore */
  }
  try {
    const { data: student } = await supabase
      .from("students")
      .select("id")
      .eq("phone", digits)
      .limit(1)
      .maybeSingle();
    if (student?.id) {
      linkedStudentId = String(student.id);
      await supabase.from("students").update({ telegram_chat_id: String(chatId) }).eq("id", linkedStudentId);
    }
  } catch {
    /* ignore */
  }

  const { data, error } = await supabase
    .from("telegram_subscribers")
    .update({
      phone: digits,
      linked_lead_id: linkedLeadId,
      linked_student_id: linkedStudentId,
      updated_at: ts,
      last_interaction_at: ts,
    })
    .eq("chat_id", String(chatId))
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return mapSubscriber(data as Record<string, unknown>);
}

export async function listSubscribers(opts: {
  activeOnly?: boolean;
  q?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: TelegramSubscriber[]; total: number }> {
  const supabase = db();
  if (!supabase) return { rows: [], total: 0 };
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const offset = Math.max(0, opts.offset || 0);
  let q = supabase
    .from("telegram_subscribers")
    .select("*", { count: "exact" })
    .order("last_interaction_at", { ascending: false });
  if (opts.activeOnly) q = q.eq("is_active", true);
  if (opts.q?.trim()) {
    const term = opts.q.trim().replace(/[%_]/g, "");
    q = q.or(
      `first_name.ilike.%${term}%,username.ilike.%${term}%,phone.ilike.%${term}%,chat_id.ilike.%${term}%`,
    );
  }
  const { data, count, error } = await q.range(offset, offset + limit - 1);
  if (error) return { rows: [], total: 0 };
  return {
    rows: ((data || []) as Record<string, unknown>[]).map(mapSubscriber),
    total: count ?? 0,
  };
}

export async function findActiveByPhone(phone: string): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("phone", n.digits10)
    .eq("is_active", true)
    .order("last_interaction_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapSubscriber(data as Record<string, unknown>) : null;
}

export async function findActiveByLeadId(leadId: string): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("linked_lead_id", leadId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data ? mapSubscriber(data as Record<string, unknown>) : null;
}

export async function findActiveByStudentId(studentId: string): Promise<TelegramSubscriber | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("linked_student_id", studentId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data ? mapSubscriber(data as Record<string, unknown>) : null;
}

function mapSettings(data: Record<string, unknown> | null | undefined): TelegramSettings {
  const buttons = asButtons(data?.welcome_buttons);
  return {
    id: "default",
    bot_username: data?.bot_username != null ? String(data.bot_username).replace(/^@/, "") : null,
    welcome_body: data?.welcome_body != null ? String(data.welcome_body) : DEFAULT_WELCOME,
    welcome_buttons: buttons.length ? buttons : defaultWelcomeButtons(),
    welcome_image_url: data?.welcome_image_url != null ? String(data.welcome_image_url) : null,
    unknown_command_reply:
      data?.unknown_command_reply != null ? String(data.unknown_command_reply) : DEFAULT_UNKNOWN_COMMAND,
    first_inbound_ack_enabled: data?.first_inbound_ack_enabled !== false,
    first_inbound_ack_body:
      data?.first_inbound_ack_body != null ? String(data.first_inbound_ack_body) : DEFAULT_FIRST_INBOUND_ACK,
    updated_at: String(data?.updated_at || nowIso()),
    updated_by: data?.updated_by != null ? String(data.updated_by) : null,
  };
}

/** Ensure a settings row exists with sensible defaults (no redeploy needed). */
export async function ensureDefaultSettings(): Promise<TelegramSettings> {
  const supabase = db();
  if (!supabase) return mapSettings(null);
  const { data: existing } = await supabase.from("telegram_settings").select("*").eq("id", "default").maybeSingle();
  if (existing) return mapSettings(existing as Record<string, unknown>);
  const seed = {
    id: "default",
    welcome_body: DEFAULT_WELCOME,
    welcome_buttons: defaultWelcomeButtons(),
    first_inbound_ack_enabled: true,
    first_inbound_ack_body: DEFAULT_FIRST_INBOUND_ACK,
    unknown_command_reply: DEFAULT_UNKNOWN_COMMAND,
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("telegram_settings").insert(seed).select("*").single();
  if (error) tgLog("settings_seed_failed", { error: error.message }, "error");
  return mapSettings((data || seed) as Record<string, unknown>);
}

export async function getSettings(): Promise<TelegramSettings> {
  return ensureDefaultSettings();
}

export async function updateSettings(
  patch: Partial<{
    bot_username: string | null;
    welcome_body: string | null;
    welcome_buttons: TelegramButton[];
    welcome_image_url: string | null;
    unknown_command_reply: string | null;
    first_inbound_ack_enabled: boolean;
    first_inbound_ack_body: string | null;
  }>,
  updatedBy?: string | null,
): Promise<TelegramSettings> {
  const supabase = db();
  if (!supabase) return getSettings();
  await ensureDefaultSettings();
  const ts = nowIso();
  const row: Record<string, unknown> = {
    id: "default",
    updated_at: ts,
    updated_by: updatedBy || null,
  };
  if (patch.bot_username !== undefined) {
    row.bot_username = patch.bot_username ? String(patch.bot_username).replace(/^@/, "") : null;
  }
  if (patch.welcome_body !== undefined) row.welcome_body = patch.welcome_body;
  if (patch.welcome_buttons !== undefined) row.welcome_buttons = patch.welcome_buttons;
  if (patch.welcome_image_url !== undefined) row.welcome_image_url = patch.welcome_image_url;
  if (patch.unknown_command_reply !== undefined) row.unknown_command_reply = patch.unknown_command_reply;
  if (patch.first_inbound_ack_enabled !== undefined) {
    row.first_inbound_ack_enabled = !!patch.first_inbound_ack_enabled;
  }
  if (patch.first_inbound_ack_body !== undefined) row.first_inbound_ack_body = patch.first_inbound_ack_body;
  const { data, error } = await supabase
    .from("telegram_settings")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error) {
    tgLog("settings_update_failed", { error: error.message }, "error");
    return getSettings();
  }
  return mapSettings(data as Record<string, unknown>);
}

export async function markFirstInboundAckSent(chatId: string | number): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase
      .from("telegram_subscribers")
      .update({ first_inbound_ack_sent_at: nowIso(), updated_at: nowIso() })
      .eq("chat_id", String(chatId));
  } catch (e) {
    tgLog("ack_mark_failed", { error: (e as Error).message }, "warn");
  }
}

export async function recordWebhookEvent(opts: {
  updateId?: number | null;
  kind: string;
  chatId?: string | null;
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase.from("telegram_webhook_events").insert({
      update_id: opts.updateId ?? null,
      kind: opts.kind,
      chat_id: opts.chatId || null,
      ok: opts.ok,
      error: opts.error || null,
    });
  } catch (e) {
    tgLog("webhook_event_insert_failed", { error: (e as Error).message }, "warn");
  }
}

export async function touchInteraction(chatId: string | number): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  const ts = nowIso();
  try {
    await supabase
      .from("telegram_subscribers")
      .update({ last_interaction_at: ts, updated_at: ts })
      .eq("chat_id", String(chatId));
  } catch {
    /* ignore */
  }
}
