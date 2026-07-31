/**
 * Shared variable fill for payment-lifecycle auto SMS (pending / abandoned /
 * failed). Cron used to pass only {name, item_short} and skip login_code, so
 * every Abandoned/Pending nudge failed closed on missing_vars (0 sends ever).
 *
 * Phone-unique buyers get login_code even when payment name spelling differs
 * from the buyer row (e.g. "Bhumee" vs "Bhumi") — shared numbers still fail
 * closed via resolveBuyerByPhone's ambiguous status.
 */
import { normalizeIndianMobile } from "../phone";
import { resolveBuyerByPhone } from "./store";
import { resolveSmsItemShort } from "./smsTitle";

export async function varsForPaymentAutoSms(p: {
  phone: string | null | undefined;
  student_name?: string | null;
  item?: string | null;
  item_slug?: string | null;
  status?: string | null;
}): Promise<Record<string, string | number | null | undefined>> {
  const name = p.student_name || "";
  const vars: Record<string, string | number | null | undefined> = {
    name,
    item_short: resolveSmsItemShort({ fullTitle: p.item || p.item_slug || "your purchase" }),
  };
  if (p.status) vars.payment_status = p.status;
  const d = normalizeIndianMobile(p.phone || "").digits10;
  if (!d) return vars;
  const r = await resolveBuyerByPhone(d);
  if (r.status === "ok" && r.login_code) vars.login_code = r.login_code;
  return vars;
}
