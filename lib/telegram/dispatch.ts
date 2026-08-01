/**
 * Event-driven Telegram auto-dispatch. Never throws into callers.
 */
import { normalizeIndianMobile } from "../phone";
import { getSupabaseAdmin } from "../supabase";
import { enqueueSend, scheduleFollowUps } from "./queue";
import { renderTelegramBody } from "./render";
import {
  findActiveByChatId,
  findActiveByLeadId,
  findActiveByPhone,
  findActiveByStudentId,
} from "./subscribers";
import type { FollowUpStep, TelegramAutomation, TelegramButton, TelegramSubscriber } from "./types";

export interface AutoTelegramCtx {
  trigger: string;
  phone?: string | null;
  name?: string | null;
  vars?: Record<string, string | number | null | undefined>;
  leadId?: string | null;
  studentId?: string | null;
  entityId?: string | null;
  chatId?: string | null;
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
    schedule_mode: (row.schedule_mode as TelegramAutomation["schedule_mode"]) || "on_trigger",
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

async function resolveSubscriber(ctx: AutoTelegramCtx): Promise<TelegramSubscriber | null> {
  if (ctx.chatId) {
    const byChat = await findActiveByChatId(ctx.chatId);
    if (byChat) return byChat;
  }
  if (ctx.leadId) {
    const byLead = await findActiveByLeadId(ctx.leadId);
    if (byLead) return byLead;
  }
  if (ctx.studentId) {
    const byStudent = await findActiveByStudentId(ctx.studentId);
    if (byStudent) return byStudent;
  }
  if (ctx.phone) {
    const n = normalizeIndianMobile(ctx.phone);
    if (n.ok && n.digits10) {
      const byPhone = await findActiveByPhone(n.digits10);
      if (byPhone) return byPhone;
    }
  }
  return null;
}

async function enqueueForAutomation(
  auto: TelegramAutomation,
  sub: TelegramSubscriber,
  ctx: AutoTelegramCtx,
): Promise<void> {
  const vars: Record<string, string | number | null | undefined> = {
    ...(ctx.vars || {}),
    name: ctx.vars?.name ?? ctx.name ?? sub.first_name ?? null,
  };
  const body = renderTelegramBody(auto.message_body || "", vars);
  await enqueueSend({
    chat_id: sub.chat_id,
    subscriber_id: sub.id,
    body,
    image_url: auto.image_url,
    buttons: auto.buttons,
    automation_id: auto.id,
    metadata: {
      trigger: ctx.trigger,
      entityId: ctx.entityId || null,
      vars,
    },
  });
  if (auto.follow_ups?.length) {
    await scheduleFollowUps({
      chatId: sub.chat_id,
      subscriberId: sub.id,
      automationId: auto.id,
      followUps: auto.follow_ups,
      vars,
      baseBodyRender: (tpl) => renderTelegramBody(tpl, vars),
    });
  }
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      await supabase
        .from("telegram_automations")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", auto.id);
    } catch {
      /* ignore */
    }
  }
}

async function dispatch(ctx: AutoTelegramCtx): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !ctx.trigger) return;

  const { data } = await supabase
    .from("telegram_automations")
    .select("*")
    .eq("enabled", true)
    .eq("trigger", ctx.trigger)
    .in("schedule_mode", ["on_trigger", "send_now"]);

  const autos = ((data || []) as Record<string, unknown>[]).map(mapAuto);
  if (!autos.length) return;

  const sub = await resolveSubscriber(ctx);
  if (!sub) {
    // Record skip for observability when we have a phone but no telegram.
    if (ctx.phone) {
      const n = normalizeIndianMobile(ctx.phone);
      const phone = n.ok && n.digits10 ? n.digits10 : String(ctx.phone);
      for (const auto of autos) {
        await enqueueSend({
          chat_id: `skip:${phone}`,
          body: renderTelegramBody(auto.message_body || "", {
            ...(ctx.vars || {}),
            name: ctx.name || null,
          }),
          automation_id: auto.id,
          status: "skipped",
          skip_reason: "skipped_no_telegram",
          metadata: { trigger: ctx.trigger, phone },
        });
      }
    }
    return;
  }

  for (const auto of autos) {
    await enqueueForAutomation(auto, sub, ctx);
  }
}

/** Fire-and-forget — never throws. */
export function fireAutoTelegram(ctx: AutoTelegramCtx): void {
  void dispatch(ctx).catch(() => {});
}

async function dispatchForSubscriber(trigger: string, chatId: string): Promise<void> {
  const sub = await findActiveByChatId(chatId);
  if (!sub) return;
  await dispatch({
    trigger,
    chatId,
    name: sub.first_name,
    phone: sub.phone,
    leadId: sub.linked_lead_id,
    studentId: sub.linked_student_id,
  });
}

/** Fire subscriber_joined / subscriber_replied automations for a chat. */
export function fireTriggerForSubscriber(trigger: string, chatId: string | number): void {
  void dispatchForSubscriber(trigger, String(chatId)).catch(() => {});
}
