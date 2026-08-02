import { PHONE_AUDIENCES, type PhoneAudienceId } from "../adminPhoneAudiences";
import { getSupabaseAdmin } from "../supabase";
import { resolveTelegramAudience } from "./audiences";
import { getTelegramLiveStatus } from "./status";

function db() {
  return getSupabaseAdmin();
}

async function countWhere(
  table: string,
  filters: Record<string, string | boolean | number> = {},
  gte?: { col: string; val: string },
  lt?: { col: string; val: string },
): Promise<number> {
  const supabase = db();
  if (!supabase) return 0;
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  if (gte) q = q.gte(gte.col, gte.val);
  if (lt) q = q.lt(lt.col, lt.val);
  const { count } = await q;
  return count ?? 0;
}

export interface OverviewPayload {
  bot: Awaited<ReturnType<typeof getTelegramLiveStatus>>["bot"];
  healthy: boolean;
  healthReason: string | null;
  online: boolean;
  webhookUrl: string | null;
  subscribersActive: number;
  subscribersTotal: number;
  subscribersInactive: number;
  joinedLast7d: number;
  sentToday: number;
  sentLast7d: number;
  failedLast7d: number;
  blockedLast7d: number;
  unreadInbound: number;
  queue: Record<string, number>;
  reachability: {
    totalLeads: number;
    leadsWithTelegram: number;
    percent: number;
  };
  recent: {
    joins: { chat_id: string; name: string | null; at: string; linked_lead_id: string | null }[];
    sends: { chat_id: string; body: string | null; at: string; status: string }[];
    inbound: { chat_id: string; body: string | null; at: string }[];
  };
  /** Aliases used by older UI bindings */
  activeSubscribers: number;
  totalSubscribers: number;
  queued: number;
  unread: number;
}

function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getOverview(): Promise<OverviewPayload> {
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const today = startOfUtcDayIso();
  const live = await getTelegramLiveStatus();

  const [
    subscribersActive,
    subscribersTotal,
    joinedLast7d,
    sentToday,
    sentLast7d,
    failedLast7d,
    blockedLast7d,
    unreadInbound,
    totalLeads,
    leadsWithTelegram,
  ] = await Promise.all([
    countWhere("telegram_subscribers", { is_active: true }),
    countWhere("telegram_subscribers"),
    countWhere("telegram_subscribers", {}, { col: "subscribed_at", val: since7d }),
    countWhere("telegram_send_queue", { status: "sent" }, { col: "sent_at", val: today }),
    countWhere("telegram_send_queue", { status: "sent" }, { col: "sent_at", val: since7d }),
    countWhere("telegram_send_queue", { status: "failed" }, { col: "created_at", val: since7d }),
    countWhere("telegram_send_queue", { status: "blocked" }, { col: "created_at", val: since7d }),
    countWhere("telegram_messages", { direction: "inbound", is_read: false }),
    countWhere("leads"),
    countLeadsWithTelegram(),
  ]);

  const statuses = ["queued", "sent", "failed", "blocked", "skipped", "paused"] as const;
  const queue: Record<string, number> = {};
  await Promise.all(
    statuses.map(async (s) => {
      queue[s] = await countWhere("telegram_send_queue", { status: s });
    }),
  );

  const recent = await loadRecentActivity();
  const percent =
    totalLeads > 0 ? Math.round((leadsWithTelegram / totalLeads) * 1000) / 10 : 0;

  return {
    bot: live.bot,
    healthy: live.healthy,
    healthReason: live.healthReason,
    online: live.online,
    webhookUrl: live.webhook.webhookUrl,
    subscribersActive,
    subscribersTotal,
    subscribersInactive: Math.max(0, subscribersTotal - subscribersActive),
    joinedLast7d,
    sentToday,
    sentLast7d,
    failedLast7d,
    blockedLast7d,
    unreadInbound,
    queue,
    reachability: { totalLeads, leadsWithTelegram, percent },
    recent,
    activeSubscribers: subscribersActive,
    totalSubscribers: subscribersTotal,
    queued: queue.queued || 0,
    unread: unreadInbound,
  };
}

async function countLeadsWithTelegram(): Promise<number> {
  const supabase = db();
  if (!supabase) return 0;
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("telegram_chat_id", "is", null);
  return count ?? 0;
}

async function loadRecentActivity(): Promise<OverviewPayload["recent"]> {
  const supabase = db();
  const empty = { joins: [], sends: [], inbound: [] };
  if (!supabase) return empty;

  const [joinsRes, sendsRes, inboundRes] = await Promise.all([
    supabase
      .from("telegram_subscribers")
      .select("chat_id, first_name, username, subscribed_at, linked_lead_id")
      .order("subscribed_at", { ascending: false })
      .limit(10),
    supabase
      .from("telegram_send_queue")
      .select("chat_id, body, sent_at, created_at, status")
      .in("status", ["sent", "failed", "blocked"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("telegram_messages")
      .select("chat_id, body, created_at")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    joins: (joinsRes.data || []).map((r) => ({
      chat_id: String(r.chat_id),
      name: (r.first_name as string) || (r.username as string) || null,
      at: String(r.subscribed_at),
      linked_lead_id: r.linked_lead_id != null ? String(r.linked_lead_id) : null,
    })),
    sends: (sendsRes.data || []).map((r) => ({
      chat_id: String(r.chat_id),
      body: r.body != null ? String(r.body).slice(0, 120) : null,
      at: String(r.sent_at || r.created_at),
      status: String(r.status),
    })),
    inbound: (inboundRes.data || []).map((r) => ({
      chat_id: String(r.chat_id),
      body: r.body != null ? String(r.body).slice(0, 120) : null,
      at: String(r.created_at),
    })),
  };
}

async function groupQueueBy(
  col: "automation_id" | "broadcast_id",
): Promise<Record<string, { sent: number; failed: number; blocked: number; skipped: number }>> {
  const supabase = db();
  const out: Record<string, { sent: number; failed: number; blocked: number; skipped: number }> = {};
  if (!supabase) return out;

  const { data } = await supabase
    .from("telegram_send_queue")
    .select(`${col}, status`)
    .not(col, "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  for (const row of data || []) {
    const id = String((row as Record<string, unknown>)[col] || "");
    if (!id) continue;
    if (!out[id]) out[id] = { sent: 0, failed: 0, blocked: 0, skipped: 0 };
    const st = String((row as { status?: string }).status || "");
    if (st === "sent") out[id]!.sent++;
    else if (st === "failed") out[id]!.failed++;
    else if (st === "blocked") out[id]!.blocked++;
    else if (st === "skipped") out[id]!.skipped++;
  }
  return out;
}

export async function getAnalytics(): Promise<{
  overview: OverviewPayload;
  byAutomation: Record<string, { sent: number; failed: number; blocked: number; skipped: number }>;
  byBroadcast: Record<string, { sent: number; failed: number; blocked: number; skipped: number }>;
  reachability: {
    id: PhoneAudienceId;
    label: string;
    audienceSize: number;
    reachable: number;
    skippedNoTelegram: number;
  }[];
}> {
  const overview = await getOverview();
  const [byAutomation, byBroadcast] = await Promise.all([
    groupQueueBy("automation_id"),
    groupQueueBy("broadcast_id"),
  ]);

  const toMs = Date.now();
  const fromMs = toMs - 30 * 24 * 3600 * 1000;
  const reachability = await Promise.all(
    PHONE_AUDIENCES.map(async (a) => {
      try {
        const r = await resolveTelegramAudience(a.id, fromMs, toMs);
        return {
          id: a.id,
          label: a.label,
          audienceSize: r.audienceSize,
          reachable: r.reachable.length,
          skippedNoTelegram: r.skippedNoTelegram,
        };
      } catch {
        return {
          id: a.id,
          label: a.label,
          audienceSize: 0,
          reachable: 0,
          skippedNoTelegram: 0,
        };
      }
    }),
  );

  return { overview, byAutomation, byBroadcast, reachability };
}
