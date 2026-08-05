/**
 * Kill switches for sales Telegram (toggle without deploy via app_feature_flags).
 * Keys: sales_alerts_enabled, sales_digest_enabled (enabled column = on/off).
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

export { ALERTS_KEY, DIGEST_KEY };
