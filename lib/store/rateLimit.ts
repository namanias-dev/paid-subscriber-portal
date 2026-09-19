/**
 * Store-owned durable rate limit using auth_attempts (shared infra table the
 * isolation guard already allows). Does not import academy dataProvider.
 *
 * Returns true when the caller should be rejected (limit exceeded).
 */
import { storeDb } from "./db";

export async function storeRateLimited(key: string, max: number, windowSec: number): Promise<boolean> {
  const db = storeDb();
  if (!db) return false;
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await db
      .from("auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", since);
    await db.from("auth_attempts").insert({ key });
    return (count ?? 0) >= max;
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}
