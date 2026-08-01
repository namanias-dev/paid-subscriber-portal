import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
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
    linkedLeadId = payload.slice("lead_".length) || null;
    if (linkedLeadId) {
      const linked = await linkLead(linkedLeadId, chatId);
      if (linked) phone = linked.phone;
    }
  } else if (payload.startsWith("student_")) {
    linkedStudentId = payload.slice("student_".length) || null;
    if (linkedStudentId) {
      const linked = await linkStudent(linkedStudentId, chatId);
      if (linked) phone = linked.phone;
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
    if (error || !data) return null;
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
  if (error || !data) return null;
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

const DEFAULT_SETTINGS: TelegramSettings = {
  id: "default",
  bot_username: null,
  welcome_body: null,
  welcome_buttons: [],
  updated_at: nowIso(),
  updated_by: null,
};

export async function getSettings(): Promise<TelegramSettings> {
  const supabase = db();
  if (!supabase) return { ...DEFAULT_SETTINGS };
  const { data } = await supabase.from("telegram_settings").select("*").eq("id", "default").maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    id: "default",
    bot_username: data.bot_username != null ? String(data.bot_username).replace(/^@/, "") : null,
    welcome_body: data.welcome_body != null ? String(data.welcome_body) : null,
    welcome_buttons: asButtons(data.welcome_buttons),
    updated_at: String(data.updated_at || nowIso()),
    updated_by: data.updated_by != null ? String(data.updated_by) : null,
  };
}

export async function updateSettings(
  patch: Partial<{
    bot_username: string | null;
    welcome_body: string | null;
    welcome_buttons: TelegramButton[];
  }>,
  updatedBy?: string | null,
): Promise<TelegramSettings> {
  const supabase = db();
  if (!supabase) return getSettings();
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
  const { data, error } = await supabase
    .from("telegram_settings")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error || !data) return getSettings();
  return {
    id: "default",
    bot_username: data.bot_username != null ? String(data.bot_username).replace(/^@/, "") : null,
    welcome_body: data.welcome_body != null ? String(data.welcome_body) : null,
    welcome_buttons: asButtons(data.welcome_buttons),
    updated_at: String(data.updated_at || ts),
    updated_by: data.updated_by != null ? String(data.updated_by) : null,
  };
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
