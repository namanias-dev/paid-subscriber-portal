/**
 * One-shot student confirmation on PAID transition (SMS + Telegram if linked).
 * Never rolls back PAID. Retries SMS 3× then logs.
 */
import { getSupabaseAdmin } from "../supabase";
import type { Payment } from "../types";
import { formatINR } from "../dates";
import { normalizeIndianMobile } from "../phone";
import { sendSms } from "../sms/service";
import { TRIGGERS } from "../sms/templates";
import { tgLog } from "../telegram/log";
import { formatIstShort } from "../telegram/reports/format";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function buildConfirmBody(p: Payment): Promise<string> {
  const amt = formatINR(p.amount);
  if (p.item_type === "webinar") {
    let when = "";
    try {
      const { getWebinars } = await import("../dataProvider");
      const webs = await getWebinars();
      const w = webs.find((x) => x.slug === p.item_slug);
      if (w?.datetime) when = ` — ${formatIstShort(w.datetime)}`;
    } catch {
      /* ignore */
    }
    return [
      `Payment confirmed ${amt}`,
      `${p.item || "Webinar"}${when}`,
      `Joining link will be sent before the session.`,
    ].join("\n");
  }

  // Course: amount, course, installment #, remaining
  let remaining = "";
  let installmentLine = "";
  if (p.enrollment_id) {
    try {
      const { getCourseEnrollmentById } = await import("../dataProvider");
      const enr = await getCourseEnrollmentById(p.enrollment_id);
      if (enr) {
        const rem = Math.max(0, (enr.total_fee || 0) - (enr.amount_paid || 0));
        remaining = `\nRemaining balance ${formatINR(rem)}`;
      }
    } catch {
      /* ignore */
    }
  }
  if (p.payment_kind === "seat") installmentLine = "\nSeat booking";
  else if (p.payment_kind === "installment" && p.installment_no != null) {
    installmentLine = `\nInstallment ${p.installment_no}`;
  } else if (p.payment_kind === "full") installmentLine = "\nFull payment";

  return [`Payment confirmed ${amt}`, p.item || "Course", installmentLine.trim(), remaining.trim()]
    .filter(Boolean)
    .join("\n");
}

/**
 * Claim the notify slot (DB), then send. Concurrent callers: only one wins.
 */
export async function notifyPaymentConfirmedOnce(p: Payment): Promise<boolean> {
  const ref = p.reference_no || p.id;
  const db = getSupabaseAdmin();
  if (!db) return false;

  const now = new Date().toISOString();
  const { data: claimed } = await db
    .from("payments")
    .update({ payment_confirmed_notified_at: now })
    .eq("id", p.id)
    .is("payment_confirmed_notified_at", null)
    .in("status", ["PAID", "captured"])
    .select("id")
    .maybeSingle();

  if (!claimed) return false; // already notified or not PAID

  const body = await buildConfirmBody(p);
  const n = normalizeIndianMobile(p.phone);
  const mobile = n.ok && n.digits10 ? n.digits10 : (p.phone || "").replace(/\D/g, "").slice(-10);

  // SMS via existing template path when possible; fall back to payment_successful.
  let smsOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await sendSms({
        mobile: mobile || p.phone,
        templateId: "payment_successful",
        variables: {
          name: p.student_name || "Student",
          item_short: p.item || "",
          amount: String(p.amount),
          payment_status: "PAID",
          // Extra free-text if template supports — body still from template.
          custom_message: body,
        },
        sentBy: { type: "SYSTEM" },
        triggerEvent: TRIGGERS.payment_success,
        relatedEntity: { payment_id: p.id, student_name: p.student_name },
        allowRecentOverride: true,
      });
      if (res.ok) {
        smsOk = true;
        break;
      }
      tgLog("payment_confirm_sms_attempt", { ref, attempt, skipped: res.skipped, error: res.error }, "warn");
    } catch (e) {
      tgLog("payment_confirm_sms_error", { ref, attempt, error: (e as Error).message }, "warn");
    }
    if (attempt < 3) await sleep(800 * attempt);
  }
  if (!smsOk) tgLog("payment_confirm_sms_gave_up", { ref }, "error");

  // Telegram DM when student has linked chat_id.
  try {
    const { data: student } = await db
      .from("students")
      .select("id,telegram_chat_id")
      .eq("phone", p.phone)
      .not("telegram_chat_id", "is", null)
      .maybeSingle();
    const chatId = student && (student as { telegram_chat_id?: string }).telegram_chat_id;
    if (chatId) {
      const { sendMessage } = await import("../telegram/botApi");
      await sendMessage({ chat_id: String(chatId), text: body });
    }
  } catch (e) {
    tgLog("payment_confirm_telegram_failed", { ref, error: (e as Error).message }, "warn");
  }

  return true;
}
