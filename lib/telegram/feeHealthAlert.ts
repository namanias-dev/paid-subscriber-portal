/**
 * Alert ops Telegram when amount_paid drift or fee invariants are non-zero.
 * Called from /api/cron/verify-payments — additive, never throws to callers.
 */
import { countAmountPaidDrift, type AmountPaidDriftRow } from "../amountPaidCache";
import { getAllCourseEnrollments } from "../dataProvider";
import { enrollmentFeeStateFromEnrollment } from "../enrollmentFeeState";
import { isActiveEnrollment } from "../installments";
import { sendMessage } from "./botApi";
import { escapeHtml } from "./reports/format";
import { getReportSettings, resolveReportsChannelId } from "./reports/settings";
import { assertReportsChannel } from "./reports/channelGuard";
import { tgLog } from "./log";

export type FeeInvariantHit = {
  id: string;
  name: string;
  phone: string;
  reason: string;
};

/**
 * Pinned enrollment filter for the fee-invariant denominator.
 *
 * IN:
 *   - status NOT IN (cancelled, transferred_out)
 *   - AND isActiveEnrollment: (amount_paid > 0 OR status === "fully_paid")
 *
 * OUT:
 *   - cancelled
 *   - transferred_out
 *   - any other row with amount_paid <= 0 and status !== "fully_paid"
 *
 * This is the sole definition — do not ad-hoc filter elsewhere.
 */
export const FEE_INVARIANT_ENROLLMENT_FILTER = {
  in: "active paid enrollments: not cancelled/transferred_out AND (amount_paid > 0 OR status=fully_paid)",
  out: "cancelled, transferred_out, unpaid inactive rows",
} as const;

export function enrollmentInFeeInvariantDenom(e: {
  status?: string | null;
  amount_paid?: number | null;
}): boolean {
  return isActiveEnrollment(e as Parameters<typeof isActiveEnrollment>[0]);
}

/** Lightweight invariant scan (pay-full, negative, overpay). */
export async function scanFeeInvariants(limit = 50_000): Promise<{
  checked: number;
  hits: FeeInvariantHit[];
  filter: typeof FEE_INVARIANT_ENROLLMENT_FILTER;
}> {
  const all = await getAllCourseEnrollments();
  const hits: FeeInvariantHit[] = [];
  let checked = 0;
  for (const e of all) {
    if (checked >= limit) break;
    if (!enrollmentInFeeInvariantDenom(e)) continue;
    checked++;
    const fee = enrollmentFeeStateFromEnrollment(e);
    if (fee.payFullRemainingAmount !== fee.outstanding) {
      hits.push({
        id: e.id,
        name: e.student_name,
        phone: e.phone,
        reason: `pay_full≠outstanding ${fee.payFullRemainingAmount}/${fee.outstanding}`,
      });
    } else if (fee.netPaid > fee.totalFee) {
      hits.push({
        id: e.id,
        name: e.student_name,
        phone: e.phone,
        reason: `netPaid>totalFee ${fee.netPaid}/${fee.totalFee}`,
      });
    } else if (fee.outstanding < 0) {
      hits.push({
        id: e.id,
        name: e.student_name,
        phone: e.phone,
        reason: `negative_outstanding`,
      });
    }
  }
  return { checked, hits, filter: FEE_INVARIANT_ENROLLMENT_FILTER };
}

async function postOpsAlert(html: string): Promise<boolean> {
  try {
    const settings = await getReportSettings();
    const resolved = resolveReportsChannelId(settings);
    const guarded = await assertReportsChannel(resolved);
    if (!guarded.ok || !guarded.id) {
      tgLog("fee_invariant_alert_no_channel", { error: guarded.error }, "warn");
      return false;
    }
    const res = await sendMessage({
      chat_id: guarded.id,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    });
    return !!res.ok;
  } catch (e) {
    tgLog("fee_invariant_alert_failed", { error: (e as Error).message }, "error");
    return false;
  }
}

function formatSamples(rows: AmountPaidDriftRow[] | FeeInvariantHit[], n = 8): string {
  return rows
    .slice(0, n)
    .map((r) => {
      if ("column" in r) {
        return `· ${escapeHtml(r.student_name)} <code>${escapeHtml(r.id.slice(0, 8))}</code> col=${r.column} fee=${r.feeState}`;
      }
      return `· ${escapeHtml(r.name)} <code>${escapeHtml(r.id.slice(0, 8))}</code> ${escapeHtml(r.reason)}`;
    })
    .join("\n");
}

/**
 * Run drift + invariant checks; if either non-zero, alert ops with named enrollments.
 */
export async function runFeeHealthCheckAndAlert(): Promise<{
  drift: number;
  driftChecked: number;
  invariantHits: number;
  invariantChecked: number;
  alerted: boolean;
}> {
  const driftScan = await countAmountPaidDrift();
  const inv = await scanFeeInvariants();
  const needsAlert = driftScan.drift > 0 || inv.hits.length > 0;
  let alerted = false;
  if (needsAlert) {
    const parts = [
      `🚨 <b>Fee health alert</b>`,
      `amount_paid drift: <b>${driftScan.drift}</b> / ${driftScan.checked}`,
      `invariant hits: <b>${inv.hits.length}</b> / ${inv.checked}`,
    ];
    if (driftScan.samples.length) {
      parts.push("", "<b>Drift samples</b>", formatSamples(driftScan.samples));
    }
    if (inv.hits.length) {
      parts.push("", "<b>Invariant hits</b>", formatSamples(inv.hits));
    }
    alerted = await postOpsAlert(parts.join("\n"));
  }
  return {
    drift: driftScan.drift,
    driftChecked: driftScan.checked,
    invariantHits: inv.hits.length,
    invariantChecked: inv.checked,
    alerted,
  };
}
