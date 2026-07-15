/**
 * LIVE trigger filter sources. Returns, per captured event type + filter
 * dimension, the REAL values the backend knows about — distinct values actually
 * observed in `automation_events`, merged with the canonical registered set (so
 * known forms show even before their first event, and brand-new sources appear
 * automatically once they fire). Read-only; nothing here sends or executes.
 */
import { getSupabaseAdmin } from "../supabase";
import { LEAD_SOURCE_FORMS, leadSourceLabel } from "./leadSources";
import type { TriggerSourceOption, TriggerSources } from "./engine/triggerMatch";

export type { TriggerSourceOption, TriggerSources } from "./engine/triggerMatch";

const EVENT_SCAN_LIMIT = 3000;

interface EventRowLite { payload: Record<string, unknown> | null; webinar_id: string | null }

async function scanEvents(eventType: string): Promise<EventRowLite[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data } = await sb
    .from("automation_events")
    .select("payload, webinar_id")
    .eq("event_type", eventType)
    .order("occurred_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);
  return (data ?? []) as EventRowLite[];
}

function countBy(rows: EventRowLite[], get: (r: EventRowLite) => unknown): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = get(r);
    if (v == null || String(v).trim() === "") continue;
    const k = String(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Resolve id → title for a table, best-effort (empty map on any failure). */
async function titlesFor(table: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sb = getSupabaseAdmin();
  if (!sb || ids.length === 0) return out;
  try {
    const { data } = await sb.from(table).select("id, title").in("id", ids.slice(0, 200));
    for (const r of (data ?? []) as { id: string; title: string | null }[]) {
      if (r.title) out.set(String(r.id), r.title);
    }
  } catch { /* best-effort */ }
  return out;
}

function toOptions(counts: Map<string, number>, label: (v: string) => string): TriggerSourceOption[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Merge registered defaults (count 0 if unseen) with observed counts. */
function mergeRegistered(
  observed: Map<string, number>,
  registered: { value: string; label: string }[],
): TriggerSourceOption[] {
  const map = new Map<string, TriggerSourceOption>();
  for (const r of registered) map.set(r.value, { value: r.value, label: r.label, count: observed.get(r.value) ?? 0 });
  for (const [value, count] of observed) {
    if (map.has(value)) { map.get(value)!.count = count; continue; }
    map.set(value, { value, label: leadSourceLabel(value), count });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function listTriggerSources(): Promise<TriggerSources> {
  const [leadRows, payRows, instRows, webRows] = await Promise.all([
    scanEvents("lead_created"),
    scanEvents("payment_received"),
    scanEvents("installment_overdue"),
    scanEvents("webinar_registered"),
  ]);

  // lead_created → source_form (registered set + observed)
  const sourceForm = mergeRegistered(
    countBy(leadRows, (r) => r.payload?.["source_form"]),
    LEAD_SOURCE_FORMS.map((s) => ({ value: s.value, label: s.label })),
  );

  // payment_received → item_type + item_slug
  const itemType = toOptions(
    countBy(payRows, (r) => r.payload?.["item_type"]),
    (v) => v.charAt(0).toUpperCase() + v.slice(1),
  );
  const itemSlugCounts = countBy(payRows, (r) => r.payload?.["item_slug"]);
  const itemSlug = toOptions(itemSlugCounts, (v) => v);

  // installment_overdue → course_id (resolve course titles)
  const courseCounts = countBy(instRows, (r) => r.payload?.["course_id"]);
  const courseTitles = await titlesFor("courses", [...courseCounts.keys()]);
  const courseId = toOptions(courseCounts, (v) => courseTitles.get(v) ?? v);

  // webinar_registered → webinar_id (resolve webinar titles)
  const webCounts = countBy(webRows, (r) => r.webinar_id);
  const webTitles = await titlesFor("webinars", [...webCounts.keys()]);
  const webinarId = toOptions(webCounts, (v) => webTitles.get(v) ?? v);

  return {
    lead_created: { sourceForm },
    payment_received: { itemType, itemSlug },
    installment_overdue: { courseId },
    webinar_registered: { webinarId },
  };
}
