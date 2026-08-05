/**
 * One-time bounded seed for Sales & Admissions Telegram — today IST only.
 * Idempotent via run marker + per-event dedupe keys shared with live alerts.
 */
import { getPayments } from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { getSupabaseAdmin } from "../../supabase";
import { buildKeyboard, pinChatMessage } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import { formatIstShort, istNowParts } from "../reports/format";
import {
  alreadyDeduped,
  markDeduped,
  salesDedupKey,
  type SalesEventType,
} from "./dedupe";
import { buildSalesDigestHtml } from "./digest";
import {
  adminStudentDeepLink,
  escapeHtml,
  maskPhone,
  salesInr,
} from "./format";
import { SITE_URL } from "../../config";

const SEED_CAP = 50;
const THROTTLE_MS = 4500; // ~13 msg/min — under Telegram ~20/min
const SEED_PREFIX = "· earlier today";
const SEED_DAY = "2026-08-05"; // hard-bound calendar day IST

export interface SeedEvent {
  at: number;
  event: SalesEventType;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
  ref: string;
}

function istDayBounds(ymd: string): { startMs: number; endMs: number } {
  // Asia/Kolkata midnight = UTC-5:30 previous calendar for that IST day
  const startMs = Date.parse(`${ymd}T00:00:00+05:30`);
  const endMs = Date.parse(`${ymd}T23:59:59.999+05:30`);
  return { startMs, endMs };
}

function phone10(p: string | null | undefined): string {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

function seedRunKey(ymd: string): string {
  return `sales:seed:run:${ymd}`;
}

function seedMsgKey(ev: SeedEvent): string {
  return `sales:seed:msg:${ev.event}:${phone10(ev.phone)}:${ev.ref}`;
}

export async function seedRunAlreadyComplete(ymd = SEED_DAY): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("telegram_report_snapshots").select("id,metrics").eq("slot_key", seedRunKey(ymd)).maybeSingle();
  return !!(data?.metrics as { complete?: boolean } | null)?.complete;
}

async function markSeedProgress(ymd: string, patch: Record<string, unknown>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const key = seedRunKey(ymd);
  const { data } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", key).maybeSingle();
  const prev = ((data?.metrics as Record<string, unknown>) || {}) as Record<string, unknown>;
  await db.from("telegram_report_snapshots").upsert(
    { slot_key: key, kind: "sales_seed_run", metrics: { ...prev, ...patch, ymd } },
    { onConflict: "slot_key" },
  );
}

async function msgAlreadyPosted(ev: SeedEvent): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", seedMsgKey(ev)).maybeSingle();
  if (data) return true;
  return alreadyDeduped(ev.event, ev.phone);
}

async function markMsgPosted(ev: SeedEvent): Promise<void> {
  const db = getSupabaseAdmin();
  await markDeduped(ev.event, ev.phone);
  if (!db) return;
  await db.from("telegram_report_snapshots").upsert(
    {
      slot_key: seedMsgKey(ev),
      kind: "sales_seed_msg",
      metrics: { event: ev.event, phone: phone10(ev.phone), ref: ev.ref, at: ev.at },
    },
    { onConflict: "slot_key" },
  );
}

function wrapSeedHtml(body: string): string {
  return `${SEED_PREFIX}\n${body}`;
}

export async function collectTodaySalesSeedEvents(now = new Date()): Promise<{
  ymd: string;
  startIso: string;
  endIso: string;
  events: SeedEvent[];
  omitted: number;
}> {
  const ymd = SEED_DAY;
  const { startMs, endMs } = istDayBounds(ymd);
  const end = Math.min(now.getTime(), endMs);
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(end).toISOString();

  const pays = await getPayments();
  const db = getSupabaseAdmin();
  const events: SeedEvent[] = [];

  const inWindow = (iso: string | null | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) && t >= startMs && t <= end;
  };

  for (const p of pays) {
    if (p.deleted_at) continue;
    if (!inWindow(p.created_at)) continue;
    const phone = phone10(p.phone);
    if (!phone) continue;
    const course = p.item || p.item_slug || "Item";
    const name = p.student_name || "Student";
    const when = formatIstShort(p.created_at);
    const link = adminStudentDeepLink({ phone });
    const buttons = [{ label: "Open in admin", url: link }];
    const st = String(p.status || "").toUpperCase();
    const at = new Date(p.created_at).getTime();
    const ref = p.reference_no || p.id;

    if (st === "FAILED") {
      const reason = p.verify_status || p.response_code || null;
      events.push({
        at,
        event: "payment_failed",
        phone,
        ref,
        buttons,
        html: wrapSeedHtml(
          [
            `🔴 <b>Payment failed</b> · ${escapeHtml(name)}`,
            `${escapeHtml(course)} · ${salesInr(Number(p.amount) || 0)} · ${escapeHtml(maskPhone(phone))}`,
            reason ? `Reason: ${escapeHtml(String(reason))}` : null,
            when,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      });
      continue;
    }

    if (st === "EXPIRED") {
      events.push({
        at,
        event: "payment_link_expired",
        phone,
        ref,
        buttons,
        html: wrapSeedHtml(
          [
            `⚪ <b>Link expired unused</b> · ${escapeHtml(name)}`,
            `${escapeHtml(course)} · ${escapeHtml(maskPhone(phone))}`,
            when,
          ].join("\n"),
        ),
      });
      continue;
    }

    if (st === "ABANDONED") {
      const minutesAgo = Math.max(1, Math.round((end - at) / 60_000));
      events.push({
        at,
        event: "checkout_abandoned",
        phone,
        ref,
        buttons,
        html: wrapSeedHtml(
          [
            `🟡 <b>Started checkout, didn't pay</b> · ${escapeHtml(name)}`,
            `${escapeHtml(course)} · opened ${minutesAgo} min ago`,
            `${escapeHtml(maskPhone(phone))} · ${when}`,
          ].join("\n"),
        ),
      });
      continue;
    }

    // Open checkouts today (≥30m, still unpaid) — same as live abandon semantics
    if (
      (st === "INITIATED" || st === "PENDING" || st === "UNCONFIRMED") &&
      !p.is_superseded &&
      end - at >= 30 * 60_000
    ) {
      const paidLater = pays.some(
        (x) =>
          !x.deleted_at &&
          isPaidStatus(x.status) &&
          phone10(x.phone) === phone &&
          (x.item_slug === p.item_slug || x.item === p.item) &&
          new Date(x.created_at).getTime() >= at,
      );
      if (!paidLater) {
        const minutesAgo = Math.max(1, Math.round((end - at) / 60_000));
        events.push({
          at,
          event: "checkout_abandoned",
          phone,
          ref,
          buttons,
          html: wrapSeedHtml(
            [
              `🟡 <b>Started checkout, didn't pay</b> · ${escapeHtml(name)}`,
              `${escapeHtml(course)} · opened ${minutesAgo} min ago`,
              `${escapeHtml(maskPhone(phone))} · ${when}`,
            ].join("\n"),
          ),
        });
      }
      continue;
    }

    if (isPaidStatus(p.status) && p.item_type === "course") {
      if (p.payment_kind === "installment") {
        events.push({
          at,
          event: "installment_paid",
          phone,
          ref,
          buttons,
          html: wrapSeedHtml(
            [
              `✅ <b>Instalment paid</b> · ${escapeHtml(name)}`,
              `${escapeHtml(course)} · Inst ${p.installment_no ?? "?"} · ${salesInr(Number(p.amount) || 0)}`,
              `${escapeHtml(maskPhone(phone))} · ${when}`,
            ].join("\n"),
          ),
        });
      } else {
        // seat / full / one_time → admission + payment succeeded (one message: admission)
        events.push({
          at,
          event: "admission",
          phone,
          ref,
          buttons,
          html: wrapSeedHtml(
            [
              `🟢 <b>New admission</b> · ${escapeHtml(name)}`,
              `${escapeHtml(course)} · ${salesInr(Number(p.amount) || 0)} · ${escapeHtml(maskPhone(phone))}`,
              when,
            ].join("\n"),
          ),
        });
        // Also mark payment_succeeded dedupe so live never doubles
        events.push({
          at: at + 1,
          event: "payment_succeeded",
          phone,
          ref: `${ref}:succeeded`,
          buttons,
          html: wrapSeedHtml(
            [
              `💚 <b>Payment succeeded</b> · ${escapeHtml(name)}`,
              `${escapeHtml(course)} · ${salesInr(Number(p.amount) || 0)} · ${escapeHtml(maskPhone(phone))}`,
              when,
            ].join("\n"),
          ),
        });
      }
    }
  }

  // Instalment proofs today
  if (db) {
    try {
      const { data: proofs } = await db
        .from("installment_payment_proofs")
        .select("id,phone,student_id,course_enrollment_id,installment_no,claimed_amount,expected_amount,created_at,status")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true })
        .limit(200);
      for (const pr of proofs || []) {
        const phone = phone10(String(pr.phone || ""));
        if (!phone) continue;
        const at = new Date(String(pr.created_at)).getTime();
        if (at < startMs || at > end) continue;
        const amt = pr.claimed_amount ?? pr.expected_amount ?? null;
        const link = adminStudentDeepLink({
          studentId: pr.student_id ? String(pr.student_id) : null,
          enrollmentId: pr.course_enrollment_id ? String(pr.course_enrollment_id) : null,
          phone,
          proofId: String(pr.id),
          review: "installment_proof",
        });
        events.push({
          at,
          event: "installment_proof_uploaded",
          phone,
          ref: String(pr.id),
          buttons: [{ label: "Review", url: link }],
          html: wrapSeedHtml(
            [
              `📎 <b>Proof uploaded — needs review</b> · Student`,
              `Instalment ${pr.installment_no ?? "?"} · ${salesInr(amt != null ? Number(amt) : null)} · ${escapeHtml(maskPhone(phone))}`,
              formatIstShort(String(pr.created_at)),
            ].join("\n"),
          ),
        });
      }
    } catch {
      /* optional */
    }

    // Webinar payment proofs (payment_proofs table) if present
    try {
      const { data: wproofs } = await db
        .from("payment_proofs")
        .select("id,phone,payment_id,created_at")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .limit(100);
      for (const pr of wproofs || []) {
        const phone = phone10(String(pr.phone || ""));
        if (!phone) continue;
        const pay = pays.find((p) => p.id === pr.payment_id);
        if (pay && pay.item_type !== "webinar") continue;
        const at = new Date(String(pr.created_at)).getTime();
        if (at < startMs || at > end) continue;
        events.push({
          at,
          event: "webinar_proof_uploaded",
          phone,
          ref: String(pr.id),
          buttons: [{ label: "Review", url: adminStudentDeepLink({ phone, proofId: String(pr.id), review: "payment_proof" }) }],
          html: wrapSeedHtml(
            [
              `📎 <b>Webinar proof uploaded</b> · ${escapeHtml(pay?.student_name || "Student")}`,
              `${escapeHtml(maskPhone(phone))} · ${formatIstShort(String(pr.created_at))}`,
            ].join("\n"),
          ),
        });
      }
    } catch {
      /* optional table */
    }
  }

  events.sort((a, b) => a.at - b.at || a.ref.localeCompare(b.ref));

  // Cap: keep most recent N
  let omitted = 0;
  let capped = events;
  if (events.length > SEED_CAP) {
    omitted = events.length - SEED_CAP;
    capped = events.slice(events.length - SEED_CAP);
  }

  return { ymd, startIso, endIso, events: capped, omitted };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(
  html: string,
  buttons: { label: string; url: string }[],
): Promise<{ ok: boolean; messageId: number | null; error?: string }> {
  for (let i = 0; i < 4; i++) {
    const res = await sendToChannel("sales", {
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: true,
      reply_markup: buildKeyboard(buttons.map((b) => ({ label: b.label, url: b.url }))),
    });
    if (res.ok) {
      const mid = (res.result as { message_id?: number } | undefined)?.message_id ?? null;
      return { ok: true, messageId: mid };
    }
    if (res.isRateLimited || res.error_code === 429) {
      const wait = Math.max(1000, (res.retryAfterSec || 5) * 1000);
      await sleep(wait);
      continue;
    }
    return { ok: false, messageId: null, error: res.description || "send_failed" };
  }
  return { ok: false, messageId: null, error: "rate_limit_exhausted" };
}

export async function runSalesTodaySeed(opts: {
  dryRun?: boolean;
  confirm?: boolean;
}): Promise<{
  ok: boolean;
  dryRun: boolean;
  alreadyComplete: boolean;
  ymd: string;
  planned: number;
  posted: number;
  skipped: number;
  failed: number;
  omitted: number;
  oldestAt: string | null;
  newestAt: string | null;
  digestPosted: boolean;
  digestPinned: boolean;
  preview: { event: string; at: string; phoneMasked: string; ref: string }[];
}> {
  const dryRun = !!opts.dryRun || !opts.confirm;
  const collected = await collectTodaySalesSeedEvents();
  const preview = collected.events.map((e) => ({
    event: e.event,
    at: new Date(e.at).toISOString(),
    phoneMasked: maskPhone(e.phone),
    ref: e.ref,
  }));
  const oldestAt = collected.events[0] ? new Date(collected.events[0].at).toISOString() : null;
  const newestAt = collected.events.length
    ? new Date(collected.events[collected.events.length - 1]!.at).toISOString()
    : null;

  if (await seedRunAlreadyComplete(collected.ymd)) {
    const finish = dryRun
      ? { digestPosted: false, digestPinned: false }
      : await finishSalesSeedDigest(collected.ymd);
    return {
      ok: true,
      dryRun,
      alreadyComplete: true,
      ymd: collected.ymd,
      planned: collected.events.length,
      posted: 0,
      skipped: collected.events.length,
      failed: 0,
      omitted: collected.omitted,
      oldestAt,
      newestAt,
      digestPosted: finish.digestPosted,
      digestPinned: finish.digestPinned,
      preview,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      alreadyComplete: false,
      ymd: collected.ymd,
      planned: collected.events.length,
      posted: 0,
      skipped: 0,
      failed: 0,
      omitted: collected.omitted,
      oldestAt,
      newestAt,
      digestPosted: false,
      digestPinned: false,
      preview,
    };
  }

  if (!salesChannelConfigured()) {
    return {
      ok: false,
      dryRun: false,
      alreadyComplete: false,
      ymd: collected.ymd,
      planned: collected.events.length,
      posted: 0,
      skipped: 0,
      failed: collected.events.length,
      omitted: collected.omitted,
      oldestAt,
      newestAt,
      digestPosted: false,
      digestPinned: false,
      preview,
    };
  }

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const ev of collected.events) {
    try {
      if (await msgAlreadyPosted(ev)) {
        skipped++;
        continue;
      }
      const res = await sendWithRetry(ev.html, ev.buttons);
      if (res.ok) {
        await markMsgPosted(ev);
        posted++;
      } else {
        failed++;
        tgLog("sales_seed_send_failed", { event: ev.event, ref: ev.ref, error: res.error }, "warn");
      }
      await sleep(THROTTLE_MS);
    } catch (e) {
      failed++;
      tgLog("sales_seed_exception", { event: ev.event, error: (e as Error).message }, "error");
    }
  }

  // Digest LAST
  let digestPosted = false;
  let digestPinned = false;
  try {
    let html = await buildSalesDigestHtml();
    if (collected.omitted > 0) {
      html += `\n\n<i>Seed note: ${collected.omitted} earlier event(s) omitted (cap ${SEED_CAP}).</i>`;
    }
    html = `${SEED_PREFIX} · seeded summary\n${html}`;
    const base = (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
    const res = await sendWithRetry(html, [
      { label: "Admissions", url: `${base}/admin/course-payments` },
      { label: "Access at Risk", url: `${base}/admin/access-risk` },
    ]);
    digestPosted = res.ok;
    if (res.ok && res.messageId != null) {
      const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
      if (chatId) {
        const pin = await pinChatMessage(chatId, res.messageId);
        digestPinned = !!pin.ok;
      }
    }
    if (digestPosted) {
      const db = getSupabaseAdmin();
      if (db) {
        await db.from("telegram_report_snapshots").upsert(
          {
            slot_key: `sales:seed:digest:${collected.ymd}`,
            kind: "sales_seed_digest",
            metrics: { digestPosted, digestPinned, ymd: collected.ymd },
          },
          { onConflict: "slot_key" },
        );
      }
    }
  } catch (e) {
    tgLog("sales_seed_digest_failed", { error: (e as Error).message }, "error");
  }

  await markSeedProgress(collected.ymd, {
    complete: true,
    posted,
    skipped,
    failed,
    omitted: collected.omitted,
    digestPosted,
    digestPinned,
    finished_at: new Date().toISOString(),
  });

  return {
    ok: true,
    dryRun: false,
    alreadyComplete: false,
    ymd: collected.ymd,
    planned: collected.events.length,
    posted,
    skipped,
    failed,
    omitted: collected.omitted,
    oldestAt,
    newestAt,
    digestPosted,
    digestPinned,
    preview,
  };
}

/** Post/pin seed digest only if not yet recorded (safe after interrupted seed). */
export async function finishSalesSeedDigest(ymd = SEED_DAY): Promise<{
  ok: boolean;
  digestPosted: boolean;
  digestPinned: boolean;
  skipped: boolean;
}> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, digestPosted: false, digestPinned: false, skipped: false };
  const digestKey = `sales:seed:digest:${ymd}`;
  const { data: existing } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", digestKey).maybeSingle();
  if ((existing?.metrics as { digestPosted?: boolean } | null)?.digestPosted) {
    return {
      ok: true,
      digestPosted: true,
      digestPinned: !!(existing?.metrics as { digestPinned?: boolean }).digestPinned,
      skipped: true,
    };
  }

  let digestPosted = false;
  let digestPinned = false;
  try {
    let html = await buildSalesDigestHtml();
    html = `${SEED_PREFIX} · seeded summary\n${html}`;
    const base = (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
    const res = await sendWithRetry(html, [
      { label: "Admissions", url: `${base}/admin/course-payments` },
      { label: "Access at Risk", url: `${base}/admin/access-risk` },
    ]);
    digestPosted = res.ok;
    if (res.ok && res.messageId != null) {
      const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
      if (chatId) {
        const pin = await pinChatMessage(chatId, res.messageId);
        digestPinned = !!pin.ok;
      }
    }
  } catch (e) {
    tgLog("sales_seed_digest_finish_failed", { error: (e as Error).message }, "error");
  }

  if (digestPosted) {
    await db.from("telegram_report_snapshots").upsert(
      {
        slot_key: digestKey,
        kind: "sales_seed_digest",
        metrics: { digestPosted, digestPinned, ymd },
      },
      { onConflict: "slot_key" },
    );
  }
  return { ok: digestPosted, digestPosted, digestPinned, skipped: false };
}

/** Prove live path would no-op on a seeded phone+event. */
export async function proveSeedDedup(phone: string, event: SalesEventType): Promise<boolean> {
  return alreadyDeduped(event, phone);
}

export { SEED_CAP, SEED_DAY, salesDedupKey };
