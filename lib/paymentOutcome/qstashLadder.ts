/**
 * Per-order Verify ladder via Upstash QStash.
 * Delays: +2,+5,+10,+30,+60 min, +6h, +24h, +48h, +72h (T+3).
 */
import { Client, Receiver } from "@upstash/qstash";
import { SITE_URL } from "../config";
import { getSupabaseAdmin } from "../supabase";
import type { Payment } from "../types";
import { tgLog } from "../telegram/log";

/** Minutes after order creation. */
export const VERIFY_LADDER_MINUTES = [2, 5, 10, 30, 60, 360, 1440, 2880, 4320] as const;

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

function verifyEndpointUrl(): string {
  const base = (process.env.QSTASH_VERIFY_CALLBACK_URL || `${SITE_URL}/api/cron/verify-payment-order`).replace(
    /\/$/,
    "",
  );
  return base;
}

function dedupeKey(ref: string, minute: number): string {
  return `pay-verify:${ref}:t${minute}`;
}

/**
 * Schedule the full ladder for a new order. Idempotent per ref+step via QStash dedupe.
 */
export async function enqueueVerifyLadder(
  referenceNo: string,
  opts?: { dedupe?: boolean },
): Promise<{ ok: boolean; reason?: string; ids: string[] }> {
  const ref = (referenceNo || "").trim();
  if (!ref) return { ok: false, reason: "missing_ref", ids: [] };
  const client = qstashClient();
  if (!client) {
    tgLog("qstash_not_configured", { ref }, "warn");
    return { ok: false, reason: "qstash_not_configured", ids: [] };
  }

  const url = verifyEndpointUrl();
  const ids: string[] = [];
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
      tgLog("qstash_enqueue_failed", { ref, min, error: (e as Error).message }, "warn");
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
  return { ok: ids.length > 0, ids, reason: ids.length ? undefined : "enqueue_failed" };
}

/** Immediate / near-term verify (callback path) — 5s delay. */
export async function enqueueVerifySoon(referenceNo: string): Promise<void> {
  const ref = (referenceNo || "").trim();
  if (!ref) return;
  const client = qstashClient();
  if (!client) return;
  try {
    await client.publishJSON({
      url: verifyEndpointUrl(),
      body: { referenceNo: ref, stepMinutes: 0 },
      delay: 5,
      retries: 2,
      deduplicationId: `pay-verify:${ref}:soon:${Math.floor(Date.now() / 60_000)}`,
    });
  } catch (e) {
    tgLog("qstash_soon_failed", { ref, error: (e as Error).message }, "warn");
  }
}

/** Reschedule one step after 429/5xx. */
export async function enqueueVerifyRetry(referenceNo: string, delayMs: number): Promise<void> {
  const ref = (referenceNo || "").trim();
  if (!ref) return;
  const client = qstashClient();
  if (!client) return;
  const delaySec = Math.max(30, Math.round(delayMs / 1000));
  try {
    await client.publishJSON({
      url: verifyEndpointUrl(),
      body: { referenceNo: ref, stepMinutes: -1, retry: true },
      delay: delaySec,
      retries: 2,
    });
  } catch (e) {
    tgLog("qstash_retry_failed", { ref, error: (e as Error).message }, "warn");
  }
}

export async function cancelVerifyLadder(payment: Pick<Payment, "reference_no" | "verify_schedule_ids" | "id">): Promise<void> {
  const ids = Array.isArray(payment.verify_schedule_ids)
    ? (payment.verify_schedule_ids as string[]).filter(Boolean)
    : [];
  const client = qstashClient();
  if (client && ids.length) {
    for (const id of ids) {
      try {
        await client.messages.delete(id);
      } catch {
        /* already delivered / expired */
      }
    }
  }
  const db = getSupabaseAdmin();
  if (db && payment.id) {
    await db.from("payments").update({ verify_schedule_ids: [] }).eq("id", payment.id);
  }
}

/** Verify QStash signature on the receiving endpoint. */
export async function verifyQstashRequest(req: Request, body: string): Promise<boolean> {
  const current = (process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim();
  const next = (process.env.QSTASH_NEXT_SIGNING_KEY || "").trim();
  if (!current || !next) return false;
  const signature = req.headers.get("upstash-signature") || "";
  if (!signature) return false;
  try {
    const receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}
