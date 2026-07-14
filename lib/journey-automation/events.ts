/**
 * Journey Automation — event-capture ingest (Phase 2, Part A).
 *
 * WRITE-ONLY, idempotent ingestion of representative business events into the
 * append-only `automation_events` table. This layer:
 *   - NEVER sends anything and NEVER imports the SMS chokepoint.
 *   - NEVER reads/acts on the events (no trigger matching, no execution).
 *   - NEVER throws into a caller (fire-and-forget safe): an ingest failure must
 *     never break the payment / webinar / cron flow it is attached to.
 *   - Is idempotent via a UNIQUE dedupe_key (insert-first, catch-conflict) —
 *     the same proven pattern as sms_logs.
 *
 * Only NON-SENSITIVE shape belongs in `payload` — never login codes/secrets.
 */
import { getSupabaseAdmin } from "../supabase";
import type { AutomationEvent, CapturedEventType } from "@/types/journey-automation";

export interface IngestEventInput {
  eventType: CapturedEventType | string;
  occurredAt?: string | null;
  studentId?: string | null;
  leadId?: string | null;
  enrollmentId?: string | null;
  webinarId?: string | null;
  paymentId?: string | null;
  phone?: string | null;
  payload?: Record<string, unknown>;
  /** UNIQUE-when-present. Omit only for genuinely non-idempotent events. */
  dedupeKey?: string | null;
  source?: string;
}

export interface IngestResult {
  ok: boolean;
  inserted: boolean;
  dedupeKey: string | null;
  error?: string;
}

type EventRow = Omit<AutomationEvent, "id" | "created_at">;

/** Pure: build the row that will be persisted. No I/O; safe to unit test. */
export function buildEventRow(input: IngestEventInput): EventRow {
  return {
    event_type: input.eventType,
    occurred_at: input.occurredAt || new Date().toISOString(),
    student_id: input.studentId ?? null,
    lead_id: input.leadId ?? null,
    enrollment_id: input.enrollmentId ?? null,
    webinar_id: input.webinarId ?? null,
    payment_id: input.paymentId ?? null,
    phone: input.phone ?? null,
    payload: input.payload ?? {},
    dedupe_key: input.dedupeKey ?? null,
    source: input.source ?? "system",
  };
}

/** How a row was persisted. `duplicate` = dedupe_key already ingested (idempotent). */
export type PersistOutcome = "inserted" | "duplicate";
export type PersistFn = (row: EventRow) => Promise<PersistOutcome>;

interface DemoEventStore {
  rows: EventRow[];
  keys: Set<string>;
}
function demoStore(): DemoEventStore {
  const g = globalThis as unknown as { __journeyEvents?: DemoEventStore };
  if (!g.__journeyEvents) g.__journeyEvents = { rows: [], keys: new Set() };
  return g.__journeyEvents;
}

/**
 * Default persister: Supabase in live mode (insert-first; a 23505 unique-violation
 * on dedupe_key means it was already ingested → idempotent), in-memory otherwise.
 * Any OTHER database error is thrown so the outer swallow records ok:false.
 */
const defaultPersist: PersistFn = async (row) => {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const store = demoStore();
    if (row.dedupe_key && store.keys.has(row.dedupe_key)) return "duplicate";
    if (row.dedupe_key) store.keys.add(row.dedupe_key);
    store.rows.push(row);
    return "inserted";
  }
  const { error } = await sb.from("automation_events").insert(row);
  if (error) {
    // 23505 = unique_violation on dedupe_key → already captured (idempotent).
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message || "automation_events insert failed");
  }
  return "inserted";
};

/**
 * Ingest one event. NEVER throws — on any failure it swallows + logs and returns
 * ok:false, so the caller's business flow is never broken. `persist` is injectable
 * for tests (idempotency + swallow-on-failure).
 */
export async function ingestAutomationEvent(
  input: IngestEventInput,
  persist: PersistFn = defaultPersist,
): Promise<IngestResult> {
  let dedupeKey: string | null = null;
  try {
    const row = buildEventRow(input);
    dedupeKey = row.dedupe_key;
    const outcome = await persist(row);
    return { ok: true, inserted: outcome === "inserted", dedupeKey };
  } catch (e) {
    // Swallow: capture is best-effort and must not affect the host flow.
    console.warn("[automation-events] ingest failed (swallowed):", (e as Error)?.message);
    return { ok: false, inserted: false, dedupeKey, error: (e as Error)?.message };
  }
}

/**
 * Fire-and-forget entry point for call-sites (mirrors fireAutoSms). Non-blocking:
 * it returns immediately and can never throw into or slow the host flow.
 */
export function fireAutomationEvent(input: IngestEventInput): void {
  void ingestAutomationEvent(input).catch(() => {});
}

/** Read helper for admin surfaces (never used by any executor). */
export async function listAutomationEvents(limit = 100): Promise<AutomationEvent[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return demoStore().rows.map((r, i) => ({ id: `demo-${i}`, created_at: r.occurred_at, ...r })) as AutomationEvent[];
  const { data } = await sb
    .from("automation_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AutomationEvent[];
}
