/**
 * One-shot ops Telegram when QStash first drives an order to a terminal state.
 */
import { getSupabaseAdmin } from "../supabase";
import { sendMessage, buildKeyboard } from "../telegram/botApi";
import { getReportSettings, resolveReportsChannelId } from "../telegram/reports/settings";
import { tgLog } from "../telegram/log";
import type { ApplyVerifyResult } from "./applyVerify";

const TERMINALS = new Set(["PAID", "FAILED", "EXPIRED", "ABANDONED"]);

/**
 * Claim + send once. Concurrent callers: only one wins via NULL→timestamp update.
 */
export async function maybeNotifyLadderOkOnce(
  result: ApplyVerifyResult,
  meta: { stepMinutes?: number | null; viaQstash: boolean },
): Promise<boolean> {
  if (!meta.viaQstash) return false;
  if (!result.changed) return false;
  if (!TERMINALS.has(String(result.to || "").toUpperCase())) return false;

  const db = getSupabaseAdmin();
  if (!db) return false;

  const now = new Date().toISOString();
  const { data: claimed } = await db
    .from("telegram_report_settings")
    .update({ ladder_ok_notified_at: now, updated_at: now })
    .eq("id", "default")
    .is("ladder_ok_notified_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) return false;

  const step =
    meta.stepMinutes != null && Number.isFinite(meta.stepMinutes)
      ? ` at +${meta.stepMinutes}min`
      : "";
  const text = [
    `🔧 <b>LADDER OK</b> — <code>${escapeHtml(result.referenceNo)}</code>`,
    `verified via QStash${escapeHtml(step)} → <b>${escapeHtml(result.to)}</b>`,
    `(from ${escapeHtml(result.from || "?")}; outcome ${escapeHtml(String(result.outcome))})`,
    `One-time confirmation — further QStash verifies will not re-notify.`,
  ].join("\n");

  try {
    const settings = await getReportSettings();
    const channel = resolveReportsChannelId(settings);
    if (!channel) {
      tgLog("ladder_ok_no_channel", { ref: result.referenceNo }, "warn");
      return true; // claimed; avoid retry storms
    }
    await sendMessage({
      chat_id: channel,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: buildKeyboard([
        { label: "Payments", url: "https://www.namanias.com/admin/payments" },
      ]),
    });
    tgLog("ladder_ok_sent", { ref: result.referenceNo, to: result.to, stepMinutes: meta.stepMinutes }, "info");
    return true;
  } catch (e) {
    tgLog("ladder_ok_send_failed", { ref: result.referenceNo, error: (e as Error).message }, "error");
    return true;
  }
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
