/**
 * Kill switches for sales Telegram (toggle without deploy via app_feature_flags).
 * Keys: sales_alerts_enabled, sales_digest_enabled (enabled column = on/off).
 *
 * Lead batching (env only, default OFF):
 *   SALES_LEAD_BATCHING=1             → enable (only new_lead; payments/proofs never batch)
 *   SALES_LEAD_BATCH_INTERVAL_MIN=20  → batch window minutes (unused while off)
 */
import { getSupabaseAdmin } from "../../supabase";

const ALERTS_KEY = "sales_alerts_enabled";
const DIGEST_KEY = "sales_digest_enabled";

async function flagEnabled(key: string, defaultOn: boolean): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return defaultOn;
  try {
    const { data } = await db
      .from("app_feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle();
    if (!data) return defaultOn;
    return !!data.enabled;
  } catch {
    return defaultOn;
  }
}

export async function salesAlertsEnabled(): Promise<boolean> {
  if ((process.env.TELEGRAM_SALES_ALERTS_ENABLED || "").trim() === "0") return false;
  return flagEnabled(ALERTS_KEY, true);
}

export async function salesDigestEnabled(): Promise<boolean> {
  if ((process.env.TELEGRAM_SALES_DIGEST_ENABLED || "").trim() === "0") return false;
  return flagEnabled(DIGEST_KEY, true);
}

/**
 * Lead batching — DEFAULT OFF. When off, every new_lead fires instantly.
 * Enable by setting env SALES_LEAD_BATCHING=1 (Vercel env + redeploy).
 * Only affects new_lead; payments and proofs are never batchable.
 */
export function salesLeadBatchingEnabled(): boolean {
  const v = (process.env.SALES_LEAD_BATCHING || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Batch window minutes. Default 20. Unused while SALES_LEAD_BATCHING is off. */
export function salesLeadBatchIntervalMinutes(): number {
  const n = Number((process.env.SALES_LEAD_BATCH_INTERVAL_MIN || "20").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 20;
}

/** Ensure flag rows exist (idempotent). Defaults enabled=true. */
export async function ensureSalesFlagRows(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = new Date().toISOString();
  for (const key of [ALERTS_KEY, DIGEST_KEY]) {
    await db
      .from("app_feature_flags")
      .upsert(
        {
          key,
          enabled: true,
          scope: "all",
          kill_switch: false,
          meta: { note: "Telegram sales channel — toggle without deploy" },
          updated_at: now,
        },
        { onConflict: "key" },
      )
      .then(
        () => null,
        () => null,
      );
  }
}

/** Explicitly set both sales kill switches (idempotent upsert). */
export async function setSalesFlagsEnabled(enabled: boolean): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = new Date().toISOString();
  for (const key of [ALERTS_KEY, DIGEST_KEY]) {
    await db
      .from("app_feature_flags")
      .upsert(
        {
          key,
          enabled,
          scope: "all",
          kill_switch: false,
          meta: { note: "Telegram sales channel — toggle without deploy" },
          updated_at: now,
        },
        { onConflict: "key" },
      )
      .then(
        () => null,
        () => null,
      );
  }
}

export { ALERTS_KEY, DIGEST_KEY };
