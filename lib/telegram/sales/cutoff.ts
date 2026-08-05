/**
 * Hard cutoff for Sales & Admissions Telegram alerts.
 * Events / outbox rows created before the cutoff never alert — no exceptions.
 *
 * Cutoff is locked once (DB) at first resolve after this code ships (= deploy time),
 * or overridden by env SALES_ALERTS_CUTOFF_ISO (ISO-8601).
 */
import { getSupabaseAdmin } from "../../supabase";
import { tgLog } from "../log";
import type { SalesOutboxRow } from "./outbox";

const CUTOFF_SLOT = "sales:alerts_cutoff";
const CUTOFF_KIND = "sales_cutoff";

let cachedCutoffIso: string | null = null;

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Raw ISO string for the live cutoff (after resolve). */
export function salesAlertsCutoffIso(): string | null {
  return cachedCutoffIso;
}

/**
 * Resolve and lock cutoff. Idempotent — never moves once persisted
 * (unless SALES_ALERTS_CUTOFF_ISO env forces a value, which is also persisted).
 */
export async function resolveSalesAlertsCutoff(opts?: { forceIso?: string }): Promise<string> {
  if (cachedCutoffIso && !opts?.forceIso) return cachedCutoffIso;

  const envIso = (opts?.forceIso || process.env.SALES_ALERTS_CUTOFF_ISO || "").trim();
  const db = getSupabaseAdmin();

  if (db) {
    try {
      const { data } = await db
        .from("telegram_report_snapshots")
        .select("metrics")
        .eq("slot_key", CUTOFF_SLOT)
        .maybeSingle();
      const existing = (data?.metrics as { cutoffIso?: string } | null)?.cutoffIso;
      if (existing && parseIso(existing) != null && !envIso) {
        cachedCutoffIso = existing;
        return existing;
      }
    } catch {
      /* fall through */
    }
  }

  const cutoffIso = envIso && parseIso(envIso) != null ? envIso : new Date().toISOString();

  if (db) {
    await db
      .from("telegram_report_snapshots")
      .upsert(
        {
          slot_key: CUTOFF_SLOT,
          kind: CUTOFF_KIND,
          metrics: {
            cutoffIso,
            lockedAt: new Date().toISOString(),
            source: envIso ? "env:SALES_ALERTS_CUTOFF_ISO" : "first_boot",
          },
        },
        { onConflict: "slot_key" },
      )
      .then(
        () => null,
        (e) => {
          tgLog("sales_cutoff_persist_failed", { error: (e as Error).message }, "error");
        },
      );
  }

  cachedCutoffIso = cutoffIso;
  tgLog("sales_cutoff_locked", { cutoffIso }, "info");
  return cutoffIso;
}

/** True if the event time is strictly before the cutoff (must not alert). */
export async function isBeforeSalesCutoff(occurredAt: string | Date | null | undefined): Promise<boolean> {
  const cutoffIso = await resolveSalesAlertsCutoff();
  const cutoffMs = parseIso(cutoffIso);
  if (cutoffMs == null) return false;
  if (occurredAt == null) {
    // Missing timestamp → treat as pre-cutoff (fail closed for historical unknowns).
    return true;
  }
  const at = typeof occurredAt === "string" ? parseIso(occurredAt) : occurredAt.getTime();
  if (at == null || !Number.isFinite(at)) return true;
  return at < cutoffMs;
}

export type OutboxPendingCounts = {
  pendingOrFailed: number;
  preCutoffEligible: number;
  postCutoffEligible: number;
  skipped: number;
};

/** Count outbox rows by cutoff eligibility (does not mutate). */
export async function countSalesOutboxPending(): Promise<OutboxPendingCounts> {
  const cutoffIso = await resolveSalesAlertsCutoff();
  const cutoffMs = parseIso(cutoffIso) ?? 0;
  const db = getSupabaseAdmin();
  const empty: OutboxPendingCounts = {
    pendingOrFailed: 0,
    preCutoffEligible: 0,
    postCutoffEligible: 0,
    skipped: 0,
  };
  if (!db) return empty;
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("metrics,created_at")
      .eq("kind", "sales_outbox")
      .limit(500);
    let pendingOrFailed = 0;
    let preCutoffEligible = 0;
    let postCutoffEligible = 0;
    let skipped = 0;
    for (const r of data || []) {
      const m = r.metrics as SalesOutboxRow & { status?: string } | null;
      if (!m?.eventId) continue;
      if (m.status === "skipped") {
        skipped++;
        continue;
      }
      if (m.status !== "pending" && m.status !== "failed") continue;
      pendingOrFailed++;
      const createdMs =
        parseIso(m.createdAt) ??
        parseIso((r as { created_at?: string }).created_at) ??
        0;
      if (createdMs < cutoffMs) preCutoffEligible++;
      else postCutoffEligible++;
    }
    return { pendingOrFailed, preCutoffEligible, postCutoffEligible, skipped };
  } catch {
    return empty;
  }
}

/**
 * Mark all pending/failed outbox rows created before cutoff as skipped.
 * Returns how many were purged.
 */
export async function purgePreCutoffSalesOutbox(): Promise<{ purged: number; cutoffIso: string }> {
  const cutoffIso = await resolveSalesAlertsCutoff();
  const cutoffMs = parseIso(cutoffIso) ?? 0;
  const db = getSupabaseAdmin();
  if (!db) return { purged: 0, cutoffIso };
  let purged = 0;
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("slot_key,metrics,created_at")
      .eq("kind", "sales_outbox")
      .limit(500);
    for (const r of data || []) {
      const m = r.metrics as SalesOutboxRow | null;
      if (!m?.eventId) continue;
      if (m.status !== "pending" && m.status !== "failed") continue;
      const createdMs =
        parseIso(m.createdAt) ??
        parseIso((r as { created_at?: string }).created_at) ??
        0;
      if (createdMs >= cutoffMs) continue;
      const next: SalesOutboxRow = {
        ...m,
        status: "skipped" as SalesOutboxRow["status"],
        lastError: `pre_cutoff:${cutoffIso}`,
        updatedAt: new Date().toISOString(),
      };
      await db
        .from("telegram_report_snapshots")
        .upsert(
          {
            slot_key: r.slot_key,
            kind: "sales_outbox",
            metrics: next as unknown as Record<string, unknown>,
          },
          { onConflict: "slot_key" },
        )
        .then(
          () => {
            purged++;
          },
          () => null,
        );
    }
  } catch (e) {
    tgLog("sales_outbox_purge_failed", { error: (e as Error).message }, "error");
  }
  tgLog("sales_outbox_purged_pre_cutoff", { purged, cutoffIso }, "info");
  return { purged, cutoffIso };
}
