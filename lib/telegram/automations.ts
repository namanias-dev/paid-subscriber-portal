import { getSupabaseAdmin } from "../supabase";
import { resolveTelegramAudience } from "./audiences";
import { enqueueSend, scheduleFollowUps } from "./queue";
import { renderTelegramBody } from "./render";
import type { PhoneAudienceId } from "../adminPhoneAudiences";
import { resolvePhoneAudience } from "../adminPhoneAudiences";
import type {
  FollowUpStep,
  TelegramAutomation,
  TelegramButton,
  TelegramScheduleMode,
} from "./types";

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

function asFollowUps(raw: unknown): FollowUpStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = (s || {}) as Record<string, unknown>;
    return {
      delay_hours: Number(o.delay_hours) || 0,
      body: String(o.body || ""),
      image_url: o.image_url != null ? String(o.image_url) : null,
      buttons: asButtons(o.buttons),
      stop_if_replied: !!o.stop_if_replied,
      stop_if_converted: !!o.stop_if_converted,
    };
  });
}

function mapAuto(row: Record<string, unknown>): TelegramAutomation {
  return {
    id: String(row.id),
    name: String(row.name || ""),
    enabled: !!row.enabled,
    trigger: String(row.trigger || ""),
    audience_id: row.audience_id != null ? String(row.audience_id) : null,
    schedule_mode: (row.schedule_mode as TelegramScheduleMode) || "on_trigger",
    schedule_at: row.schedule_at != null ? String(row.schedule_at) : null,
    recurring_cron: row.recurring_cron != null ? String(row.recurring_cron) : null,
    message_body: String(row.message_body || ""),
    image_url: row.image_url != null ? String(row.image_url) : null,
    buttons: asButtons(row.buttons),
    template_id: row.template_id != null ? String(row.template_id) : null,
    follow_ups: asFollowUps(row.follow_ups),
    stop_on_reply: row.stop_on_reply !== false,
    stop_on_converted: !!row.stop_on_converted,
    created_by: row.created_by != null ? String(row.created_by) : null,
    updated_by: row.updated_by != null ? String(row.updated_by) : null,
    last_run_at: row.last_run_at != null ? String(row.last_run_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listAutomations(): Promise<TelegramAutomation[]> {
  const supabase = db();
  if (!supabase) return [];
  const { data } = await supabase
    .from("telegram_automations")
    .select("*")
    .order("created_at", { ascending: false });
  return ((data || []) as Record<string, unknown>[]).map(mapAuto);
}

export async function getAutomation(id: string): Promise<TelegramAutomation | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase.from("telegram_automations").select("*").eq("id", id).maybeSingle();
  return data ? mapAuto(data as Record<string, unknown>) : null;
}

export interface CreateAutomationInput {
  name: string;
  enabled?: boolean;
  trigger: string;
  audience_id?: string | null;
  schedule_mode?: TelegramScheduleMode;
  schedule_at?: string | null;
  recurring_cron?: string | null;
  message_body?: string;
  image_url?: string | null;
  buttons?: TelegramButton[];
  template_id?: string | null;
  follow_ups?: FollowUpStep[];
  stop_on_reply?: boolean;
  stop_on_converted?: boolean;
  created_by?: string | null;
}

export async function createAutomation(input: CreateAutomationInput): Promise<TelegramAutomation | null> {
  const supabase = db();
  if (!supabase) return null;
  const ts = nowIso();
  const row = {
    name: input.name,
    enabled: !!input.enabled,
    trigger: input.trigger,
    audience_id: input.audience_id || null,
    schedule_mode: input.schedule_mode || "on_trigger",
    schedule_at: input.schedule_at || null,
    recurring_cron: input.recurring_cron || null,
    message_body: input.message_body || "",
    image_url: input.image_url || null,
    buttons: input.buttons || [],
    template_id: input.template_id || null,
    follow_ups: input.follow_ups || [],
    stop_on_reply: input.stop_on_reply !== false,
    stop_on_converted: !!input.stop_on_converted,
    created_by: input.created_by || null,
    updated_by: input.created_by || null,
    created_at: ts,
    updated_at: ts,
  };
  const { data, error } = await supabase.from("telegram_automations").insert(row).select("*").single();
  if (error || !data) return null;
  return mapAuto(data as Record<string, unknown>);
}

export async function updateAutomation(
  id: string,
  patch: Partial<CreateAutomationInput> & { updated_by?: string | null },
): Promise<TelegramAutomation | null> {
  const supabase = db();
  if (!supabase) return null;
  const row: Record<string, unknown> = { updated_at: nowIso() };
  const keys: (keyof CreateAutomationInput)[] = [
    "name",
    "enabled",
    "trigger",
    "audience_id",
    "schedule_mode",
    "schedule_at",
    "recurring_cron",
    "message_body",
    "image_url",
    "buttons",
    "template_id",
    "follow_ups",
    "stop_on_reply",
    "stop_on_converted",
  ];
  for (const k of keys) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  if (patch.updated_by !== undefined) row.updated_by = patch.updated_by;
  if (patch.created_by !== undefined && row.updated_by === undefined) row.updated_by = patch.created_by;

  const { data, error } = await supabase
    .from("telegram_automations")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return null;
  return mapAuto(data as Record<string, unknown>);
}

export async function toggleAutomation(
  id: string,
  enabled: boolean,
  updatedBy?: string | null,
): Promise<TelegramAutomation | null> {
  return updateAutomation(id, { enabled, updated_by: updatedBy });
}

export async function deleteAutomation(id: string): Promise<boolean> {
  const supabase = db();
  if (!supabase) return false;
  const { error } = await supabase.from("telegram_automations").delete().eq("id", id);
  return !error;
}

async function enqueueAudienceAutomation(auto: TelegramAutomation): Promise<number> {
  if (!auto.audience_id) return 0;
  const toMs = Date.now();
  const fromMs = toMs - 30 * 24 * 3600 * 1000;
  const audienceId = auto.audience_id as PhoneAudienceId;
  const resolved = await resolveTelegramAudience(audienceId, fromMs, toMs);
  let n = 0;
  for (const r of resolved.reachable) {
    const vars = { name: r.name || null };
    const body = renderTelegramBody(auto.message_body || "", vars);
    await enqueueSend({
      chat_id: r.chat_id,
      subscriber_id: r.subscriber_id,
      body,
      image_url: auto.image_url,
      buttons: auto.buttons,
      automation_id: auto.id,
      metadata: { trigger: auto.trigger, scheduled: true },
    });
    if (auto.follow_ups?.length) {
      await scheduleFollowUps({
        chatId: r.chat_id,
        subscriberId: r.subscriber_id,
        automationId: auto.id,
        followUps: auto.follow_ups,
        vars,
        baseBodyRender: (tpl) => renderTelegramBody(tpl, vars),
      });
    }
    n++;
  }
  const people = await resolvePhoneAudience(audienceId, fromMs, toMs);
  const reachablePhones = new Set(resolved.reachable.map((r) => r.phone).filter(Boolean) as string[]);
  for (const p of people) {
    if (reachablePhones.has(p.phone)) continue;
    await enqueueSend({
      chat_id: `skip:${p.phone}`,
      body: auto.message_body || "",
      automation_id: auto.id,
      status: "skipped",
      skip_reason: "skipped_no_telegram",
      metadata: { phone: p.phone },
    });
  }
  return n;
}

export async function runManualAutomation(id: string): Promise<{ ok: boolean; enqueued: number; error?: string }> {
  const auto = await getAutomation(id);
  if (!auto) return { ok: false, enqueued: 0, error: "not_found" };
  const enqueued = await enqueueAudienceAutomation(auto);
  const supabase = db();
  if (supabase) {
    await supabase.from("telegram_automations").update({ last_run_at: nowIso() }).eq("id", id);
  }
  return { ok: true, enqueued };
}

/**
 * Process datetime one-shots and simple daily recurring (recurring_cron like "daily HH:MM"
 * or bare "daily"). Idempotent via last_run_at day key.
 */
export async function processDueScheduledAutomations(): Promise<{ ran: number }> {
  const supabase = db();
  if (!supabase) return { ran: 0 };
  const now = new Date();
  const nowIsoStr = now.toISOString();
  let ran = 0;

  const { data } = await supabase
    .from("telegram_automations")
    .select("*")
    .eq("enabled", true)
    .in("schedule_mode", ["datetime", "recurring", "send_now"]);

  for (const raw of (data || []) as Record<string, unknown>[]) {
    const auto = mapAuto(raw);
    try {
      if (auto.schedule_mode === "datetime") {
        if (!auto.schedule_at) continue;
        if (new Date(auto.schedule_at).getTime() > now.getTime()) continue;
        if (auto.last_run_at && new Date(auto.last_run_at).getTime() >= new Date(auto.schedule_at).getTime()) {
          continue;
        }
        await enqueueAudienceAutomation(auto);
        await supabase.from("telegram_automations").update({ last_run_at: nowIsoStr }).eq("id", auto.id);
        ran++;
      } else if (auto.schedule_mode === "recurring") {
        // Simple daily: recurring_cron = "daily" or "daily:HH:MM" (IST-ish wall clock ignored; fire once/day).
        const cron = (auto.recurring_cron || "daily").toLowerCase();
        if (!cron.startsWith("daily")) continue;
        const todayKey = nowIsoStr.slice(0, 10);
        if (auto.last_run_at && auto.last_run_at.slice(0, 10) === todayKey) continue;
        // Optional HH:MM gate
        const m = cron.match(/daily(?::|\s+)(\d{1,2}):(\d{2})/);
        if (m) {
          const h = Number(m[1]);
          const min = Number(m[2]);
          if (now.getUTCHours() * 60 + now.getUTCMinutes() < h * 60 + min) continue;
        }
        await enqueueAudienceAutomation(auto);
        await supabase.from("telegram_automations").update({ last_run_at: nowIsoStr }).eq("id", auto.id);
        ran++;
      } else if (auto.schedule_mode === "send_now" && auto.enabled && !auto.last_run_at) {
        await enqueueAudienceAutomation(auto);
        await supabase.from("telegram_automations").update({ last_run_at: nowIsoStr }).eq("id", auto.id);
        ran++;
      }
    } catch {
      /* continue other automations */
    }
  }
  return { ran };
}
