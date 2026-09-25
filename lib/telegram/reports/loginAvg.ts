/**
 * Login averages for Telegram digests.
 *
 * Same person as unique logins in the student section: phone-first key,
 * staff and leads excluded, analytics login events plus access-log logins.
 * Multiple sign-ins by one student on one day count once.
 *
 * 30-day and 90-day averages = mean unique students over the last 30 or 90
 * complete IST days. A day with no logins counts as zero. Today is excluded.
 *
 * Tracked-day average is still stored for history. The brief shows the 90-day
 * average instead of that tracked-day figure.
 *
 * Stored under login_avg_stats_v2 so the previous buyer-id counter is not
 * incremented into the new sum.
 */
import { getSupabaseAdmin } from "../../supabase";
import { istYMD, istTodayYMD, istYMDToMs } from "../../dates";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "../../leaderboardExclusions";
import { loadActivityExclusions } from "../../analytics/loadBusinessMetrics";
import {
  emptyLoginExclusion,
  meanDailyUniques,
  uniqueLoginsByDay,
  type LoginExclusion,
  type LoginHit,
} from "../../analytics/loginIdentity";
import { DAY_MS } from "../../analytics/businessMetrics";
import { getSnapshotBySlot, saveSnapshot } from "./snapshots";
import { tgLog } from "../log";

const SLOT = "login_avg_stats_v2";
const KIND = "login_avg";
const DEFINITION = "v2_phone_staff_access";

export interface LoginAvgStats {
  unique_sum: number;
  active_days: number;
  first_active_ymd: string | null;
  last_applied_ymd: string | null;
  definition: string;
}

export interface LoginAvgResult {
  allTimeAvg: number | null;
  rolling30Avg: number | null;
  rolling90Avg: number | null;
  today: number | null;
  yesterday: number | null;
  activeDays: number;
  uniqueSum: number;
  firstActiveYmd: string | null;
  method: "tracked_days";
}

function ymdPlus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function ymdDaysAgoFrom(today: string, ago: number): string {
  return ymdPlus(today, -ago);
}

async function exclusion(): Promise<LoginExclusion> {
  try {
    const loaded = await loadActivityExclusions();
    return {
      phones: loaded.phones,
      buyerIds: loaded.buyerIds,
      studentIds: new Set([...LEADERBOARD_EXCLUDED_STUDENT_IDS, ...loaded.studentIds]),
    };
  } catch {
    return emptyLoginExclusion();
  }
}

async function pageHits(
  fromIso: string | null,
  toIso: string | null,
): Promise<LoginHit[] | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const hits: LoginHit[] = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    let q = db
      .from("analytics_events")
      .select("buyer_id,phone,props,occurred_at")
      .eq("event_name", "login")
      .order("occurred_at", { ascending: true })
      .range(offset, offset + page - 1);
    if (fromIso) q = q.gte("occurred_at", fromIso);
    if (toIso) q = q.lt("occurred_at", toIso);
    const { data, error } = await q;
    if (error) {
      tgLog("login_avg_events_failed", { error: error.message }, "warn");
      return null;
    }
    const rows = data || [];
    if (!rows.length) break;
    for (const row of rows as {
      buyer_id?: string | null;
      phone?: string | null;
      props?: { student_id?: string | null } | null;
      occurred_at?: string;
    }[]) {
      if (!row.occurred_at) continue;
      hits.push({
        at: row.occurred_at,
        phone: row.phone,
        buyerId: row.buyer_id,
        studentId: row.props?.student_id || null,
      });
    }
    if (rows.length < page) break;
    offset += page;
  }

  offset = 0;
  const access: { student_id: string | null; timestamp: string }[] = [];
  for (;;) {
    let q = db
      .from("access_logs")
      .select("student_id,timestamp")
      .eq("action", "login")
      .order("timestamp", { ascending: true })
      .range(offset, offset + page - 1);
    if (fromIso) q = q.gte("timestamp", fromIso);
    if (toIso) q = q.lt("timestamp", toIso);
    const { data, error } = await q;
    if (error) {
      tgLog("login_avg_access_failed", { error: error.message }, "warn");
      break;
    }
    const rows = (data || []) as { student_id: string | null; timestamp: string }[];
    if (!rows.length) break;
    access.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }

  const ids = [...new Set(access.map((r) => r.student_id).filter(Boolean))] as string[];
  const phones = new Map<string, string | null>();
  if (ids.length) {
    const { data, error } = await db.from("students").select("id,phone").in("id", ids.slice(0, 500));
    if (error) {
      tgLog("login_avg_student_phone_failed", { error: error.message }, "warn");
    } else {
      for (const row of (data || []) as { id: string; phone: string | null }[]) phones.set(row.id, row.phone);
    }
  }
  for (const row of access) {
    if (!row.timestamp || !row.student_id) continue;
    hits.push({
      at: row.timestamp,
      phone: phones.get(row.student_id) || null,
      studentId: row.student_id,
    });
  }
  return hits;
}

function bounds(ymd: string): { fromIso: string; toIso: string } {
  const fromMs = istYMDToMs(ymd);
  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(fromMs + DAY_MS).toISOString(),
  };
}

async function loadStored(): Promise<LoginAvgStats | null> {
  const snap = await getSnapshotBySlot(SLOT);
  if (!snap?.metrics) return null;
  const m = snap.metrics;
  if (m.definition !== DEFINITION) return null;
  return {
    unique_sum: Number(m.unique_sum) || 0,
    active_days: Number(m.active_days) || 0,
    first_active_ymd: m.first_active_ymd != null ? String(m.first_active_ymd) : null,
    last_applied_ymd: m.last_applied_ymd != null ? String(m.last_applied_ymd) : null,
    definition: DEFINITION,
  };
}

async function saveStored(stats: LoginAvgStats): Promise<void> {
  await saveSnapshot({
    slotKey: SLOT,
    kind: KIND,
    metrics: {
      unique_sum: stats.unique_sum,
      active_days: stats.active_days,
      first_active_ymd: stats.first_active_ymd,
      last_applied_ymd: stats.last_applied_ymd,
      definition: DEFINITION,
    },
  });
}

function statsFromHits(hits: LoginHit[], excluded: LoginExclusion, today: string): LoginAvgStats {
  const byDay = uniqueLoginsByDay(hits, excluded);
  const yesterday = ymdDaysAgoFrom(today, 1);
  const ymds = [...byDay.keys()].filter((y) => y <= yesterday).sort();
  let uniqueSum = 0;
  let activeDays = 0;
  let first: string | null = null;
  for (const y of ymds) {
    const n = byDay.get(y)!.size;
    if (n > 0) {
      uniqueSum += n;
      activeDays += 1;
      if (!first) first = y;
    }
  }
  return {
    unique_sum: uniqueSum,
    active_days: activeDays,
    first_active_ymd: first,
    last_applied_ymd: yesterday,
    definition: DEFINITION,
  };
}

export async function backfillLoginAvgStats(): Promise<LoginAvgStats> {
  const empty: LoginAvgStats = {
    unique_sum: 0,
    active_days: 0,
    first_active_ymd: null,
    last_applied_ymd: null,
    definition: DEFINITION,
  };
  const [hits, excluded] = await Promise.all([pageHits(null, null), exclusion()]);
  if (!hits) return empty;
  const today = istTodayYMD();
  const stats = statsFromHits(hits, excluded, today);
  await saveStored(stats);
  tgLog("login_avg_backfill_done", {
    definition: DEFINITION,
    active_days: stats.active_days,
    unique_sum: stats.unique_sum,
    first: stats.first_active_ymd,
    last: stats.last_applied_ymd,
  });
  return stats;
}

export async function resolveLoginAverages(): Promise<LoginAvgResult> {
  const excluded = await exclusion();
  const today = istTodayYMD();
  const yesterday = ymdDaysAgoFrom(today, 1);
  let stored = await loadStored();
  const needsHistory = !stored || stored.definition !== DEFINITION || stored.last_applied_ymd !== yesterday;
  const hits = needsHistory
    ? await pageHits(null, null)
    : await pageHits(bounds(ymdDaysAgoFrom(today, 90)).fromIso, bounds(ymdPlus(today, 1)).fromIso);

  if (needsHistory && hits) {
    stored = statsFromHits(hits, excluded, today);
    await saveStored(stored);
  }
  const stats = stored || {
    unique_sum: 0,
    active_days: 0,
    first_active_ymd: null,
    last_applied_ymd: null,
    definition: DEFINITION,
  };

  const byDay = hits ? uniqueLoginsByDay(hits, excluded) : null;
  const rolling30: number[] = [];
  const rolling90: number[] = [];
  for (let i = 90; i >= 1; i--) {
    const n = byDay?.get(ymdDaysAgoFrom(today, i))?.size || 0;
    rolling90.push(n);
    if (i <= 30) rolling30.push(n);
  }

  return {
    allTimeAvg: stats.active_days > 0 ? Math.round(stats.unique_sum / stats.active_days) : null,
    rolling30Avg: byDay ? meanDailyUniques(rolling30) : null,
    rolling90Avg: byDay ? meanDailyUniques(rolling90) : null,
    today: byDay ? byDay.get(today)?.size || 0 : null,
    yesterday: byDay ? byDay.get(yesterday)?.size || 0 : null,
    activeDays: stats.active_days,
    uniqueSum: stats.unique_sum,
    firstActiveYmd: stats.first_active_ymd,
    method: "tracked_days",
  };
}
