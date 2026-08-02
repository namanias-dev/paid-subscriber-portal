/**
 * Resolve per-recipient template variables from linked lead/student/subscriber.
 */
import { SITE_URL } from "../config";
import { getSupabaseAdmin } from "../supabase";
import { DEFAULT_FALLBACKS } from "./compose";

export type RecipientVars = Record<string, string>;

function base(): string {
  return (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
}

export async function resolveRecipientVars(opts: {
  chatId: string;
  subscriberId?: string | null;
  nameHint?: string | null;
  phoneHint?: string | null;
}): Promise<RecipientVars> {
  const db = getSupabaseAdmin();
  const out: RecipientVars = { ...DEFAULT_FALLBACKS };
  out.course_link_1 = `${base()}/courses`;
  out.course_link_2 = `${base()}/courses`;
  out.webinar_link = `${base()}/webinars`;

  if (opts.nameHint) {
    out.name = opts.nameHint;
    out.first_name = opts.nameHint.split(/\s+/)[0] || opts.nameHint;
  }

  if (!db) return out;

  let sub: Record<string, unknown> | null = null;
  if (opts.subscriberId) {
    const { data } = await db.from("telegram_subscribers").select("*").eq("id", opts.subscriberId).maybeSingle();
    sub = (data as Record<string, unknown>) || null;
  }
  if (!sub) {
    const { data } = await db
      .from("telegram_subscribers")
      .select("*")
      .eq("chat_id", String(opts.chatId))
      .maybeSingle();
    sub = (data as Record<string, unknown>) || null;
  }

  if (sub?.first_name != null) {
    const first = String(sub.first_name);
    out.first_name = first.split(/\s+/)[0] || first;
    out.name = first;
  }

  const leadId = sub?.linked_lead_id != null ? String(sub.linked_lead_id) : null;
  if (leadId) {
    const { data: lead } = await db
      .from("leads")
      .select("id, name, phone, course_interest, course")
      .eq("id", leadId)
      .maybeSingle();
    if (lead) {
      const name = (lead as { name?: string }).name;
      if (name) {
        out.name = name;
        out.first_name = name.split(/\s+/)[0] || name;
      }
      const course =
        (lead as { course_interest?: string | null }).course_interest ||
        (lead as { course?: string | null }).course;
      if (course) out.course = String(course);
    }
  }

  const studentId = sub?.linked_student_id != null ? String(sub.linked_student_id) : null;
  if (studentId) {
    const { data: student } = await db.from("students").select("id, name, phone").eq("id", studentId).maybeSingle();
    if (student && (student as { name?: string }).name) {
      const name = String((student as { name: string }).name);
      out.name = name;
      out.first_name = name.split(/\s+/)[0] || name;
    }
  }

  const phone = opts.phoneHint || (sub?.phone != null ? String(sub.phone) : null) || null;
  if (phone) {
    const { data: pay } = await db
      .from("payments")
      .select("item, item_type, amount, item_slug, status")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(5);
    for (const p of pay || []) {
      const status = String((p as { status?: string }).status || "").toUpperCase();
      if (status !== "PAID" && status !== "SUCCESS") continue;
      const item = (p as { item?: string }).item;
      const itemType = (p as { item_type?: string }).item_type;
      const amount = (p as { amount?: number }).amount;
      const slug = (p as { item_slug?: string | null }).item_slug;
      if (item && out.course === DEFAULT_FALLBACKS.course) out.course = String(item);
      if (amount != null) out.amount = String(amount);
      if (itemType === "course" && slug) out.course_link_1 = `${base()}/enroll/${slug}`;
      if (itemType === "webinar" && slug) out.webinar_link = `${base()}/webinars/${slug}`;
      break;
    }
  }

  const { data: webinar } = await db
    .from("webinars")
    .select("slug, starts_at, event_date")
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (webinar) {
    const when =
      (webinar as { starts_at?: string }).starts_at ||
      (webinar as { event_date?: string }).event_date;
    if (when) {
      try {
        out.webinar_date = new Date(when).toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      } catch {
        out.webinar_date = String(when);
      }
    }
    const slug = (webinar as { slug?: string }).slug;
    if (slug) out.webinar_link = `${base()}/webinars/${slug}`;
  }

  return out;
}

export function missingVarReport(
  template: string,
  recipients: { vars: RecipientVars }[],
): Record<string, number> {
  const keys = [...template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!);
  const counts: Record<string, number> = {};
  for (const key of [...new Set(keys)]) {
    let n = 0;
    for (const r of recipients) {
      const v = r.vars[key];
      if (v == null || String(v).trim() === "" || String(v).toLowerCase() === "undefined") n++;
    }
    if (n > 0) counts[key] = n;
  }
  return counts;
}
