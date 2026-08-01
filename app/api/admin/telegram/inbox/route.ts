import { NextResponse } from "next/server";
import { currentAdminId, requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { inlineKeyboardFromButtons, sendMessage } from "@/lib/telegram/botApi";
import { enqueueSend } from "@/lib/telegram/queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("telegram_inbox"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, conversations: [], messages: [] });

  const url = new URL(req.url);
  const chatId = url.searchParams.get("chat_id");

  if (chatId) {
    // Mark inbound as read
    await db
      .from("telegram_messages")
      .update({ is_read: true })
      .eq("chat_id", chatId)
      .eq("direction", "inbound")
      .eq("is_read", false);

    const { data: messages } = await db
      .from("telegram_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(200);

    const { data: sub } = await db
      .from("telegram_subscribers")
      .select("*")
      .eq("chat_id", chatId)
      .maybeSingle();

    let lead: Record<string, unknown> | null = null;
    let student: Record<string, unknown> | null = null;
    if (sub?.linked_lead_id) {
      const { data } = await db
        .from("leads")
        .select("id, name, phone, status, source")
        .eq("id", sub.linked_lead_id)
        .maybeSingle();
      lead = (data as Record<string, unknown>) || null;
    }
    if (sub?.linked_student_id) {
      const { data } = await db
        .from("students")
        .select("id, name, phone")
        .eq("id", sub.linked_student_id)
        .maybeSingle();
      student = (data as Record<string, unknown>) || null;
    }

    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      subscriber: sub,
      lead,
      student,
      messages: messages || [],
    });
  }

  // Conversation list: latest message per chat + unread counts
  const { data: recent } = await db
    .from("telegram_messages")
    .select("chat_id, body, direction, created_at, is_read")
    .order("created_at", { ascending: false })
    .limit(500);

  const byChat = new Map<
    string,
    { chat_id: string; last_body: string | null; last_at: string; unread: number }
  >();
  for (const m of recent || []) {
    const cid = String((m as { chat_id: string }).chat_id);
    const existing = byChat.get(cid);
    if (!existing) {
      byChat.set(cid, {
        chat_id: cid,
        last_body: (m as { body?: string | null }).body ?? null,
        last_at: String((m as { created_at: string }).created_at),
        unread: 0,
      });
    }
    if (
      (m as { direction?: string }).direction === "inbound" &&
      (m as { is_read?: boolean }).is_read === false
    ) {
      const row = byChat.get(cid)!;
      row.unread++;
    }
  }

  const chatIds = [...byChat.keys()];
  const subsByChat = new Map<string, Record<string, unknown>>();
  if (chatIds.length) {
    const { data: subs } = await db
      .from("telegram_subscribers")
      .select("id, chat_id, first_name, username, phone, linked_lead_id, linked_student_id, is_active")
      .in("chat_id", chatIds.slice(0, 200));
    for (const s of subs || []) {
      subsByChat.set(String((s as { chat_id: string }).chat_id), s as Record<string, unknown>);
    }
  }

  const conversations = [...byChat.values()]
    .sort((a, b) => b.last_at.localeCompare(a.last_at))
    .slice(0, 100)
    .map((c) => ({
      ...c,
      subscriber: subsByChat.get(c.chat_id) || null,
    }));

  return NextResponse.json({ ok: true, conversations });
}

export async function POST(req: Request) {
  if (!(await requirePermission("telegram_inbox"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chat_id || "").trim();
  const text = String(body.body || body.text || "").trim();
  if (!chatId || !text) {
    return NextResponse.json({ ok: false, error: "chat_id_and_body_required" }, { status: 400 });
  }

  const adminId = await currentAdminId();
  const db = getSupabaseAdmin();

  // Send immediately for inbox reply (also enqueue for audit trail consistency).
  const result = await sendMessage({
    chat_id: chatId,
    text,
    reply_markup: inlineKeyboardFromButtons(body.buttons),
    disable_web_page_preview: true,
  });

  if (!result.ok) {
    if (result.error_code === 403) {
      const { markInactive } = await import("@/lib/telegram/subscribers");
      await markInactive(chatId, "blocked_bot");
    }
    return NextResponse.json(
      { ok: false, error: result.description || "send_failed", error_code: result.error_code },
      { status: 400 },
    );
  }

  const msgId = result.result?.message_id != null ? String(result.result.message_id) : null;
  if (db) {
    const { data: sub } = await db
      .from("telegram_subscribers")
      .select("id")
      .eq("chat_id", chatId)
      .maybeSingle();
    await db.from("telegram_messages").insert({
      chat_id: chatId,
      subscriber_id: sub?.id || null,
      direction: "outbound",
      body: text,
      telegram_message_id: msgId,
      is_read: true,
      sent_by_user_id: adminId,
      metadata: { source: "inbox_reply" },
    });
  }

  // Mirror into queue as already-sent for analytics consistency.
  void enqueueSend({
    chat_id: chatId,
    body: text,
    status: "sent",
    metadata: { source: "inbox_reply", telegram_message_id: msgId },
  });

  return NextResponse.json({ ok: true, telegram_message_id: msgId });
}
