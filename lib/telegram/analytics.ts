import { PHONE_AUDIENCES, type PhoneAudienceId } from "../adminPhoneAudiences";
import { getSupabaseAdmin } from "../supabase";
import { resolveTelegramAudience } from "./audiences";
import { botConfigured } from "./config";

function db() {
  return getSupabaseAdmin();
}

async function countWhere(
  table: string,
  filters: Record<string, string | boolean | number> = {},
  gte?: { col: string; val: string },
): Promise<number> {
  const supabase = db();
  if (!supabase) return 0;
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  if (gte) q = q.gte(gte.col, gte.val);
  const { count } = await q;
  return count ?? 0;
}

export async function getOverview(): Promise<{
  botConfigured: boolean;
  subscribersActive: number;
  subscribersTotal: number;
  growth30d: number;
  unreadInbound: number;
  queue: Record<string, number>;
}> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [subscribersActive, subscribersTotal, growth30d, unreadInbound] = await Promise.all([
    countWhere("telegram_subscribers", { is_active: true }),
    countWhere("telegram_subscribers"),
    countWhere("telegram_subscribers", {}, { col: "subscribed_at", val: since }),
    countWhere("telegram_messages", { direction: "inbound", is_read: false }),
  ]);

  const statuses = ["queued", "sent", "failed", "blocked", "skipped", "paused"] as const;
  const queue: Record<string, number> = {};
  await Promise.all(
    statuses.map(async (s) => {
      queue[s] = await countWhere("telegram_send_queue", { status: s });
    }),
  );

  return {
    botConfigured: botConfigured(),
    subscribersActive,
    subscribersTotal,
    growth30d,
    unreadInbound,
    queue,
  };
}

async function groupQueueBy(
  col: "automation_id" | "broadcast_id",
): Promise<Record<string, { sent: number; failed: number; blocked: number; skipped: number }>> {
  const supabase = db();
  const out: Record<string, { sent: number; failed: number; blocked: number; skipped: number }> = {};
  if (!supabase) return out;

  // Cheap sample: last 2k queue rows with that foreign key set.
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
  overview: Awaited<ReturnType<typeof getOverview>>;
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
