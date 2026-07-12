/**
 * Tiny in-process TTL memo. Read-only caching only — used to avoid recomputing the same
 * heavy read (e.g. the Revenue Control Tower) several times within a single chat turn, and
 * to keep function CPU low. Never caches writes (AIVA performs none).
 */

type Entry<T> = { value: Promise<T>; expires: number };

const store = new Map<string, Entry<unknown>>();

/** Memoize an async producer under `key` for `ttlMs`. Concurrent callers share one promise. */
export function memo<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;
  const value = produce().catch((e) => {
    // Don't cache failures.
    store.delete(key);
    throw e;
  });
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Clear the whole memo (used by tests for isolation). */
export function clearMemo(): void {
  store.clear();
}
