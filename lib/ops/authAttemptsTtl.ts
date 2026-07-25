/**
 * `auth_attempts` retention.
 *
 * WHY THIS EXISTS
 * ---------------
 * `rateLimited()` (lib/dataProvider.ts) inserts one row per throttled action
 * and nothing ever deleted them. By 2026-07-24 the table was 45 MB / 217,799
 * rows, of which only 3,287 were still inside any caller's window.
 *
 * WHY 24 HOURS IS SAFE
 * --------------------
 * `rateLimited(key, max, windowSec)` only ever counts rows newer than
 * `now() - windowSec`. The widest window in the codebase is careers/apply at
 * 3,600 s, so a row older than 24 h cannot influence any decision. The 24x
 * margin is deliberate: it means a new caller can adopt a window an order of
 * magnitude wider than today's without anyone remembering this file.
 *
 * NOT A TRUNCATE. Dropping in-window rows would reset every counter and
 * unlock every currently-throttled phone and IP at once.
 */

/** Widest `rateLimited()` window in the codebase (careers/apply). */
export const WIDEST_RATE_LIMIT_WINDOW_SEC = 3600;

/** Retention handed to the prune. */
export const RETAIN_HOURS = 24;

/**
 * Retention must clear the widest live window with room to spare. Mirrors the
 * 2 h floor enforced inside `public.prune_auth_attempts`, so a bad argument
 * fails here rather than quietly shortening somebody's throttle.
 */
export const MIN_RETAIN_HOURS = 2;

export interface PruneSqlClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface PruneResult {
  ok: boolean;
  deleted: number;
  error?: string;
}

/**
 * Pure guard. True when `retainHours` keeps every row any caller could still
 * read, given the widest window currently in use.
 */
export function retainHoursAreSafe(
  retainHours: number,
  widestWindowSec: number = WIDEST_RATE_LIMIT_WINDOW_SEC,
): boolean {
  if (!Number.isFinite(retainHours)) return false;
  if (retainHours < MIN_RETAIN_HOURS) return false;
  return retainHours * 3600 > widestWindowSec;
}

/**
 * Runs the chunked aged DELETE in Postgres. Idempotent — a second run in the
 * same minute deletes nothing.
 */
export async function pruneAuthAttempts(
  client: PruneSqlClient | null,
  retainHours: number = RETAIN_HOURS,
): Promise<PruneResult> {
  if (!client) return { ok: false, deleted: 0, error: "no-db" };
  if (!retainHoursAreSafe(retainHours)) {
    return {
      ok: false,
      deleted: 0,
      error:
        `refusing to prune with ${retainHours} h retention: it does not clear the widest ` +
        `rateLimited() window (${WIDEST_RATE_LIMIT_WINDOW_SEC} s) by a safe margin`,
    };
  }

  const { data, error } = await client.rpc("prune_auth_attempts", { p_retain_hours: retainHours });
  if (error) return { ok: false, deleted: 0, error: error.message };

  const deleted = typeof data === "number" ? data : Number(data ?? 0);
  return { ok: true, deleted: Number.isFinite(deleted) ? deleted : 0 };
}
