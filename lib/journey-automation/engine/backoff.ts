/**
 * Exponential backoff for durable-job retries. PURE. Attempt N (1-based) waits
 * base * 2^(N-1), capped, so a flaky provider recovers without hammering it.
 */
const BASE_MS = 60_000;      // 1 min
const CAP_MS = 6 * 60 * 60_000; // 6 h

export function backoffMs(attempt: number, baseMs = BASE_MS, capMs = CAP_MS): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = baseMs * Math.pow(2, n - 1);
  return Math.min(raw, capMs);
}

/** After `attempts` failures, is the job exhausted (→ dead-letter)? */
export function isExhausted(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

export function nextRunAtISO(now: number, attempt: number): string {
  return new Date(now + backoffMs(attempt)).toISOString();
}
