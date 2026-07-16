/**
 * Legacy attribution backfill — PURE, testable, DRY-RUN safe.
 *
 * When we shipped the paid-click priority fix (lib/attribution.ts), some
 * historical lead rows had already frozen an AMBIENT first_touch (e.g. a
 * self-referral or an untagged bounce) even though the SAME row's attribution
 * JSONB carried a real acquisition signal on `last_touch` (gclid / fbclid / an
 * explicit campaign). Those rows' scalar columns (`channel`, `utm_campaign`,
 * `utm_source`, `utm_medium`) were derived from the ambient first_touch and
 * therefore mislabelled.
 *
 * This module re-derives the CORRECT scalar attribution for such rows from a
 * signal ALREADY STORED in the row — it never invents a source. Rows without a
 * stored acquisition signal are LEFT UNCHANGED (Direct/Referral/Unknown stay
 * as-is). Rows whose first_touch already carries an acquisition signal are also
 * left unchanged (first-touch wins).
 *
 * Deliberately does NOT touch anything outside the marketing-attribution scalar
 * columns. The JSONB `attribution` blob is NEVER rewritten by the backfill.
 */
import {
  type AttributionState,
  type AttributionTouch,
  deriveChannel,
  touchHasAcquisitionSignal,
} from "@/lib/attribution";

/** The scalar attribution columns this backfill will consider (and only these). */
export const BACKFILL_SCALARS = [
  "channel",
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const;
export type BackfillScalar = (typeof BACKFILL_SCALARS)[number];

/** Current-value snapshot for a lead row (what the DB has today). */
export interface LegacyLeadRow {
  id: string;
  phone: string | null;
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  /** Raw JSONB attribution state; the source of truth for the recompute. */
  attribution: AttributionState | null;
}

/** Diff computed for one row — old & proposed values, and provenance. */
export interface RecomputeDiff {
  id: string;
  phone: string | null;
  /** Which stored touch supplied the corrected values (first/last). */
  source_touch: "first_touch" | "last_touch";
  old: Record<BackfillScalar, string | null>;
  proposed: Record<BackfillScalar, string | null>;
  /** True when at least one scalar column would actually change. */
  changes: boolean;
}

/** Aggregated dry-run report over a scan. */
export interface DryRunReport {
  scanned_total: number;
  /** Rows with no attribution JSONB — reporting-only (never touched). */
  no_attribution_json: number;
  /** Rows whose stored first_touch already carries an acquisition signal. */
  already_correct: number;
  /** Rows with a stored signal but no needed change (values already match). */
  matches_current: number;
  /** Rows with NO acquisition signal anywhere — left as Direct/Referral/etc. */
  no_signal_stays_unchanged: number;
  /** Rows that WOULD be updated by an execute run. */
  would_change: number;
  /** Breakdown of proposed channels across the would-change set. */
  by_proposed_channel: Record<string, number>;
  /** All diffs; every entry represents a considered row. */
  diffs: RecomputeDiff[];
}

/** Return the corrected touch to derive scalars from, if any. */
function correctedTouch(state: AttributionState | null): {
  touch: AttributionTouch;
  source_touch: "first_touch" | "last_touch";
} | null {
  const ft = state?.first_touch || null;
  const lt = state?.last_touch || null;
  // Rule 1: first-touch already carries a real acquisition signal → keep it.
  if (ft && touchHasAcquisitionSignal(ft)) return { touch: ft, source_touch: "first_touch" };
  // Rule 2: an ambient/direct first-touch is superseded by a last-touch that
  // DOES carry an acquisition signal (mirrors the fixed mergeAttribution rule).
  if (lt && touchHasAcquisitionSignal(lt)) return { touch: lt, source_touch: "last_touch" };
  // Rule 3: no acquisition signal anywhere — nothing to backfill. Never invent.
  return null;
}

function scalarsFromTouch(t: AttributionTouch): Record<BackfillScalar, string | null> {
  const nn = (v: string | null | undefined) => {
    const s = (v ?? "").toString().trim();
    return s || null;
  };
  return {
    channel: deriveChannel(t),
    utm_source: nn(t.source),
    utm_medium: nn(t.medium),
    utm_campaign: nn(t.campaign),
  };
}

function currentScalars(row: LegacyLeadRow): Record<BackfillScalar, string | null> {
  return {
    channel: row.channel ?? null,
    utm_source: row.utm_source ?? null,
    utm_medium: row.utm_medium ?? null,
    utm_campaign: row.utm_campaign ?? null,
  };
}

function anyDifferent(
  a: Record<BackfillScalar, string | null>,
  b: Record<BackfillScalar, string | null>,
): boolean {
  for (const k of BACKFILL_SCALARS) if (a[k] !== b[k]) return true;
  return false;
}

/**
 * Compute the diff for ONE row. Returns null when the row has no attribution
 * JSONB at all (the caller counts these separately as untouchable). Otherwise
 * returns a diff even for no-op rows so the caller can classify + audit them.
 */
export function computeRowDiff(row: LegacyLeadRow): RecomputeDiff | null {
  if (!row.attribution) return null;
  const chosen = correctedTouch(row.attribution);
  const cur = currentScalars(row);
  if (!chosen) {
    // No signal → propose = current; caller classifies as "no_signal_stays_unchanged".
    return {
      id: row.id,
      phone: row.phone,
      source_touch: "first_touch",
      old: cur,
      proposed: cur,
      changes: false,
    };
  }
  const proposed = scalarsFromTouch(chosen.touch);
  return {
    id: row.id,
    phone: row.phone,
    source_touch: chosen.source_touch,
    old: cur,
    proposed,
    changes: anyDifferent(cur, proposed),
  };
}

/** Compute a full dry-run report over a scanned batch of legacy rows. */
export function computeDryRunReport(rows: LegacyLeadRow[]): DryRunReport {
  const diffs: RecomputeDiff[] = [];
  let no_attribution_json = 0;
  let no_signal_stays_unchanged = 0;
  let already_correct = 0;
  let matches_current = 0;
  let would_change = 0;
  const by_proposed_channel: Record<string, number> = {};

  for (const row of rows) {
    const d = computeRowDiff(row);
    if (!d) {
      no_attribution_json += 1;
      continue;
    }
    diffs.push(d);
    // Classify each diff row for the honest denominator.
    const chosen = correctedTouch(row.attribution!);
    if (!chosen) {
      no_signal_stays_unchanged += 1;
      continue;
    }
    if (chosen.source_touch === "first_touch") {
      // first_touch already had a signal — matches_current unless columns are stale.
      if (d.changes) {
        would_change += 1;
        const ch = d.proposed.channel || "Unknown";
        by_proposed_channel[ch] = (by_proposed_channel[ch] || 0) + 1;
      } else {
        already_correct += 1;
      }
      continue;
    }
    // source_touch === "last_touch" → we're proposing an UPGRADE from last_touch.
    if (d.changes) {
      would_change += 1;
      const ch = d.proposed.channel || "Unknown";
      by_proposed_channel[ch] = (by_proposed_channel[ch] || 0) + 1;
    } else {
      matches_current += 1;
    }
  }

  return {
    scanned_total: rows.length,
    no_attribution_json,
    already_correct,
    matches_current,
    no_signal_stays_unchanged,
    would_change,
    by_proposed_channel,
    diffs,
  };
}

/**
 * Idempotent PATCH extractor: given a diff, return the exact column patch that
 * an execute step would send to the DB. Empty object when nothing to change.
 * Guaranteed to reference ONLY the four backfill scalars.
 */
export function patchFromDiff(diff: RecomputeDiff): Partial<Record<BackfillScalar, string | null>> {
  if (!diff.changes) return {};
  const patch: Partial<Record<BackfillScalar, string | null>> = {};
  for (const k of BACKFILL_SCALARS) {
    if (diff.old[k] !== diff.proposed[k]) patch[k] = diff.proposed[k];
  }
  return patch;
}

/**
 * Reversible-backup shape written to disk BEFORE any DB write. Restoring these
 * back onto their `id`s undoes the backfill exactly, byte for byte.
 */
export interface RowBackup {
  id: string;
  old: Record<BackfillScalar, string | null>;
}
export interface BackupFile {
  /** Millisecond epoch when the backup was taken. */
  taken_at: string;
  /** Master SHA the backfill code was running from (best-effort). */
  master_sha?: string | null;
  /** Rows that were (or would be) rewritten — the exact rollback set. */
  rows: RowBackup[];
}

/** Build a rollback backup from a set of diffs that WILL be applied. */
export function buildBackup(diffs: RecomputeDiff[], masterSha?: string | null): BackupFile {
  return {
    taken_at: new Date().toISOString(),
    master_sha: masterSha ?? null,
    rows: diffs.filter((d) => d.changes).map((d) => ({ id: d.id, old: d.old })),
  };
}
