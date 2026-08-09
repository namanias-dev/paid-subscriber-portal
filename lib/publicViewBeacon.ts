/**
 * Shared hardening for public view-count beacons (CA / resources).
 * Failures must never affect page render — callers swallow errors.
 */

const BOT_UA =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discordbot|preview|headless|phantom|selenium|puppeteer|curl|wget|python-requests|go-http-client|scrapy/i;

/** Per-isolate sliding window — light anti-amplification, not a hard quota. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const hits = new Map<string, { n: number; reset: number }>();

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA.test(ua);
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Returns true when this IP should be skipped (over limit). */
export function isViewRateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.reset <= now) {
    hits.set(ip, { n: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  cur.n += 1;
  return cur.n > RATE_MAX;
}

export function shouldSkipViewBeacon(req: Request): boolean {
  if (isBotUserAgent(req.headers.get("user-agent"))) return true;
  return isViewRateLimited(clientIp(req));
}
