import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * Search telegram subscribers / linked leads by name, phone, or username.
 * GET ?q= → limit 20
 */
export async function GET(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, results: [] });

  const digits = normalizeIndianMobile(q);
  const phoneQ = digits.ok && digits.digits10 ? digits.digits10 : null;
  const like = `%${q.replace(/[%_,]/g, "").slice(0, 40)}%`;

  const results: {
    chat_id: string;
    subscriber_id: string;
    name: string | null;
    phone: string | null;
    username: string | null;
    is_active: boolean;
  }[] = [];
  const seen = new Set<string>();

  const push = (row: Record<string, unknown>) => {
    const chatId = String(row.chat_id || "");
    if (!chatId || seen.has(chatId)) return;
    seen.add(chatId);
    results.push({
      chat_id: chatId,
      subscriber_id: String(row.id),
      name: row.first_name != null ? String(row.first_name) : null,
      phone: row.phone != null ? String(row.phone) : null,
      username: row.username != null ? String(row.username) : null,
      is_active: !!row.is_active,
    });
  };

  if (phoneQ) {
    const { data } = await db
      .from("telegram_subscribers")
      .select("id, chat_id, first_name, phone, username, is_active")
      .eq("phone", phoneQ)
      .limit(20);
    for (const r of data || []) push(r as Record<string, unknown>);
  }

  if (results.length < 20) {
    const { data } = await db
      .from("telegram_subscribers")
      .select("id, chat_id, first_name, phone, username, is_active")
      .or(`first_name.ilike.${like},username.ilike.${like},phone.ilike.${like}`)
      .limit(20);
    for (const r of data || []) {
      if (results.length >= 20) break;
      push(r as Record<string, unknown>);
    }
  }

  // Also search leads with telegram_chat_id
  if (results.length < 20) {
    let leadQ = db
      .from("leads")
      .select("id, name, phone, telegram_chat_id")
      .not("telegram_chat_id", "is", null)
      .limit(20);
    if (phoneQ) {
      leadQ = leadQ.or(`phone.eq.${phoneQ},name.ilike.${like}`);
    } else {
      leadQ = leadQ.or(`name.ilike.${like},phone.ilike.${like}`);
    }
    const { data: leads } = await leadQ;
    for (const lead of leads || []) {
      if (results.length >= 20) break;
      const chatId = String((lead as { telegram_chat_id?: string }).telegram_chat_id || "");
      if (!chatId || seen.has(chatId)) continue;
      const { data: sub } = await db
        .from("telegram_subscribers")
        .select("id, chat_id, first_name, phone, username, is_active")
        .eq("chat_id", chatId)
        .maybeSingle();
      if (sub) {
        push(sub as Record<string, unknown>);
      } else {
        seen.add(chatId);
        results.push({
          chat_id: chatId,
          subscriber_id: "",
          name: (lead as { name?: string | null }).name || null,
          phone: (lead as { phone?: string | null }).phone || null,
          username: null,
          is_active: true,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, results: results.slice(0, 20) });
}
