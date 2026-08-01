import type { ActionActor } from "../adminGuard";
import { logAdminActivity } from "../adminActivity";
import { getSupabaseAdmin } from "../supabase";
import type { PhoneAudienceId } from "../adminPhoneAudiences";
import { resolvePhoneAudience } from "../adminPhoneAudiences";
import { resolveTelegramAudience } from "./audiences";
import { enqueueBroadcast } from "./queue";
import type { TelegramBroadcast, TelegramButton } from "./types";

function db() {
  return getSupabaseAdmin();
}

function asButtons(raw: unknown): TelegramButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || "").trim();
      const url = String(o.url || "").trim();
      if (!label || !url) return null;
      return { label, url };
    })
    .filter(Boolean) as TelegramButton[];
}

function mapBroadcast(row: Record<string, unknown>): TelegramBroadcast {
  return {
    id: String(row.id),
    name: row.name != null ? String(row.name) : null,
    audience_id: String(row.audience_id),
    message_body: String(row.message_body || ""),
    image_url: row.image_url != null ? String(row.image_url) : null,
    buttons: asButtons(row.buttons),
    status: (row.status as TelegramBroadcast["status"]) || "draft",
    scheduled_at: row.scheduled_at != null ? String(row.scheduled_at) : null,
    audience_size: Number(row.audience_size || 0),
    reachable_count: Number(row.reachable_count || 0),
    sent_count: Number(row.sent_count || 0),
    failed_count: Number(row.failed_count || 0),
    blocked_count: Number(row.blocked_count || 0),
    skipped_count: Number(row.skipped_count || 0),
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
  };
}

export async function listBroadcasts(limit = 50): Promise<TelegramBroadcast[]> {
  const supabase = db();
  if (!supabase) return [];
  const { data } = await supabase
    .from("telegram_broadcasts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  return ((data || []) as Record<string, unknown>[]).map(mapBroadcast);
}

export interface CreateBroadcastInput {
  audienceId: PhoneAudienceId | string;
  fromMs: number;
  toMs: number;
  body: string;
  image?: string | null;
  buttons?: TelegramButton[];
  name?: string | null;
  scheduledAt?: string | null;
  actor?: ActionActor | null;
}

export async function createAndEnqueueBroadcast(
  input: CreateBroadcastInput,
): Promise<{ ok: boolean; broadcast?: TelegramBroadcast; error?: string }> {
  const supabase = db();
  if (!supabase) return { ok: false, error: "db_unavailable" };
  if (!input.body?.trim()) return { ok: false, error: "body_required" };

  const audienceId = input.audienceId as PhoneAudienceId;
  const resolved = await resolveTelegramAudience(audienceId, input.fromMs, input.toMs);
  const people = await resolvePhoneAudience(audienceId, input.fromMs, input.toMs);
  const reachablePhones = new Set(
    resolved.reachable.map((r) => r.phone).filter(Boolean) as string[],
  );
  const skippedPhones = people.map((p) => p.phone).filter((p) => !reachablePhones.has(p));

  const scheduledAt = input.scheduledAt || null;
  const status = scheduledAt && new Date(scheduledAt).getTime() > Date.now() ? "queued" : "queued";

  const insert = {
    name: input.name || null,
    audience_id: audienceId,
    message_body: input.body,
    image_url: input.image || null,
    buttons: input.buttons || [],
    status,
    scheduled_at: scheduledAt,
    audience_size: resolved.audienceSize,
    reachable_count: resolved.reachable.length,
    skipped_count: skippedPhones.length,
    created_by: input.actor?.id || null,
  };

  const { data, error } = await supabase.from("telegram_broadcasts").insert(insert).select("*").single();
  if (error || !data) return { ok: false, error: error?.message || "insert_failed" };
  const broadcast = mapBroadcast(data as Record<string, unknown>);

  const { enqueued, skipped } = await enqueueBroadcast({
    broadcastId: broadcast.id,
    reachable: resolved.reachable,
    skippedPhones,
    body: input.body,
    image_url: input.image || null,
    buttons: input.buttons || [],
    scheduled_at: scheduledAt || new Date().toISOString(),
  });

  await supabase
    .from("telegram_broadcasts")
    .update({
      status: "sending",
      skipped_count: skipped,
      reachable_count: enqueued,
    })
    .eq("id", broadcast.id);

  void logAdminActivity({
    actor: input.actor,
    action: "telegram_broadcast_sent",
    entityType: "telegram_broadcast",
    entityId: broadcast.id,
    metadata: {
      audienceId,
      audienceSize: resolved.audienceSize,
      reachable: enqueued,
      skipped,
      scheduledAt,
    },
  });

  const { data: updated } = await supabase
    .from("telegram_broadcasts")
    .select("*")
    .eq("id", broadcast.id)
    .single();

  return { ok: true, broadcast: mapBroadcast((updated || data) as Record<string, unknown>) };
}
