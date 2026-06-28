import { NextResponse } from "next/server";
import { getPayments, getWebinars } from "@/lib/dataProvider";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { getRule, getSettings } from "@/lib/sms/store";
import { sendSms, istMinutesOfDay } from "@/lib/sms/service";
import { normalizeIndianMobile } from "@/lib/phone";
import type { SmsAutoRule } from "@/lib/sms/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hourly (IST top-of-hour) SMS scheduler. ALL jobs no-op unless their auto-rule
 * is enabled. Idempotent: every send carries a per-(mobile,webinar,date) or
 * per-payment dedupe_key, and sendSms inserts-then-sends under a UNIQUE index so
 * re-runs / overlapping invocations cannot double-send.
 *
 * Vercel cron runs it once daily ("30 4 * * *" UTC = 10:00 IST) to stay within
 * Hobby limits. For time-sensitive sends (1hr-before, T19 end+offset), point a
 * free external scheduler (e.g. cron-job.org) at this route HOURLY:
 *   GET  /api/cron/sms-dispatch?secret=<CRON_SECRET>
 *   or   Authorization: Bearer <CRON_SECRET>
 * Every job no-ops unless its rule is enabled, and all sends are idempotent, so
 * extra pings are safe.
 */
function istDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function istDateKeyOf(iso: string): string { return istDateKey(new Date(iso)); }

async function sendToAudience(rule: SmsAutoRule, spec: AudienceSpec, webinarId: string | null, dateKey: string): Promise<number> {
  if (!rule.enabled || !rule.template_id) return 0;
  const recipients = await resolveAudience(spec);
  let sent = 0;
  for (const r of recipients) {
    const idPart = webinarId ? `${webinarId}:${dateKey}` : dateKey;
    const res = await sendSms({
      mobile: r.mobile,
      templateId: rule.template_id,
      variables: r.vars,
      relatedEntity: r.entity,
      sentBy: { type: "SYSTEM" },
      triggerEvent: rule.trigger,
      audienceType: rule.audience_type,
      enforceWindow: true,
      dedupeKey: `${rule.trigger}:${rule.template_id}:${r.normalized}:${idPart}`,
    });
    if (res.ok) sent++;
  }
  return sent;
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const istHour = Math.floor(istMinutesOfDay(now) / 60);
  const today = istDateKey(now);
  const result: Record<string, number> = {};

  try {
    const webinars = await getWebinars();
    const settings = await getSettings();

    // ---- delayed payment nudges (T1 pending, T6 abandoned) ----
    const payments = await getPayments();
    const pendingRule = await getRule("payment_pending");
    if (pendingRule?.enabled && pendingRule.template_id) {
      const delayMs = (pendingRule.delay_minutes || 60) * 60000;
      let n = 0;
      for (const p of payments) {
        const isPending = p.status === "PENDING" || p.status === "VERIFYING" || p.status === "pending";
        const age = Date.now() - new Date(p.created_at).getTime();
        if (!isPending || age < delayMs || age > 36 * 3600 * 1000) continue;
        const d = normalizeIndianMobile(p.phone).digits10;
        if (!d) continue;
        const res = await sendSms({
          mobile: d, templateId: pendingRule.template_id,
          variables: { name: p.student_name, item_short: p.item || p.item_slug || "your purchase", payment_status: p.status },
          relatedEntity: { payment_id: p.id, student_name: p.student_name },
          sentBy: { type: "SYSTEM" }, triggerEvent: "payment_pending", audienceType: "payment_pending",
          enforceWindow: true, dedupeKey: `payment_pending:${pendingRule.template_id}:${d}:${p.id}`,
        });
        if (res.ok) n++;
      }
      result.payment_pending = n;
    }
    const abandRule = await getRule("payment_abandoned");
    if (abandRule?.enabled && abandRule.template_id) {
      let n = 0;
      for (const p of payments) {
        if (p.status !== "ABANDONED") continue;
        const d = normalizeIndianMobile(p.phone).digits10;
        if (!d) continue;
        const res = await sendSms({
          mobile: d, templateId: abandRule.template_id,
          variables: { name: p.student_name, item_short: p.item || p.item_slug || "your purchase" },
          relatedEntity: { payment_id: p.id, student_name: p.student_name },
          sentBy: { type: "SYSTEM" }, triggerEvent: "payment_abandoned", audienceType: "abandoned",
          enforceWindow: true, dedupeKey: `payment_abandoned:${abandRule.template_id}:${d}:${p.id}`,
        });
        if (res.ok) n++;
      }
      result.payment_abandoned = n;
    }

    // ---- webinar schedule jobs ----
    for (const w of webinars) {
      if (!w.datetime) continue;
      const startMs = new Date(w.datetime).getTime();
      const endMs = w.end_datetime ? new Date(w.end_datetime).getTime() : startMs + 3 * 3600 * 1000;
      const minsToStart = Math.round((startMs - Date.now()) / 60000);
      const startDay = istDateKeyOf(w.datetime);

      // day-before (default 18:00 IST)
      const dayBefore = await getRule("webinar_day_before");
      if (dayBefore?.enabled) {
        const tomorrow = istDateKey(new Date(Date.now() + 24 * 3600 * 1000));
        const targetHour = Number((dayBefore.schedule_time || "18:00").split(":")[0]);
        if (startDay === tomorrow && istHour === targetHour) {
          result.webinar_day_before = (result.webinar_day_before || 0) + await sendToAudience(dayBefore, { type: "webinar_registered", webinarId: w.id, webinarSlug: w.slug }, w.id, today);
        }
      }

      // same-day 10:00 IST dual job (registered T9 vs not-registered T12)
      if (startDay === today && istHour === 10) {
        const reg = await getRule("webinar_sameday_registered");
        if (reg?.enabled) result.sameday_registered = (result.sameday_registered || 0) + await sendToAudience(reg, { type: "webinar_registered", webinarId: w.id, webinarSlug: w.slug }, w.id, today);
        const inv = await getRule("webinar_sameday_invite");
        if (inv?.enabled) result.sameday_invite = (result.sameday_invite || 0) + await sendToAudience(inv, { type: "webinar_not_registered", webinarId: w.id, webinarSlug: w.slug }, w.id, today);
      }

      // ~1 hour before
      const soon = await getRule("webinar_starting_soon");
      if (soon?.enabled && minsToStart <= 60 && minsToStart > 0) {
        result.starting_soon = (result.starting_soon || 0) + await sendToAudience(soon, { type: "webinar_registered", webinarId: w.id, webinarSlug: w.slug }, w.id, today);
      }

      // post-webinar T19: end + offset elapsed (within window via enforceWindow).
      // Attendees-only by default; fall back to all-registered ONLY when the
      // setting is on AND there are no tracked attendees (else send to nobody).
      const t19 = await getRule("post_webinar_thankyou");
      if (t19?.enabled) {
        const offsetMs = (t19.offset_minutes ?? settings.t19OffsetMinutes ?? 240) * 60000;
        if (Date.now() >= endMs + offsetMs && Date.now() < endMs + offsetMs + 24 * 3600 * 1000) {
          let spec: AudienceSpec = { type: "webinar_attendees", webinarId: w.id, webinarSlug: w.slug };
          if (settings.t19FallbackAllRegistered) {
            const attendees = await resolveAudience(spec);
            if (attendees.length === 0) spec = { type: "webinar_registered", webinarId: w.id, webinarSlug: w.slug };
          }
          result.post_webinar = (result.post_webinar || 0) + await sendToAudience(t19, spec, w.id, istDateKeyOf(new Date(endMs).toISOString()));
        }
      }
    }

    return NextResponse.json({ ok: true, istHour, result, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
