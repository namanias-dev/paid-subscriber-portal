/**
 * DISK HEADROOM GUARD.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-24 the production database filled its volume mid-backfill.
 * Postgres flipped `default_transaction_read_only = on` and every write in
 * the product started failing. Nobody noticed until writes broke — there was
 * no signal anywhere between "plenty of room" and "the site cannot write".
 *
 * The backfill itself was not unreasonable; it was a 179k-row UPDATE. What
 * made it fatal was that nothing measured the cost BEFORE starting, and
 * nothing warned while headroom disappeared. A row UPDATE in Postgres writes
 * a whole new row version (MVCC) plus a full WAL record, so a bulk update of
 * a wide table can transiently need several times the table's own size. On
 * the day, `leads` reached 460 MB with 24% dead tuples and WAL peaked at
 * 704 MB.
 *
 * Two guards, both cheap:
 *   1. {@link checkStorageHealth} — continuous. Warns at 70%, critical at 85%.
 *   2. {@link preflightDiskCheck} — before a bulk write. Refuses to start a
 *      job whose PROJECTED footprint would push utilisation past 80%.
 *
 * The second is the one that would have prevented the outage.
 */

/** Provisioned volume. Supabase Pro starts at 8 GB and auto-scales. */
export const DISK_BYTES = 8 * 1024 * 1024 * 1024;

/** Warn here. Enough runway to act before anything breaks. */
export const WARN_THRESHOLD = 0.7;
/** Refuse to START new bulk writes above this. */
export const PREFLIGHT_CEILING = 0.8;
/** Page someone. Read-only mode is close. */
export const CRITICAL_THRESHOLD = 0.85;

export type StorageLevel = "ok" | "warn" | "critical";

export interface StorageHealth {
  level: StorageLevel;
  usedBytes: number;
  diskBytes: number;
  /** 0..1 */
  utilisation: number;
  message: string;
}

export interface StorageSqlClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function gib(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Pure classifier. Split out so the thresholds are unit-testable without a DB. */
export function classifyStorage(usedBytes: number, diskBytes: number = DISK_BYTES): StorageHealth {
  const utilisation = diskBytes > 0 ? usedBytes / diskBytes : 0;
  let level: StorageLevel = "ok";
  if (utilisation >= CRITICAL_THRESHOLD) level = "critical";
  else if (utilisation >= WARN_THRESHOLD) level = "warn";

  const base = `${gib(usedBytes)} of ${gib(diskBytes)} (${pct(utilisation)})`;
  const message =
    level === "critical"
      ? `CRITICAL: database storage at ${base}. Postgres switches to read-only when the volume fills — writes across the product will start failing. Free space or raise the disk NOW.`
      : level === "warn"
        ? `WARNING: database storage at ${base}. Above ${pct(WARN_THRESHOLD)}. Bulk imports and backfills are blocked above ${pct(PREFLIGHT_CEILING)}.`
        : `Database storage healthy: ${base}.`;

  return { level, usedBytes, diskBytes, utilisation, message };
}

/**
 * Projected footprint of a bulk write.
 *
 * A row UPDATE does not overwrite in place — it writes a new row version and
 * leaves the old one dead until VACUUM, and it writes a WAL record roughly the
 * size of the changed row. So the transient cost of updating N rows of average
 * width W is about `N * W` of new heap PLUS a similar amount of WAL, on top of
 * the space still held by the dead versions. The 2x multiplier below is the
 * conservative floor observed on 2026-07-24, not a theoretical bound.
 */
export function projectBulkWriteBytes(rowCount: number, avgRowBytes: number): number {
  const heap = rowCount * avgRowBytes;
  const wal = heap;
  return heap + wal;
}

export interface PreflightResult {
  allowed: boolean;
  projectedBytes: number;
  projectedUtilisation: number;
  reason: string;
}

/**
 * Gate a bulk import/backfill. Call BEFORE writing the first row.
 *
 * Fails loudly and early rather than halfway through, which is the difference
 * between "the job did not run" and "the database is read-only and the job is
 * half-applied".
 */
export function preflightDiskCheck(opts: {
  currentUsedBytes: number;
  rowCount: number;
  avgRowBytes: number;
  diskBytes?: number;
}): PreflightResult {
  const diskBytes = opts.diskBytes ?? DISK_BYTES;
  const projectedBytes = projectBulkWriteBytes(opts.rowCount, opts.avgRowBytes);
  const projectedTotal = opts.currentUsedBytes + projectedBytes;
  const projectedUtilisation = diskBytes > 0 ? projectedTotal / diskBytes : 0;

  if (projectedUtilisation > PREFLIGHT_CEILING) {
    return {
      allowed: false,
      projectedBytes,
      projectedUtilisation,
      reason:
        `REFUSING TO START: writing ${opts.rowCount.toLocaleString()} rows is projected to add ` +
        `${gib(projectedBytes)} (heap + WAL), taking storage from ${gib(opts.currentUsedBytes)} to ` +
        `${gib(projectedTotal)} — ${pct(projectedUtilisation)} of ${gib(diskBytes)}, past the ` +
        `${pct(PREFLIGHT_CEILING)} ceiling. Free space, raise the disk, or run the job in smaller ` +
        `chunks with a VACUUM between them.`,
    };
  }

  return {
    allowed: true,
    projectedBytes,
    projectedUtilisation,
    reason:
      `OK: projected +${gib(projectedBytes)} takes storage to ${pct(projectedUtilisation)} of ` +
      `${gib(diskBytes)}, under the ${pct(PREFLIGHT_CEILING)} ceiling.`,
  };
}

/** Reads `pg_database_size` via the `db_size_bytes` RPC and classifies it. */
export async function checkStorageHealth(
  client: StorageSqlClient | null,
  diskBytes: number = DISK_BYTES,
): Promise<StorageHealth | null> {
  if (!client) return null;
  const { data, error } = await client.rpc("db_size_bytes", {});
  if (error) return null;
  const used = typeof data === "number" ? data : Number(data ?? 0);
  if (!Number.isFinite(used) || used <= 0) return null;
  return classifyStorage(used, diskBytes);
}
