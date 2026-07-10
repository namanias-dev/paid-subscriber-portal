/**
 * AI Counselor Agent — simple in-memory rate limiter (Phase 1).
 *
 * A fixed-window counter keyed by an arbitrary string (per-IP, per-session, or
 * per-phone). Used to throttle the public agent endpoints and cap lead creation.
 *
 * ⚠ SINGLE-INSTANCE LIMITATION: this state lives in the Node process memory of
 * ONE serverless instance. Under Vercel's multi-instance / cold-start model it is
 * best-effort only and does NOT provide a global guarantee. It is acceptable for
 * Phase 1 (the agent is shipped dark). A durable limiter (e.g. the existing
 * `rateLimited()` DB counter in lib/dataProvider.ts, or a KV store) should back
 * critical limits before the widget goes public in a later phase.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Periodically evict expired buckets to bound memory (called opportunistically). */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Consume one unit against `key`. Returns allowed=false once `max` is exceeded
 * within `windowSec`. Does NOT throw.
 */
export function hit(key: string, max: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSec * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, max - 1), resetAt };
  }
  existing.count += 1;
  const allowed = existing.count <= max;
  return { allowed, remaining: Math.max(0, max - existing.count), resetAt: existing.resetAt };
}

/** Peek current count without consuming. */
export function peek(key: string): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= Date.now()) return 0;
  return b.count;
}

/** Test hook: reset all buckets. */
export function _reset(): void {
  buckets.clear();
}
