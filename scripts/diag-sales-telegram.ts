/**
 * Sales Telegram diagnosis — read-only except optional --test-send.
 */
import { readFileSync, existsSync } from "fs";

function loadEnvFile(path: string, force = false) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!.trim();
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (force || !process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.sales-diag", true);

async function main() {
  const { getSupabaseAdmin } = await import("../lib/supabase");
  const { getChat, getMe, sendMessage } = await import("../lib/telegram/botApi");
  const { salesAlertsEnabled, salesDigestEnabled } = await import("../lib/telegram/sales/settings");
  const { salesChannelConfigured } = await import("../lib/telegram/channels");
  const { botConfigured, botToken } = await import("../lib/telegram/config");

  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const db = getSupabaseAdmin()!;

  async function count(table: string, col: string, extra?: (q: any) => any) {
    let q = db.from(table).select("id", { count: "exact", head: true }).gte(col, since);
    if (extra) q = extra(q);
    const { count, error } = await q;
    return { count: count ?? 0, error: error?.message || null };
  }

  const events = {
    payments_created_paid: await count("payments", "created_at", (q: any) =>
      q.in("status", ["PAID", "paid"]),
    ),
    payments_updated_paid: await count("payments", "updated_at", (q: any) =>
      q.in("status", ["PAID", "paid"]),
    ),
    course_enrollments: await count("course_enrollments", "created_at"),
    installment_proofs_submitted: await count("installment_payment_proofs", "submitted_at"),
    proofs_approved: await count("installment_payment_proofs", "reviewed_at", (q: any) =>
      q.in("status", ["approved", "approved_recorded"]),
    ),
    leads: await count("leads", "created_at"),
  };

  const { data: snaps } = await db
    .from("telegram_report_snapshots")
    .select("slot_key,kind,metrics,created_at")
    .gte("created_at", since)
    .like("slot_key", "sales:%")
    .order("created_at", { ascending: false })
    .limit(80);

  const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  const me = await getMe();
  const chat = chatId ? await getChat(chatId) : ({ ok: false, description: "no_chat_id" } as const);

  console.log(
    JSON.stringify(
      {
        since,
        events,
        flags: {
          salesAlertsEnabled: await salesAlertsEnabled(),
          salesDigestEnabled: await salesDigestEnabled(),
          salesChannelConfigured: salesChannelConfigured(),
          botConfigured: botConfigured(),
          env: {
            TELEGRAM_BOT_TOKEN: !!botToken(),
            TELEGRAM_SALES_CHAT_ID: !!chatId,
            TELEGRAM_SALES_CHAT_ID_shape: chatId
              ? `${chatId.slice(0, 4)}…${chatId.slice(-4)} (len=${chatId.length})`
              : null,
            TELEGRAM_SALES_ALERTS_ENABLED: process.env.TELEGRAM_SALES_ALERTS_ENABLED ?? "(unset→DB default on)",
            TELEGRAM_SALES_DIGEST_ENABLED: process.env.TELEGRAM_SALES_DIGEST_ENABLED ?? "(unset→DB default on)",
          },
        },
        bot: {
          ok: me.ok,
          username: (me as { result?: { username?: string } }).result?.username,
          error: me.description,
        },
        chat: {
          ok: chat.ok,
          id: (chat as { result?: { id?: number } }).result?.id,
          title: (chat as { result?: { title?: string } }).result?.title,
          type: (chat as { result?: { type?: string } }).result?.type,
          error: chat.description,
        },
        salesSnaps48h_count: (snaps || []).length,
        salesSnaps48h: (snaps || []).slice(0, 30).map((s) => ({
          kind: s.kind,
          key: s.slot_key,
          at: s.created_at,
          event: (s.metrics as { event?: string } | null)?.event,
          message_id: (s.metrics as { message_id?: number } | null)?.message_id,
        })),
      },
      null,
      2,
    ),
  );

  if (process.argv.includes("--test-send")) {
    const t0 = Date.now();
    const res = await sendMessage({
      chat_id: chatId,
      text: `🧪 <b>Sales channel test</b>\nDiag ping ${new Date().toISOString()}\nIf you see this, transport is fine.`,
      parse_mode: "HTML",
      disable_notification: false,
    });
    console.log(
      "TEST_SEND",
      JSON.stringify({
        ok: res.ok,
        ms: Date.now() - t0,
        error: res.description,
        error_code: res.error_code,
        message_id: (res.result as { message_id?: number } | undefined)?.message_id,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
