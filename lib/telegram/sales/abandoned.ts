/**
 * Checkout abandoned = INITIATED/PENDING/VERIFYING with no PAID sibling after 30 min.
 * Swept from telegram-reports cron (reuse existing cron — no new schedule).
 */
import { getPayments } from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { getSupabaseAdmin } from "../../supabase";
import { tgLog } from "../log";
import { salesAlertCheckoutAbandoned, fireSalesAlert } from "./send";
import { salesChannelConfigured } from "../channels";
import { salesAlertsEnabled } from "./settings";

const ABANDON_MINUTES = 30;

export async function sweepCheckoutAbandoned(): Promise<{ checked: number; alerted: number }> {
  try {
    if (!salesChannelConfigured()) return { checked: 0, alerted: 0 };
    if (!(await salesAlertsEnabled())) return { checked: 0, alerted: 0 };

    const pays = await getPayments();
    const now = Date.now();
    const open = pays.filter((p) => {
      if (p.deleted_at || p.is_superseded) return false;
      const st = String(p.status || "").toUpperCase();
      if (st !== "INITIATED" && st !== "PENDING" && st !== "UNCONFIRMED") return false;
      const age = now - new Date(p.created_at).getTime();
      return age >= ABANDON_MINUTES * 60_000 && age < 24 * 3600_000;
    });

    let alerted = 0;
    for (const p of open) {
      const phone = (p.phone || "").replace(/\D/g, "").slice(-10);
      if (!phone) continue;
      // Skip if same phone already paid this item since open
      const paidLater = pays.some(
        (x) =>
          !x.deleted_at &&
          isPaidStatus(x.status) &&
          (x.phone || "").replace(/\D/g, "").slice(-10) === phone &&
          (x.item_slug === p.item_slug || x.item === p.item) &&
          new Date(x.created_at).getTime() >= new Date(p.created_at).getTime(),
      );
      if (paidLater) continue;

      let studentId: string | null = null;
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
        studentId = data?.id ? String(data.id) : null;
      }

      const minutesAgo = (now - new Date(p.created_at).getTime()) / 60_000;
      await salesAlertCheckoutAbandoned({
        name: p.student_name || "Student",
        phone,
        course: p.item || p.item_slug || "Course",
        minutesAgo,
        studentId,
      });
      alerted++;
    }
    return { checked: open.length, alerted };
  } catch (e) {
    tgLog("sales_abandon_sweep_failed", { error: (e as Error).message }, "error");
    return { checked: 0, alerted: 0 };
  }
}

/** Fire-and-forget wrapper for cron. */
export function fireAbandonSweep(): void {
  fireSalesAlert(async () => {
    await sweepCheckoutAbandoned();
  });
}
