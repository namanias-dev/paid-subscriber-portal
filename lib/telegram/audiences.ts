import {
  PHONE_AUDIENCES,
  resolvePhoneAudience,
  type PhoneAudienceId,
} from "../adminPhoneAudiences";
import { normalizeIndianMobile } from "../phone";
import { getSupabaseAdmin } from "../supabase";
import type { TelegramReachable } from "./types";

export { PHONE_AUDIENCES };
export type { PhoneAudienceId };

export interface TelegramAudienceResult {
  audienceSize: number;
  reachable: TelegramReachable[];
  skippedNoTelegram: number;
}

function digits10(phone: string | null | undefined): string | null {
  const n = normalizeIndianMobile(phone);
  return n.ok && n.digits10 ? n.digits10 : null;
}

/**
 * Resolve a phone audience, then join to active telegram_subscribers by
 * normalized phone OR linked lead/student (via phone match on lead/student rows
 * already reflected on subscriber.phone / linked ids).
 */
export async function resolveTelegramAudience(
  audienceId: PhoneAudienceId | string,
  fromMs: number,
  toMs: number,
): Promise<TelegramAudienceResult> {
  const id = audienceId as PhoneAudienceId;
  if (!PHONE_AUDIENCES.some((a) => a.id === id)) {
    return { audienceSize: 0, reachable: [], skippedNoTelegram: 0 };
  }

  const people = await resolvePhoneAudience(id, fromMs, toMs);
  const audienceSize = people.length;
  if (!audienceSize) {
    return { audienceSize: 0, reachable: [], skippedNoTelegram: 0 };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { audienceSize, reachable: [], skippedNoTelegram: audienceSize };
  }

  const phoneSet = new Set<string>();
  const nameByPhone = new Map<string, string | null>();
  for (const p of people) {
    const d = digits10(p.phone);
    if (!d) continue;
    phoneSet.add(d);
    nameByPhone.set(d, p.name);
  }
  const phones = [...phoneSet];
  if (!phones.length) {
    return { audienceSize, reachable: [], skippedNoTelegram: audienceSize };
  }

  // Batch in chunks to stay under URL/filter limits.
  const activeByPhone = new Map<string, { chat_id: string; id: string; first_name: string | null }>();
  const CHUNK = 200;
  for (let i = 0; i < phones.length; i += CHUNK) {
    const slice = phones.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("telegram_subscribers")
      .select("id, chat_id, phone, first_name, is_active")
      .eq("is_active", true)
      .in("phone", slice);
    for (const row of data || []) {
      const ph = digits10((row as { phone?: string }).phone);
      if (!ph || activeByPhone.has(ph)) continue;
      activeByPhone.set(ph, {
        id: String((row as { id: string }).id),
        chat_id: String((row as { chat_id: string }).chat_id),
        first_name: (row as { first_name?: string | null }).first_name || null,
      });
    }
  }

  const reachable: TelegramReachable[] = [];
  const seenChat = new Set<string>();
  for (const phone of phones) {
    const sub = activeByPhone.get(phone);
    if (!sub) continue;
    if (seenChat.has(sub.chat_id)) continue;
    seenChat.add(sub.chat_id);
    reachable.push({
      chat_id: sub.chat_id,
      name: nameByPhone.get(phone) || sub.first_name,
      phone,
      subscriber_id: sub.id,
    });
  }

  return {
    audienceSize,
    reachable,
    skippedNoTelegram: Math.max(0, audienceSize - reachable.length),
  };
}
