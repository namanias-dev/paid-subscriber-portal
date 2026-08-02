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

function dayKey(iso: string): string {
  return String(iso || "").slice(0, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

export interface FullAnalytics {
  outbound: {
    today: number;
    d7: number;
    d30: number;
    bySource: { broadcast: number; automation: number };
    failed: number;
    blocked: number;
    skipped: number;
  };
  inbound: {
    perDay: { day: string; count: number }[];
    uniqueRepliers7d: number;
    avgFirstResponseMinutes: number | null;
    unanswered: number;
  };
  subscribers: {
    total: number;
    active: number;
    blocked: number;
    growth: { day: string; joins: number }[];
    bySource: { source: string; count: number }[];
  };
  reachability: {
    totalLeads: number;
    withChat: number;
    percent: number;
    byAudience: {
      id: string;
      label: string;
      audienceSize: number;
      reachable: number;
      percent: number;
    }[];
  };
  broadcasts: {
    id: string;
    name: string | null;
    sent: number;
    failed: number;
    blocked: number;
    skipped: number;
    created_at: string;
  }[];
}

/** Structured analytics for the composer / analytics UI. Uses DB aggregates only. */
export async function getFullAnalytics(): Promise<FullAnalytics> {
  const supabase = db();
  const empty: FullAnalytics = {
    outbound: {
      today: 0,
      d7: 0,
      d30: 0,
      bySource: { broadcast: 0, automation: 0 },
      failed: 0,
      blocked: 0,
      skipped: 0,
    },
    inbound: { perDay: [], uniqueRepliers7d: 0, avgFirstResponseMinutes: null, unanswered: 0 },
    subscribers: { total: 0, active: 0, blocked: 0, growth: [], bySource: [] },
    reachability: { totalLeads: 0, withChat: 0, percent: 0, byAudience: [] },
    broadcasts: [],
  };
  if (!supabase) return empty;

  const today = startOfUtcDayIso();
  const since7d = daysAgoIso(7);
  const since30d = daysAgoIso(30);

  const [
    sentToday,
    sent7,
    sent30,
    failed30,
    blocked30,
    skipped30,
    broadcastSent,
    automationSent,
    totalSubs,
    activeSubs,
    blockedSubs,
    totalLeads,
    withChat,
  ] = await Promise.all([
    countWhere("telegram_send_queue", { status: "sent" }, { col: "sent_at", val: today }),
    countWhere("telegram_send_queue", { status: "sent" }, { col: "sent_at", val: since7d }),
    countWhere("telegram_send_queue", { status: "sent" }, { col: "sent_at", val: since30d }),
    countWhere("telegram_send_queue", { status: "failed" }, { col: "created_at", val: since30d }),
    countWhere("telegram_send_queue", { status: "blocked" }, { col: "created_at", val: since30d }),
    countWhere("telegram_send_queue", { status: "skipped" }, { col: "created_at", val: since30d }),
    countSentBySource("broadcast_id", since30d),
    countSentBySource("automation_id", since30d),
    countWhere("telegram_subscribers"),
    countWhere("telegram_subscribers", { is_active: true }),
    countWhere("telegram_subscribers", { is_active: false }),
    countWhere("leads"),
    countLeadsWithTelegram(),
  ]);

  const [inboundRows, joinRows, sourceRows, broadcastRows, unanswered] = await Promise.all([
    supabase
      .from("telegram_messages")
      .select("created_at, chat_id")
      .eq("direction", "inbound")
      .gte("created_at", since30d)
      .limit(20000),
    supabase
      .from("telegram_subscribers")
      .select("subscribed_at")
      .gte("subscribed_at", since30d)
      .limit(20000),
    supabase.from("telegram_subscribers").select("source").limit(20000),
    supabase
      .from("telegram_broadcasts")
      .select("id, name, sent_count, failed_count, blocked_count, skipped_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    countWhere("telegram_messages", { direction: "inbound", is_read: false }),
  ]);

  // Inbound per day (last 30d)
  const inboundByDay = new Map<string, number>();
  const repliers7d = new Set<string>();
  for (const r of inboundRows.data || []) {
    const day = dayKey(String((r as { created_at: string }).created_at));
    inboundByDay.set(day, (inboundByDay.get(day) || 0) + 1);
    const at = String((r as { created_at: string }).created_at);
    if (at >= since7d) {
      repliers7d.add(String((r as { chat_id: string }).chat_id));
    }
  }
  const perDay = [...inboundByDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // Avg first response: sample recent inbound chats and find first outbound after.
  const avgFirstResponseMinutes = await avgFirstResponseMinutesCalc(since7d);

  // Subscriber growth
  const growthMap = new Map<string, number>();
  for (const r of joinRows.data || []) {
    const day = dayKey(String((r as { subscribed_at: string }).subscribed_at));
    growthMap.set(day, (growthMap.get(day) || 0) + 1);
  }
  const growth = [...growthMap.entries()]
    .map(([day, joins]) => ({ day, joins }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const sourceMap = new Map<string, number>();
  for (const r of sourceRows.data || []) {
    const src = String((r as { source?: string | null }).source || "unknown");
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
  }
  const bySource = [...sourceMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const toMs = Date.now();
  const fromMs = toMs - 30 * 24 * 3600 * 1000;
  const byAudience = await Promise.all(
    PHONE_AUDIENCES.map(async (a) => {
      try {
        const r = await resolveTelegramAudience(a.id, fromMs, toMs);
        const percent =
          r.audienceSize > 0 ? Math.round((r.reachable.length / r.audienceSize) * 1000) / 10 : 0;
        return {
          id: a.id,
          label: a.label,
          audienceSize: r.audienceSize,
          reachable: r.reachable.length,
          percent,
        };
      } catch {
        return { id: a.id, label: a.label, audienceSize: 0, reachable: 0, percent: 0 };
      }
    }),
  );

  const percent = totalLeads > 0 ? Math.round((withChat / totalLeads) * 1000) / 10 : 0;

  return {
    outbound: {
      today: sentToday,
      d7: sent7,
      d30: sent30,
      bySource: { broadcast: broadcastSent, automation: automationSent },
      failed: failed30,
      blocked: blocked30,
      skipped: skipped30,
    },
    inbound: {
      perDay,
      uniqueRepliers7d: repliers7d.size,
      avgFirstResponseMinutes,
      unanswered,
    },
    subscribers: {
      total: totalSubs,
      active: activeSubs,
      blocked: blockedSubs,
      growth,
      bySource,
    },
    reachability: {
      totalLeads,
      withChat,
      percent,
      byAudience,
    },
    broadcasts: (broadcastRows.data || []).map((b) => ({
      id: String((b as { id: string }).id),
      name: (b as { name?: string | null }).name ?? null,
      sent: Number((b as { sent_count?: number }).sent_count || 0),
      failed: Number((b as { failed_count?: number }).failed_count || 0),
      blocked: Number((b as { blocked_count?: number }).blocked_count || 0),
      skipped: Number((b as { skipped_count?: number }).skipped_count || 0),
      created_at: String((b as { created_at: string }).created_at),
    })),
  };
}

async function countSentBySource(
  col: "broadcast_id" | "automation_id",
  since: string,
): Promise<number> {
  const supabase = db();
  if (!supabase) return 0;
  const { count } = await supabase
    .from("telegram_send_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .not(col, "is", null)
    .gte("sent_at", since);
  return count ?? 0;
}

async function avgFirstResponseMinutesCalc(since: string): Promise<number | null> {
  const supabase = db();
  if (!supabase) return null;
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    supabase
      .from("telegram_messages")
      .select("chat_id, created_at")
      .eq("direction", "inbound")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase
      .from("telegram_messages")
      .select("chat_id, created_at")
      .eq("direction", "outbound")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);
  if (!inbound?.length) return null;

  const firstIn = new Map<string, number>();
  for (const r of inbound) {
    const chat = String((r as { chat_id: string }).chat_id);
    const t = new Date(String((r as { created_at: string }).created_at)).getTime();
    if (!firstIn.has(chat)) firstIn.set(chat, t);
  }

  const firstOutAfter = new Map<string, number>();
  for (const r of outbound || []) {
    const chat = String((r as { chat_id: string }).chat_id);
    const t = new Date(String((r as { created_at: string }).created_at)).getTime();
    const inAt = firstIn.get(chat);
    if (inAt == null || t <= inAt) continue;
    if (!firstOutAfter.has(chat)) firstOutAfter.set(chat, t);
  }

  const diffs: number[] = [];
  for (const [chat, outAt] of firstOutAfter) {
    const inAt = firstIn.get(chat)!;
    const mins = (outAt - inAt) / 60000;
    if (mins >= 0 && mins < 7 * 24 * 60) diffs.push(mins);
  }
  if (!diffs.length) return null;
  return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
}

