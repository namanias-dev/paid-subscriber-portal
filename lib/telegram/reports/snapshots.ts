/**
 * Persist digest metric snapshots so period-over-period deltas are real.
 */
import { getSupabaseAdmin } from "../../supabase";

export type SnapshotMetrics = Record<string, number | string | null | undefined>;

export interface ReportSnapshot {
  id: string;
  slot_key: string;
  kind: string;
  metrics: SnapshotMetrics;
  message_html: string | null;
  created_at: string;
}

function db() {
  return getSupabaseAdmin();
}

export async function getSnapshotBySlot(slotKey: string): Promise<ReportSnapshot | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("telegram_report_snapshots")
    .select("*")
    .eq("slot_key", slotKey)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    slot_key: String(row.slot_key),
    kind: String(row.kind || "digest"),
    metrics: (row.metrics as SnapshotMetrics) || {},
    message_html: row.message_html != null ? String(row.message_html) : null,
    created_at: String(row.created_at),
  };
}

export async function getPreviousSnapshot(beforeIso?: string): Promise<ReportSnapshot | null> {
  const supabase = db();
  if (!supabase) return null;
  let q = supabase
    .from("telegram_report_snapshots")
    .select("*")
    .in("kind", ["digest", "daily_summary"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (beforeIso) q = q.lt("created_at", beforeIso);
  const { data } = await q;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    slot_key: String(row.slot_key),
    kind: String(row.kind || "digest"),
    metrics: (row.metrics as SnapshotMetrics) || {},
    message_html: row.message_html != null ? String(row.message_html) : null,
    created_at: String(row.created_at),
  };
}

export async function saveSnapshot(opts: {
  slotKey: string;
  kind?: string;
  metrics: SnapshotMetrics;
  messageHtml?: string | null;
}): Promise<boolean> {
  const supabase = db();
  if (!supabase) return false;
  const { error } = await supabase.from("telegram_report_snapshots").upsert(
    {
      slot_key: opts.slotKey,
      kind: opts.kind || "digest",
      metrics: opts.metrics,
      message_html: opts.messageHtml || null,
    },
    { onConflict: "slot_key" },
  );
  return !error;
}

export function num(m: SnapshotMetrics | null | undefined, key: string): number | null {
  if (!m) return null;
  const v = m[key];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
