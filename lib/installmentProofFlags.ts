/**
 * Feature flag for student installment-proof popup.
 * Admin review surfaces ignore this — kill switch only disables the student popup.
 *
 * QA disposable phones can be allowlisted via `meta.qa_phones` (and the hardcoded
 * seed set) without joining grandfather_notice_queue / cohort 73 / armed batches.
 */
import { getSupabaseAdmin } from "./supabase";
import { QA_INSTALLMENT_PROOF_PHONE_LIST } from "./qaInstallmentProofStudents";

export type InstallmentProofPopupScope = "off" | "cohort_73" | "all";

export interface InstallmentProofPopupFlag {
  enabled: boolean;
  scope: InstallmentProofPopupScope;
  killSwitch: boolean;
  /** Last-10-digit phones allowed for popup QA (additive to cohort_73). */
  qaPhones: string[];
}

const DEFAULT: InstallmentProofPopupFlag = {
  enabled: false,
  scope: "off",
  killSwitch: false,
  qaPhones: [],
};

function normalizePhone10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function parseQaPhones(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as { qa_phones?: unknown }).qa_phones;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const d = normalizePhone10(String(v || ""));
    if (d.length === 10) out.push(d);
  }
  return [...new Set(out)];
}

export async function getInstallmentProofPopupFlag(): Promise<InstallmentProofPopupFlag> {
  const db = getSupabaseAdmin();
  if (!db) return DEFAULT;
  const { data } = await db
    .from("app_feature_flags")
    .select("enabled,scope,kill_switch,meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  if (!data) return DEFAULT;
  const scope = String(data.scope || "off") as InstallmentProofPopupScope;
  return {
    enabled: !!data.enabled,
    scope: scope === "cohort_73" || scope === "all" || scope === "off" ? scope : "off",
    killSwitch: !!data.kill_switch,
    qaPhones: parseQaPhones(data.meta),
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
  const digits = normalizePhone10(phone);
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
    const p = normalizePhone10(String(o.phone || ""));
    if (p === digits) return true;
  }
  return false;
}

/** Disposable popup-QA phones (hardcoded seed set ∪ flag meta.qa_phones). */
export async function phoneInInstallmentProofQaAllowlist(phone: string): Promise<boolean> {
  const digits = normalizePhone10(phone);
  if (!digits) return false;
  if (QA_INSTALLMENT_PROOF_PHONE_LIST.includes(digits)) return true;
  const flag = await getInstallmentProofPopupFlag();
  return flag.qaPhones.includes(digits);
}

export async function studentPopupEnabledForPhone(phone: string): Promise<boolean> {
  const flag = await getInstallmentProofPopupFlag();
  if (!popupAllowedByFlag(flag)) return false;
  if (flag.scope === "all") return true;
  if (await phoneInInstallmentProofQaAllowlist(phone)) return true;
  return phoneInInstallmentProofCohort73(phone);
}
