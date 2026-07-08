/**
 * Server-side analytics core: a single idempotent, NEVER-throwing event writer
 * plus the business emitters that hook our existing payment/identity flows.
 *
 * Hard guarantees:
 *  - No-ops cleanly in demo mode (no Supabase) — never breaks a flow.
 *  - Never throws into a caller (all DB work guarded).
 *  - Idempotent milestones via `dedupe_key` unique index (Purchase fires once).
 *  - Stores UTC `occurred_at` (rendered IST at the edges).
 */
import { getSupabaseAdmin } from "../supabase";
import { SITE_URL } from "../config";
import { normPhone } from "../phone";
import { flattenForStamp, metaIdentityFromState, type AttributionState } from "../attribution";
import { sendMetaPurchase, sendMetaLead, sendMetaInitiateCheckout } from "./thirdParty";
import { fireAutoSms } from "../sms/dispatch";
import { TRIGGERS } from "../sms/templates";
import { supersedeUnpaidSiblings } from "../paymentSupersede";
import type { EventName } from "./events";
import type { Payment, Buyer } from "../types";

/** Map a payment's item to the related-entity id used by SMS logs. */
function smsEntityForPayment(p: Payment): { payment_id: string; course_id?: string | null; webinar_id?: string | null; student_name: string | null } {
  return {
    payment_id: p.id,
    course_id: p.item_type === "course" ? p.item_slug ?? null : null,
    webinar_id: p.item_type === "webinar" ? p.item_slug ?? null : null,
    student_name: p.student_name ?? null,
  };
}

export interface DeviceInfo { type: string; os: string; browser: string }

const BOT_RE = /bot|crawl|spider|slurp|bing|yandex|baidu|duckduck|facebookexternalhit|preview|monitor|headless|python-requests|curl|wget|axios|node-fetch|lighthouse|gtmetrix|pingdom|uptime/i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua) return true; // no UA on a page beacon is almost always a bot/script
  return BOT_RE.test(ua);
}

export function parseDevice(ua: string | null | undefined): DeviceInfo {
  const s = ua || "";
  const type = /mobile|iphone|android.*mobile/i.test(s)
    ? "mobile"
    : /ipad|tablet/i.test(s)
    ? "tablet"
    : s
    ? "desktop"
    : "unknown";
  const os = /windows/i.test(s) ? "Windows"
    : /android/i.test(s) ? "Android"
    : /iphone|ipad|ios/i.test(s) ? "iOS"
    : /mac os/i.test(s) ? "macOS"
    : /linux/i.test(s) ? "Linux"
    : "Other";
  const browser = /edg/i.test(s) ? "Edge"
    : /chrome|crios/i.test(s) ? "Chrome"
    : /firefox|fxios/i.test(s) ? "Firefox"
    : /safari/i.test(s) ? "Safari"
    : "Other";
  return { type, os, browser };
}

export interface WriteEventInput {
  event_name: EventName;
  visitor_id?: string | null;
  buyer_id?: string | null;
  phone?: string | null;
  session_id?: string | null;
  occurred_at?: string;
  page_path?: string | null;
  referrer?: string | null;
  device?: DeviceInfo | null;
  is_bot?: boolean;
  attribution?: unknown;
  props?: Record<string, unknown>;
  dedupe_key?: string | null;
}

/**
 * Insert one event. Returns true only when a NEW row was written (false on
 * dedupe-hit or any failure) — callers use this to fire once-only side effects.
 */
export async function writeEvent(input: WriteEventInput): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const row = {
      event_name: input.event_name,
      visitor_id: input.visitor_id || null,
      buyer_id: input.buyer_id || null,
      phone: normPhone(input.phone),
      session_id: input.session_id || null,
      occurred_at: input.occurred_at || new Date().toISOString(),
      page_path: input.page_path || null,
      referrer: input.referrer || null,
      device: input.device || null,
      is_bot: input.is_bot ?? false,
      attribution: input.attribution ?? null,
      props: input.props || {},
      dedupe_key: input.dedupe_key || null,
    };
    const { error } = await db.from("analytics_events").insert(row);
    if (error) return false; // unique-violation (dedupe) or transient — swallow
    return true;
  } catch {
    return false;
  }
}

/** Fire-and-forget: schedule a write without ever blocking/throwing the caller. */
export function track(input: WriteEventInput): void {
  void writeEvent(input).catch(() => {});
}

async function resolveBuyerId(phone: string | null): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db || !phone) return null;
  try {
    const { data } = await db.from("buyers").select("id").eq("phone", phone).maybeSingle();
    return (data?.id as string) || null;
  } catch {
    return null;
  }
}

function paymentAttribution(p: Payment): { source: string | null; campaign: string | null } {
  return { source: p.attribution_source ?? null, campaign: p.attribution_campaign ?? null };
}

/** payment_initiated (idempotent per ref). Called when a PENDING row is created. */
export async function recordPaymentInitiated(p: Payment): Promise<void> {
  const ref = p.reference_no || p.id;
  const phone = normPhone(p.phone);
  await writeEvent({
    event_name: "payment_initiated",
    phone,
    buyer_id: await resolveBuyerId(phone),
    dedupe_key: `init:${ref}`,
    attribution: paymentAttribution(p),
    props: {
      payment_ref: ref, item_type: p.item_type, item_slug: p.item_slug ?? null,
      amount: p.amount, payment_kind: p.payment_kind ?? null, installment_no: p.installment_no ?? null,
    },
  });
  // Meta InitiateCheckout (server) — dedupes with the browser pixel via ic_<ref>.
  await sendMetaInitiateCheckout(p, await lookupMetaMatch(phone)).catch(() => {});
}

/** A generic status transition (idempotent per ref+status). */
export async function recordPaymentStatusChanged(p: Payment, toStatus: string, source = "system"): Promise<void> {
  const ref = p.reference_no || p.id;
  const phone = normPhone(p.phone);
  await writeEvent({
    event_name: "payment_status_changed",
    phone,
    buyer_id: await resolveBuyerId(phone),
    dedupe_key: `status:${ref}:${toStatus}`,
    attribution: paymentAttribution(p),
    props: {
      payment_ref: ref, item_type: p.item_type, item_slug: p.item_slug ?? null, amount: p.amount,
      to_status: toStatus, payment_kind: p.payment_kind ?? null, installment_no: p.installment_no ?? null,
      channel: p.gateway || "icici_eazypay", source,
    },
  });
  // Auto-SMS (disabled by default): payment failed.
  if (toStatus === "FAILED") {
    fireAutoSms({ trigger: TRIGGERS.payment_failed, phone: p.phone, name: p.student_name, vars: { item_short: p.item }, entity: smsEntityForPayment(p), entityId: ref });
  }
}

/**
 * payment_paid (idempotent per ref). Fires the ->PAID status change, the paid
 * milestone, backfills buyer source, and — ONLY on the first write — the real
 * Meta Purchase. Safe to call from callback / verify / cron / proof-accept /
 * free / offline; the dedupe_key guarantees once.
 */
export async function recordPaymentPaid(p: Payment, source = "system"): Promise<void> {
  const ref = p.reference_no || p.id;
  const phone = normPhone(p.phone);
  const buyerId = await resolveBuyerId(phone);
  await recordPaymentStatusChanged(p, "PAID", source);
  const newlyPaid = await writeEvent({
    event_name: "payment_paid",
    phone,
    buyer_id: buyerId,
    dedupe_key: `paid:${ref}`,
    attribution: paymentAttribution(p),
    props: {
      payment_ref: ref, item_type: p.item_type, item_slug: p.item_slug ?? null,
      amount: p.amount, payment_kind: p.payment_kind ?? null, installment_no: p.installment_no ?? null,
    },
  });
  if (newlyPaid) {
    await backfillBuyerSource(phone, p.attribution_source ?? null, p.attribution_campaign ?? null);
    // Meta Purchase — fired ONCE from this verified-PAID chokepoint, carrying the
    // SAME reconciled rupee amount. Matched via the buyer's stored fbc/fbp (no PII
    // unless G1 is enabled). Inert until CAPI keys are set. Never blocks the flow.
    await sendMetaPurchase(p, await lookupMetaMatch(phone)).catch(() => {});
    // Paid wins: flag the other open unpaid attempts for this same student+item+
    // purpose as superseded so a PAID group is never mislabelled "needs action".
    // Idempotent; touches only this group; logged to payment_action_log.
    void supersedeUnpaidSiblings(p).catch(() => {});
    // Auto-SMS (disabled by default) — fired ONLY from this verified-PAID
    // chokepoint, once per payment (dedupe_key), never off a click/intent.
    fireAutoSms({ trigger: TRIGGERS.payment_success, phone: p.phone, name: p.student_name, vars: { item_short: p.item, payment_status: "PAID", amount: p.amount }, entity: smsEntityForPayment(p), entityId: ref });
    if (p.item_type === "course") {
      fireAutoSms({ trigger: TRIGGERS.course_enrolled, phone: p.phone, name: p.student_name, vars: { item_short: p.item }, entity: smsEntityForPayment(p), entityId: ref });
    } else if (p.item_type === "webinar") {
      // PAID-WEBINAR confirmation fires HERE, from the verified-PAID chokepoint —
      // never at registration time (payment is unresolved then). registerWebinar
      // suppresses the registration-time send for paid webinars so this is the one
      // and only "Webinar Registered" for a paid seat. Free webinars still confirm
      // at registration (registration == confirmation). Once per payment (dedupe).
      fireAutoSms({ trigger: TRIGGERS.registration_created, phone: p.phone, name: p.student_name, vars: { item_short: p.item }, entity: smsEntityForPayment(p), entityId: ref });
    }
  }
}

/** payment_abandoned (idempotent per ref) — derived by the reconcile cron. */
export async function recordPaymentAbandoned(p: Payment, minutesSinceInitiated: number): Promise<void> {
  const ref = p.reference_no || p.id;
  await writeEvent({
    event_name: "payment_abandoned",
    phone: normPhone(p.phone),
    dedupe_key: `abandoned:${ref}`,
    attribution: paymentAttribution(p),
    props: {
      payment_ref: ref, item_type: p.item_type, item_slug: p.item_slug ?? null,
      amount: p.amount, minutes_since_initiated: Math.round(minutesSinceInitiated),
    },
  });
}

export async function recordProofUploaded(p: Payment, proofId: string): Promise<void> {
  const ref = p.reference_no || p.id;
  await writeEvent({
    event_name: "payment_proof_uploaded",
    phone: normPhone(p.phone),
    dedupe_key: `proof:${proofId}`,
    props: { payment_ref: ref, proof_id: proofId, item_type: p.item_type, item_slug: p.item_slug ?? null },
  });
  // Auto-SMS (disabled by default): payment proof received.
  fireAutoSms({ trigger: TRIGGERS.proof_uploaded, phone: p.phone, name: p.student_name, vars: { item_short: p.item }, entity: smsEntityForPayment(p), entityId: ref });
}

export async function recordStaffReview(p: Payment, decision: "approved" | "rejected", staffId: string | null, reason?: string | null): Promise<void> {
  const ref = p.reference_no || p.id;
  await writeEvent({
    event_name: "staff_review",
    phone: normPhone(p.phone),
    props: { payment_ref: ref, decision, staff_id: staffId, reason: reason || null },
  });
  // Auto-SMS (disabled by default): access approved on manual acceptance.
  if (decision === "approved") {
    fireAutoSms({ trigger: TRIGGERS.admin_approval, phone: p.phone, name: p.student_name, vars: { item_short: p.item }, entity: smsEntityForPayment(p), entityId: ref });
  }
}

export async function recordRegistrationCreated(reg: { id?: string; webinar_id: string; webinar_slug?: string | null; phone: string; price?: number; is_free?: boolean; attribution?: AttributionState | null }): Promise<void> {
  const phone = normPhone(reg.phone);
  await writeEvent({
    event_name: "registration_created",
    phone,
    buyer_id: await resolveBuyerId(phone),
    dedupe_key: reg.id ? `reg:${reg.id}` : `reg:${reg.webinar_id}:${phone}`,
    // Carry the first-party attribution snapshot (first/last touch, incl. campaign
    // + Meta click ids) so leads attribute to the campaign that drove them. Same
    // {first_touch,last_touch} shape the client beacon writes — the Meta report
    // reads attribution.first_touch.campaign. Null when no cookie (honest untracked).
    attribution: reg.attribution ?? null,
    props: { registration_id: reg.id ?? null, webinar_id: reg.webinar_id, webinar_slug: reg.webinar_slug ?? null, phone, price: reg.price ?? 0, is_free: !!reg.is_free },
  });
  // Meta Lead (server) — the free-registration conversion. Paid webinars fire
  // Purchase from the PAID chokepoint instead; this Lead marks the free capture.
  // The id is DETERMINISTIC from webinar_id + phone so the browser pixel computes
  // the SAME lead_<...> event_id and Meta dedupes the two copies.
  const leadId = `${reg.webinar_id}:${phone ?? ""}`;
  const match = await lookupMetaMatch(phone);
  await sendMetaLead({
    id: leadId,
    phone,
    value: reg.price ?? 0,
    contentName: reg.webinar_slug ?? reg.webinar_id,
    fbc: match.fbc,
    fbp: match.fbp,
    eventSourceUrl: reg.webinar_slug ? `${SITE_URL}/webinars/${reg.webinar_slug}` : `${SITE_URL}/webinars`,
  }).catch(() => {});
}

/**
 * Look up the Meta non-PII match keys (fbc/fbp) we persisted onto the buyer's
 * attribution touches at landing. This is what bridges the click→payment gap for
 * server-side CAPI without any PII. Never throws; returns nulls on any miss.
 */
async function lookupMetaMatch(phone: string | null): Promise<{ fbc: string | null; fbp: string | null }> {
  const db = getSupabaseAdmin();
  const ph = normPhone(phone);
  if (!db || !ph) return { fbc: null, fbp: null };
  try {
    const { data } = await db.from("buyers").select("first_touch,last_touch").eq("phone", ph).maybeSingle();
    if (!data) return { fbc: null, fbp: null };
    const id = metaIdentityFromState({
      first_touch: (data.first_touch as AttributionState["first_touch"]) ?? null,
      last_touch: (data.last_touch as AttributionState["last_touch"]) ?? null,
    });
    return { fbc: id.fbc, fbp: id.fbp };
  } catch {
    return { fbc: null, fbp: null };
  }
}

/** Set buyer.attribution_source only if empty (first-touch wins). */
async function backfillBuyerSource(phone: string | null, source: string | null, campaign: string | null): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db || !phone || !source) return;
  try {
    const { data } = await db.from("buyers").select("id,attribution_source").eq("phone", phone).maybeSingle();
    if (data && !data.attribution_source) {
      await db.from("buyers").update({ attribution_source: source, attribution_campaign: campaign }).eq("id", data.id);
    }
  } catch { /* ignore */ }
}

/**
 * Stamp first-touch (frozen) + last-touch (rolling) + normalized source onto a
 * buyer. Called at request entry points (login/payment/registration) where the
 * first-party cookie is readable. First-touch is never overwritten.
 */
export async function stampBuyerAttribution(phone: string | null | undefined, attr: AttributionState | null): Promise<void> {
  const db = getSupabaseAdmin();
  const ph = normPhone(phone);
  if (!db || !ph || !attr) return;
  try {
    const flat = flattenForStamp(attr);
    const { data } = await db.from("buyers").select("id,first_touch,attribution_source").eq("phone", ph).maybeSingle();
    if (!data) return;
    const patch: Record<string, unknown> = { last_touch: flat.last_touch, last_seen_at: new Date().toISOString() };
    if (!data.first_touch && flat.first_touch) patch.first_touch = flat.first_touch;
    if (!data.attribution_source && flat.source) { patch.attribution_source = flat.source; patch.attribution_campaign = flat.campaign; }
    await db.from("buyers").update(patch).eq("id", data.id);
  } catch { /* ignore */ }
}

/**
 * KEY stitch moment — code-proven login only. Merge this visitor's anon events
 * into the buyer (by visitor_id), emit login + identity_stitched. Respects the
 * quizOwner rule: we never merge two real people on a shared phone/device
 * without this proven login.
 */
export async function stitchIdentityOnLogin(opts: {
  visitorId: string | null;
  buyer: Pick<Buyer, "id" | "phone">;
  matchedVia?: "login" | "registration" | "payment";
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const phone = normPhone(opts.buyer.phone);
  let merged = 0;
  try {
    if (opts.visitorId) {
      const { data } = await db
        .from("analytics_events")
        .update({ buyer_id: opts.buyer.id, phone })
        .is("buyer_id", null)
        .eq("visitor_id", opts.visitorId)
        .select("event_id");
      merged = data?.length || 0;
    }
  } catch { /* ignore */ }
  await writeEvent({
    event_name: "login",
    visitor_id: opts.visitorId,
    buyer_id: opts.buyer.id,
    phone,
    props: { method: "login_code", buyer_id: opts.buyer.id, is_returning: merged > 0 },
  });
  await writeEvent({
    event_name: "identity_stitched",
    visitor_id: opts.visitorId,
    buyer_id: opts.buyer.id,
    phone,
    props: { visitor_id: opts.visitorId, buyer_id: opts.buyer.id, phone, matched_via: opts.matchedVia || "login", events_merged_count: merged },
  });
  // Auto-SMS (disabled by default): welcome / first login. The dedupe_key keyed
  // on the buyer id ensures this fires at most once, ever.
  fireAutoSms({ trigger: TRIGGERS.first_login, phone: opts.buyer.phone, entity: { user_id: opts.buyer.id }, entityId: opts.buyer.id });
}

export async function recordLogout(buyerId: string | null, visitorId: string | null): Promise<void> {
  await writeEvent({ event_name: "logout", visitor_id: visitorId, buyer_id: buyerId, props: { buyer_id: buyerId, confirmed: true } });
}
