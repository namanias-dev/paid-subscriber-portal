/**
 * Per-order Verify ladder via Upstash QStash.
 * Delays: +2,+5,+10,+30,+60 min, +6h, +24h, +48h, +72h (T+3).
 */
import { Client, Receiver } from "@upstash/qstash";
import { getSupabaseAdmin } from "../supabase";
import type { Payment } from "../types";
import { tgLog } from "../telegram/log";

/** Minutes after order creation. */
export const VERIFY_LADDER_MINUTES = [2, 5, 10, 30, 60, 360, 1440, 2880, 4320] as const;

/** Canonical production verify worker — never localhost / preview / apex redirect. */
export const PRODUCTION_VERIFY_ORDER_URL =
  "https://www.namanias.com/api/cron/verify-payment-order";

function qstashToken(): string | null {
  const t = (process.env.QSTASH_TOKEN || "").trim();
  return t || null;
}

function qstashClient(): Client | null {
  const token = qstashToken();
  if (!token) return null;
  return new Client({ token });
}

export function isQstashConfigured(): boolean {
  return !!(
    qstashToken() &&
    (process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim() &&
    (process.env.QSTASH_NEXT_SIGNING_KEY || "").trim()
  );
}

/** Safe status for health endpoints (no secrets). */
export function qstashHealthStatus(): {
  qstash: boolean;
  hasToken: boolean;
  hasCurrentSigningKey: boolean;
  hasNextSigningKey: boolean;
  verifyUrl: string;
  ladderSteps: number;
} {
  return {
    qstash: isQstashConfigured(),
    hasToken: !!qstashToken(),
    hasCurrentSigningKey: !!(process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim(),
    hasNextSigningKey: !!(process.env.QSTASH_NEXT_SIGNING_KEY || "").trim(),
    verifyUrl: verifyEndpointUrl(),
    ladderSteps: VERIFY_LADDER_MINUTES.length,
  };
}

/**
 * Absolute URL QStash will POST to.
 * Prefer explicit QSTASH_VERIFY_CALLBACK_URL; otherwise production www
 * (apex namanias.com 308-redirects and can break signed deliveries).
 */
export function verifyEndpointUrl(): string {
  const explicit = (process.env.QSTASH_VERIFY_CALLBACK_URL || "").trim().replace(/\/$/, "");
  if (explicit) {
    if (/localhost|127\.0\.0\.1|vercel\.app/i.test(explicit)) {
      tgLog("qstash_verify_url_unsafe", { explicit }, "warn");
    }
    return explicit;
  }
  if (process.env.NODE_ENV === "production") {
    return PRODUCTION_VERIFY_ORDER_URL;
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (site && !/localhost|127\.0\.0\.1/i.test(site)) {
    const normalized = site.replace(/^https?:\/\/namanias\.com$/i, "https://www.namanias.com");
    const withProto = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    return `${withProto}/api/cron/verify-payment-order`;
  }
  return PRODUCTION_VERIFY_ORDER_URL;
}

function dedupeKey(ref: string, minute: number): string {
  return `pay-verify:${ref}:t${minute}`;
}

/**
 * Schedule the full ladder for a new order. Idempotent per ref+step via QStash dedupe.
 * Never throws — callers must remain non-blocking for checkout.
 */
export async function enqueueVerifyLadder(
  referenceNo: string,
  opts?: { dedupe?: boolean },
): Promise<{ ok: boolean; reason?: string; ids: string[]; url: string }> {
  const ref = (referenceNo || "").trim();
  const url = verifyEndpointUrl();
  if (!ref) {
    tgLog("qstash_enqueue_skip", { ref: "", reason: "missing_ref", url }, "warn");
    return { ok: false, reason: "missing_ref", ids: [], url };
  }
  const client = qstashClient();
  if (!client) {
    tgLog("qstash_not_configured", { ref, url }, "warn");
    return { ok: false, reason: "qstash_not_configured", ids: [], url };
  }

  const ids: string[] = [];
  const failures: { min: number; error: string }[] = [];
  for (const min of VERIFY_LADDER_MINUTES) {
    try {
      const res = await client.publishJSON({
        url,
        body: { referenceNo: ref, stepMinutes: min },
        delay: min * 60,
        retries: 3,
        deduplicationId: opts?.dedupe === false ? undefined : dedupeKey(ref, min),
      });
      if (res.messageId) ids.push(res.messageId);
    } catch (e) {
      const error = (e as Error).message;
      failures.push({ min, error });
      tgLog("qstash_enqueue_failed", { ref, min, error, url }, "warn");
    }
  }

  if (ids.length) {
    const db = getSupabaseAdmin();
    if (db) {
      await db
        .from("payments")
        .update({ verify_schedule_ids: ids })
        .eq("reference_no", ref)
        .not("status", "in", "(PAID,captured)");
    }
  }

  const ok = ids.length > 0;
  tgLog(
    "qstash_enqueue_result",
    {
      ref,
      ok,
      url,
      messageIds: ids,
      scheduled: ids.length,
      expected: VERIFY_LADDER_MINUTES.length,
      failures: failures.length ? failures : undefined,
    },
    ok ? "info" : "warn",
  );
  return { ok, ids, url, reason: ok ? undefined : failures.length ? "enqueue_failed" : "enqueue_failed" };
}

/** Immediate / near-term verify (callback path) — 5s delay. */
export async function enqueueVerifySoon(referenceNo: string): Promise<void> {
  const ref = (referenceNo || "").trim();
  if (!ref) return;
  const client = qstashClient();
  if (!client) return;
  const url = verifyEndpointUrl();
  try {
    const res = await client.publishJSON({
      url,
      body: { referenceNo: ref, stepMinutes: 0 },
      delay: 5,
      retries: 2,
      deduplicationId: `pay-verify:${ref}:soon:${Math.floor(Date.now() / 60_000)}`,
    });
    tgLog("qstash_enqueue_soon", { ref, url, messageId: res.messageId || null }, "info");
  } catch (e) {
    tgLog("qstash_soon_failed", { ref, url, error: (e as Error).message }, "warn");
  }
}

/** Reschedule one step after 429/5xx. */
export async function enqueueVerifyRetry(referenceNo: string, delayMs: number): Promise<void> {
  const ref = (referenceNo || "").trim();
  if (!ref) return;
  const client = qstashClient();
  if (!client) return;
  const delaySec = Math.max(30, Math.round(delayMs / 1000));
  const url = verifyEndpointUrl();
  try {
    const res = await client.publishJSON({
      url,
      body: { referenceNo: ref, stepMinutes: -1, retry: true },
      delay: delaySec,
      retries: 2,
    });
    tgLog("qstash_enqueue_retry", { ref, url, delaySec, messageId: res.messageId || null }, "info");
  } catch (e) {
    tgLog("qstash_retry_failed", { ref, url, error: (e as Error).message }, "warn");
  }
}

export async function cancelVerifyLadder(
  payment: Pick<Payment, "reference_no" | "verify_schedule_ids" | "id">,
): Promise<{ deleted: number; cleared: boolean }> {
  const ref = payment.reference_no || payment.id || "";
  const ids = Array.isArray(payment.verify_schedule_ids)
    ? (payment.verify_schedule_ids as string[]).filter(Boolean)
    : [];
  let deleted = 0;
  const client = qstashClient();
  if (client && ids.length) {
    for (const id of ids) {
      try {
        await client.messages.delete(id);
        deleted += 1;
      } catch {
        /* already delivered / expired */
      }
    }
  }
  let cleared = false;
  const db = getSupabaseAdmin();
  if (db && payment.id) {
    await db.from("payments").update({ verify_schedule_ids: [] }).eq("id", payment.id);
    cleared = true;
  }
  tgLog(
    "qstash_cancel_result",
    { ref, storedIds: ids.length, deleted, cleared },
    "info",
  );
  return { deleted, cleared };
}

/** Verify QStash signature on the receiving endpoint (raw body string required). */
export async function verifyQstashRequest(req: Request, rawBody: string): Promise<boolean> {
  const current = (process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim();
  const next = (process.env.QSTASH_NEXT_SIGNING_KEY || "").trim();
  if (!current || !next) return false;
  const signature = req.headers.get("upstash-signature") || "";
  if (!signature) return false;
  try {
    const receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
    await receiver.verify({ signature, body: rawBody });
    return true;
  } catch {
    return false;
  }
}
