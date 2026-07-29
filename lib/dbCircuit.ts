/**
 * Shared DB pressure circuit breaker for automation / heavy crons.
 * In-memory per isolate — enough to stop a stampeding serverless wave.
 */
let consecutiveDbFailures = 0;
let openUntil = 0;

const OPEN_MS = 5 * 60_000;
const FAIL_THRESHOLD = 3;

export function recordDbOk(): void {
  consecutiveDbFailures = 0;
}

export function recordDbFailure(): void {
  consecutiveDbFailures += 1;
  if (consecutiveDbFailures >= FAIL_THRESHOLD) {
    openUntil = Date.now() + OPEN_MS;
  }
}

export function dbCircuitOpen(now = Date.now()): boolean {
  return now < openUntil;
}

export function dbCircuitStatus(now = Date.now()): {
  open: boolean;
  failures: number;
  openForMs: number;
} {
  return {
    open: now < openUntil,
    failures: consecutiveDbFailures,
    openForMs: Math.max(0, openUntil - now),
  };
}

/** Race a promise against a timeout; on timeout record failure. */
export async function withDbBudget<T>(
  work: Promise<T>,
  ms: number,
  label = "db",
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
    recordDbOk();
    return { ok: true, value };
  } catch (e) {
    recordDbFailure();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
