/**
 * Tiny in-memory TTL cache for admin aggregate endpoints.
 * Per-isolate only — enough to stop stampeding identical recomputes.
 */
type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export function ttlGet<T>(key: string, now = Date.now()): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function ttlSet<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  store.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
}

export async function ttlCached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<{ value: T; cache: "hit" | "miss" }> {
  const hit = ttlGet<T>(key);
  if (hit !== undefined) return { value: hit, cache: "hit" };
  const value = await compute();
  ttlSet(key, value, ttlMs);
  return { value, cache: "miss" };
}
