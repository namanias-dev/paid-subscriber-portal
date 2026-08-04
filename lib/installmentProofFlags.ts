/**
 * Feature flag for student installment-proof popup.
 * Admin review surfaces ignore this — kill switch only disables the student popup.
 */
import { getSupabaseAdmin } from "./supabase";

export type InstallmentProofPopupScope = "off" | "cohort_73" | "all";

export interface InstallmentProofPopupFlag {
  enabled: boolean;
  scope: InstallmentProofPopupScope;
  killSwitch: boolean;
}

const DEFAULT: InstallmentProofPopupFlag = {
  enabled: false,
  scope: "off",
  killSwitch: false,
};

export async function getInstallmentProofPopupFlag(): Promise<InstallmentProofPopupFlag> {
  const db = getSupabaseAdmin();
  if (!db) return DEFAULT;
  const { data } = await db
    .from("app_feature_flags")
    .select("enabled,scope,kill_switch")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  if (!data) return DEFAULT;
  const scope = String(data.scope || "off") as InstallmentProofPopupScope;
  return {
    enabled: !!data.enabled,
    scope: scope === "cohort_73" || scope === "all" || scope === "off" ? scope : "off",
    killSwitch: !!data.kill_switch,
  };
}

/** Student popup may show? Kill switch wins. */
export function popupAllowedByFlag(flag: InstallmentProofPopupFlag): boolean {
  if (flag.killSwitch) return false;
  if (!flag.enabled) return false;
  return flag.scope === "cohort_73" || flag.scope === "all";
}

/**
 * 73 cohort = grandfather_notice_queue phones (pilot+queued+classic) OR
 * active override with grandfathered note. Additive lookup only.
 */
export async function phoneInInstallmentProofCohort73(phone: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (!digits) return false;

  const { count: q } = await db
    .from("grandfather_notice_queue")
    .select("*", { count: "exact", head: true })
    .or(`phone.eq.${digits},phone.eq.91${digits},phone.eq.+91${digits}`);
  if ((q || 0) > 0) return true;

  const { data: ovrs } = await db
    .from("course_access_overrides")
    .select("note,phone")
    .ilike("note", "%grandfather%")
    .limit(200);
  for (const o of ovrs || []) {
    const p = String(o.phone || "").replace(/\D/g, "").slice(-10);
    if (p === digits) return true;
  }
  return false;
}

export async function studentPopupEnabledForPhone(phone: string): Promise<boolean> {
  const flag = await getInstallmentProofPopupFlag();
  if (!popupAllowedByFlag(flag)) return false;
  if (flag.scope === "all") return true;
  return phoneInInstallmentProofCohort73(phone);
}
