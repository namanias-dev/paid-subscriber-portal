/**
 * Login averages for Telegram digests.
 *
 * Definition of a "login" for averages (matches Overview pulse `loginUsersToday`):
 * unique user per IST calendar day, keyed by buyer_id or normalized phone.
 * Multiple login events by the same user on the same day count as one.
 *
 * All-time avg = sum(unique users on each ACTIVE day) / count(active days),
 * where an active day has ≥1 login. Pre-launch zero days are excluded.
 *
 * 30-day avg = mean of unique-user counts over the last 30 IST calendar days
 * (zeros included — a dead day pulls the average down on purpose).
 *
 * All-time aggregates are backfilled once into telegram_report_snapshots and
 * updated incrementally per completed IST day. Idempotent.
 */
import { getSupabaseAdmin } from "../../supabase";
import { istYMD, istTodayYMD } from "../../dates";
import { normalizeIndianMobile } from "../../phone";
import { getSnapshotBySlot, saveSnapshot } from "./snapshots";
import { tgLog } from "../log";

const SLOT = "login_avg_stats";
const KIND = "login_avg";

export interface LoginAvgStats {
  /** Sum of per-active-day unique login users (all-time). */
  unique_sum: number;
  /** Number of IST days with ≥1 login. */
  active_days: number;
  first_active_ymd: string | null;
  /** Last IST day whose unique count has been folded into unique_sum. */
  last_applied_ymd: string | null;
}

export interface LoginAvgResult {
  allTimeAvg: number | null;
  rolling30Avg: number | null;
  activeDays: number;
  uniqueSum: number;
  firstActiveYmd: string | null;
  method: "active_days";
}

function loginUserKey(row: { buyer_id?: string | null; phone?: string | null }): string | null {
  const bid = (row.buyer_id || "").trim();
  if (bid) return `b:${bid}`;
  const n = normalizeIndianMobile(row.phone);
  if (n.ok && n.e164) return `p:${n.e164}`;
  const raw = (row.phone || "").trim();
  return raw ? `p:${raw}` : null;
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

async function uniqueLoginsOnYmd(ymd: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  // Fetch login events for that IST day via UTC window pad (±1 day), filter in JS.
  const startPad = new Date(`${ymd}T00:00:00+05:30`);
  startPad.setUTCDate(startPad.getUTCDate() - 1);
  const endPad = new Date(`${ymd}T23:59:59.999+05:30`);
  endPad.setUTCDate(endPad.getUTCDate() + 1);
  const { data, error } = await db
    .from("analytics_events")
    .select("buyer_id,phone,occurred_at")
    .eq("event_name", "login")
    .gte("occurred_at", startPad.toISOString())
    .lte("occurred_at", endPad.toISOString())
    .limit(20000);
  if (error) {
    tgLog("login_avg_day_query_failed", { ymd, error: error.message }, "warn");
    return 0;
  }
  const set = new Set<string>();
  for (const row of data || []) {
    if (istYMD((row as { occurred_at?: string }).occurred_at) !== ymd) continue;
    const k = loginUserKey(row as { buyer_id?: string | null; phone?: string | null });
    if (k) set.add(k);
  }
  return set.size;
}

async function loadStored(): Promise<LoginAvgStats | null> {
  const snap = await getSnapshotBySlot(SLOT);
  if (!snap?.metrics) return null;
  const m = snap.metrics;
  return {
    unique_sum: Number(m.unique_sum) || 0,
    active_days: Number(m.active_days) || 0,
    first_active_ymd: m.first_active_ymd != null ? String(m.first_active_ymd) : null,
    last_applied_ymd: m.last_applied_ymd != null ? String(m.last_applied_ymd) : null,
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
    },
  });
}

/**
 * Full historical backfill over active days only. Idempotent — re-running
 * recomputes from events and overwrites the snapshot.
 */
export async function backfillLoginAvgStats(): Promise<LoginAvgStats> {
  const db = getSupabaseAdmin();
  const empty: LoginAvgStats = {
    unique_sum: 0,
    active_days: 0,
    first_active_ymd: null,
    last_applied_ymd: null,
  };
  if (!db) return empty;

  const byDay = new Map<string, Set<string>>();
  let offset = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db
      .from("analytics_events")
      .select("buyer_id,phone,occurred_at")
      .eq("event_name", "login")
      .order("occurred_at", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) {
      tgLog("login_avg_backfill_failed", { error: error.message }, "error");
      break;
    }
    const rows = data || [];
    if (!rows.length) break;
    for (const row of rows) {
      const ymd = istYMD((row as { occurred_at?: string }).occurred_at);
      if (!ymd) continue;
      const k = loginUserKey(row as { buyer_id?: string | null; phone?: string | null });
      if (!k) continue;
      let set = byDay.get(ymd);
      if (!set) {
        set = new Set();
        byDay.set(ymd, set);
      }
      set.add(k);
    }
    if (rows.length < page) break;
    offset += page;
  }

  const ymds = [...byDay.keys()].sort();
  let uniqueSum = 0;
  for (const y of ymds) uniqueSum += byDay.get(y)!.size;
  const today = istTodayYMD();
  // Apply through yesterday only — today is still open.
  const yesterday = ymdDaysAgoFrom(today, 1);
  const applied = ymds.filter((y) => y <= yesterday);
  let appliedSum = 0;
  for (const y of applied) appliedSum += byDay.get(y)!.size;

  const stats: LoginAvgStats = {
    unique_sum: appliedSum,
    active_days: applied.length,
    first_active_ymd: ymds[0] || null,
    last_applied_ymd: applied.length ? applied[applied.length - 1] : null,
  };
  await saveStored(stats);
  tgLog("login_avg_backfill_done", {
    active_days: stats.active_days,
    unique_sum: stats.unique_sum,
    first: stats.first_active_ymd,
    last: stats.last_applied_ymd,
    avg: stats.active_days ? Math.round(stats.unique_sum / stats.active_days) : null,
  });
  return stats;
}

/** Incrementally fold completed IST days since last_applied into the snapshot. */
async function catchUpLoginAvg(stats: LoginAvgStats): Promise<LoginAvgStats> {
  const today = istTodayYMD();
  const yesterday = ymdDaysAgoFrom(today, 1);
  let next = stats.last_applied_ymd
    ? ymdPlus(stats.last_applied_ymd, 1)
    : stats.first_active_ymd || yesterday;
  if (!stats.last_applied_ymd && !stats.first_active_ymd) {
    // Empty store — full backfill.
    return backfillLoginAvgStats();
  }

  let uniqueSum = stats.unique_sum;
  let activeDays = stats.active_days;
  let first = stats.first_active_ymd;
  let last = stats.last_applied_ymd;
  let guard = 0;
  while (next <= yesterday && guard < 400) {
    guard++;
    const n = await uniqueLoginsOnYmd(next);
    if (n > 0) {
      uniqueSum += n;
      activeDays += 1;
      if (!first || next < first) first = next;
    }
    last = next;
    next = ymdPlus(next, 1);
  }
  const updated: LoginAvgStats = {
    unique_sum: uniqueSum,
    active_days: activeDays,
    first_active_ymd: first,
    last_applied_ymd: last,
  };
  if (
    updated.unique_sum !== stats.unique_sum ||
    updated.active_days !== stats.active_days ||
    updated.last_applied_ymd !== stats.last_applied_ymd
  ) {
    await saveStored(updated);
  }
  return updated;
}

async function rolling30Avg(): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const today = istTodayYMD();
  const fromYmd = ymdDaysAgoFrom(today, 30);
  const startPad = new Date(`${fromYmd}T00:00:00+05:30`);
  startPad.setUTCDate(startPad.getUTCDate() - 1);
  const endPad = new Date(`${today}T00:00:00+05:30`);
  const { data, error } = await db
    .from("analytics_events")
    .select("buyer_id,phone,occurred_at")
    .eq("event_name", "login")
    .gte("occurred_at", startPad.toISOString())
    .lt("occurred_at", endPad.toISOString())
    .limit(50000);
  if (error) {
    tgLog("login_avg_30d_failed", { error: error.message }, "warn");
    return null;
  }
  const byDay = new Map<string, Set<string>>();
  for (let i = 1; i <= 30; i++) byDay.set(ymdDaysAgoFrom(today, i), new Set());
  for (const row of data || []) {
    const ymd = istYMD((row as { occurred_at?: string }).occurred_at);
    if (!ymd || !byDay.has(ymd)) continue;
    const k = loginUserKey(row as { buyer_id?: string | null; phone?: string | null });
    if (k) byDay.get(ymd)!.add(k);
  }
  let sum = 0;
  for (const set of byDay.values()) sum += set.size;
  return Math.round(sum / 30);
}

/**
 * Resolve login averages for the digest. Backfills on first run, then
 * incrementally catches up. Returns nulls when no data.
 */
export async function resolveLoginAverages(): Promise<LoginAvgResult> {
  let stored = await loadStored();
  if (!stored || stored.active_days <= 0) {
    stored = await backfillLoginAvgStats();
  } else {
    stored = await catchUpLoginAvg(stored);
  }

  const allTimeAvg =
    stored.active_days > 0 ? Math.round(stored.unique_sum / stored.active_days) : null;
  const rolling30 = await rolling30Avg();

  if (
    allTimeAvg != null &&
    rolling30 != null &&
    rolling30 > 0 &&
    allTimeAvg * 10 < rolling30
  ) {
    tgLog(
      "login_avg_sanity_fail",
      {
        allTimeAvg,
        rolling30,
        active_days: stored.active_days,
        unique_sum: stored.unique_sum,
        first: stored.first_active_ymd,
      },
      "error",
    );
    // Re-backfill once — denominator may be stale/corrupt.
    stored = await backfillLoginAvgStats();
  }

  const finalAll =
    stored.active_days > 0 ? Math.round(stored.unique_sum / stored.active_days) : null;

  return {
    allTimeAvg: finalAll,
    rolling30Avg: rolling30,
    activeDays: stored.active_days,
    uniqueSum: stored.unique_sum,
    firstActiveYmd: stored.first_active_ymd,
    method: "active_days",
  };
}
