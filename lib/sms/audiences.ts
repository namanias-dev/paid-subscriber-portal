/**
 * Audience resolvers for manual/bulk + cron sends. REUSES dataProvider + the
 * existing paymentsAgg dedupe so recipient counts and "paid" segments reconcile
 * with the Payments tab. Every recipient is deduped by normalized 10-digit mobile.
 */
import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
import { formatISTTime } from "../dates";
import {
  getPayments, getLeads, getBuyers, getWebinars, getWebinarBySlug,
  getWebinarRegistrationsByWebinar, getWebinarPaymentStatusesForSlug,
} from "../dataProvider";
import { isPaidStatus, dedupePaidRows, itemKey } from "../paymentsAgg";
import { firstNamesMatch } from "./store";
import type { RelatedEntity } from "./service";
import type { Payment } from "../types";

export interface Recipient {
  mobile: string;
  normalized: string;
  name: string | null;
  vars: Record<string, string | number | null | undefined>;
  entity: RelatedEntity;
}

export type AudienceType =
  | "person"
  | "payment_pending" | "payment_failed" | "payment_paid" | "payment_abandoned" | "payment_all"
  | "webinar_registered" | "webinar_not_registered" | "webinar_attendees" | "webinar_no_show"
  | "leads" | "users_with_mobile" | "all";

export interface AudienceSpec {
  type: AudienceType;
  webinarId?: string | null;
  webinarSlug?: string | null;
  source?: string | null;   // lead source filter
  stage?: string | null;    // lead status filter
  mobile?: string | null;   // for "person"
  name?: string | null;     // for "person"
}

export const AUDIENCE_OPTIONS: { type: AudienceType; label: string; needsWebinar?: boolean; promotionalForCold?: boolean }[] = [
  { type: "person", label: "A specific person" },
  { type: "payment_pending", label: "Payments — Pending" },
  { type: "payment_failed", label: "Payments — Failed" },
  { type: "payment_paid", label: "Payments — Paid" },
  { type: "payment_abandoned", label: "Payments — Abandoned" },
  { type: "payment_all", label: "Payments — All" },
  { type: "webinar_registered", label: "Webinar — Registered", needsWebinar: true },
  { type: "webinar_not_registered", label: "Webinar — NOT registered (with mobile)", needsWebinar: true, promotionalForCold: true },
  { type: "webinar_attendees", label: "Webinar — Attended", needsWebinar: true },
  { type: "webinar_no_show", label: "Webinar — No-show", needsWebinar: true },
  { type: "leads", label: "Leads (by source / stage)" },
  { type: "users_with_mobile", label: "All users with a mobile" },
  { type: "all", label: "Everyone (guarded)" },
];

function norm(phone: string | null | undefined): string | null {
  const n = normalizeIndianMobile(phone);
  return n.ok && n.digits10 ? n.digits10 : null;
}

/**
 * phone(10) -> { name, login_code, ambiguous } from buyers. When two buyers share
 * a number the entry is flagged `ambiguous` and its login_code is dropped, so we
 * never attach a code we can't attribute to one person (Issue 2).
 */
async function buyerMap(): Promise<Map<string, { name: string | null; login_code: string | null; ambiguous: boolean }>> {
  const map = new Map<string, { name: string | null; login_code: string | null; ambiguous: boolean }>();
  try {
    for (const b of await getBuyers()) {
      const d = norm(b.phone);
      if (!d) continue;
      const existing = map.get(d);
      if (existing) { existing.ambiguous = true; existing.login_code = null; }
      else map.set(d, { name: b.name, login_code: b.login_code, ambiguous: false });
    }
  } catch { /* ignore */ }
  return map;
}

/** Set of normalized phones that clicked the real Zoom button for a webinar slug. */
async function zoomClickedPhones(webinarSlug: string | null): Promise<Set<string>> {
  const set = new Set<string>();
  const db = getSupabaseAdmin();
  if (!db || !webinarSlug) return set;
  try {
    const { data } = await db.from("analytics_events").select("phone,props").eq("event_name", "zoom_link_clicked").not("phone", "is", null).limit(20000);
    for (const r of (data as { phone: string; props: { webinar_slug?: string } | null }[]) || []) {
      if (String(r.props?.webinar_slug || "").toLowerCase() === webinarSlug.toLowerCase()) {
        const d = norm(r.phone);
        if (d) set.add(d);
      }
    }
  } catch { /* ignore */ }
  return set;
}

function paymentVars(p: Payment): Record<string, string> {
  return { item_short: p.item || p.item_slug || "your purchase", item_name: p.item || "", amount: String(p.amount ?? ""), payment_status: p.status };
}

function dedupeRecipients(list: Recipient[]): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const r of list) if (!seen.has(r.normalized)) seen.set(r.normalized, r);
  return [...seen.values()];
}

export async function resolveAudience(spec: AudienceSpec): Promise<Recipient[]> {
  const bm = await buyerMap();
  const attach = (digits: string, name: string | null, vars: Record<string, string | number | null | undefined>, entity: RelatedEntity): Recipient => {
    const b = bm.get(digits);
    const finalName = name || b?.name || null;
    // Only attach a login_code we can attribute to THIS recipient: exactly one
    // buyer on the number AND (when an intended name is known) the names agree.
    // Otherwise leave it empty so code-bearing templates fail-closed rather than
    // sending the wrong person's code (Issue 2).
    let login_code = "";
    if (b && !b.ambiguous && b.login_code && (!name || firstNamesMatch(name, b.name))) {
      login_code = b.login_code;
    }
    return {
      mobile: digits, normalized: digits,
      name: finalName,
      vars: { name: finalName || "", login_code, ...vars },
      entity: { student_name: finalName, ...entity },
    };
  };

  // ----- specific person -----
  if (spec.type === "person") {
    const d = norm(spec.mobile);
    if (!d) return [];
    return [attach(d, spec.name || null, {}, {})];
  }

  // ----- payment segments (reconciled via paymentsAgg) -----
  if (spec.type.startsWith("payment_")) {
    const payments = await getPayments();
    let rows: Payment[];
    // Superseded attempts (another attempt for the same student+item was paid)
    // must never be nudged — they are moot. Only un-superseded rows are eligible.
    if (spec.type === "payment_paid") rows = dedupePaidRows(payments.filter((p) => isPaidStatus(p.status)));
    else if (spec.type === "payment_pending") rows = payments.filter((p) => !p.is_superseded && (p.status === "PENDING" || p.status === "VERIFYING" || p.status === "pending"));
    else if (spec.type === "payment_failed") rows = payments.filter((p) => !p.is_superseded && p.status === "FAILED");
    else if (spec.type === "payment_abandoned") rows = payments.filter((p) => !p.is_superseded && p.status === "ABANDONED");
    else rows = payments; // payment_all
    // keep the most recent row per phone for messaging context
    const byPhone = new Map<string, Payment>();
    for (const p of rows) {
      const d = norm(p.phone);
      if (!d) continue;
      const prev = byPhone.get(d);
      if (!prev || new Date(p.created_at).getTime() > new Date(prev.created_at).getTime()) byPhone.set(d, p);
    }
    return dedupeRecipients([...byPhone.entries()].map(([d, p]) =>
      attach(d, p.student_name, paymentVars(p), { payment_id: p.id, course_id: p.item_type === "course" ? p.item_slug : null, webinar_id: p.item_type === "webinar" ? p.item_slug : null })));
  }

  // ----- webinar segments -----
  if (spec.type.startsWith("webinar_")) {
    const webinar = spec.webinarSlug ? await getWebinarBySlug(spec.webinarSlug) : (await getWebinars()).find((w) => w.id === spec.webinarId) || null;
    if (!webinar) return [];
    const vars = { item_short: webinar.title, item_name: webinar.title, webinar_time: formatISTTime(webinar.datetime), webinar_date: webinar.datetime };
    const regs = await getWebinarRegistrationsByWebinar(webinar.id);
    const regByPhone = new Map<string, { name: string | null; id: string; attended: boolean }>();
    for (const r of regs) { const d = norm(r.phone); if (d) regByPhone.set(d, { name: r.name, id: r.id, attended: !!r.attended }); }
    const zoom = await zoomClickedPhones(webinar.slug);

    // PAID webinars: a bare webinar_registrations lead row is NOT a confirmed seat.
    // Gate "Registered" to phones with a verified PAID payment for this slug (same
    // source of truth as the admin registrant list). Fail closed — PENDING / FAILED
    // / no-payment are excluded. FREE webinars (price<=0): registration == seat, so
    // no gating. This mirrors the paid-only confirmation rule (webinarStatus).
    if (spec.type === "webinar_registered") {
      const isPaidWebinar = (webinar.price ?? 0) > 0;
      const payByPhone = isPaidWebinar ? await getWebinarPaymentStatusesForSlug(webinar.slug) : null;
      return dedupeRecipients([...regByPhone.entries()]
        .filter(([d]) => !isPaidWebinar || payByPhone!.get(d) === "PAID")
        .map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
    }
    if (spec.type === "webinar_attendees") {
      return dedupeRecipients([...regByPhone.entries()].filter(([d, r]) => r.attended || zoom.has(d)).map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
    }
    if (spec.type === "webinar_no_show") {
      return dedupeRecipients([...regByPhone.entries()].filter(([d, r]) => !r.attended && !zoom.has(d)).map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
    }
    // not-registered: everyone with a mobile (buyers + leads) minus registered
    const universe = new Map<string, string | null>();
    for (const [d, b] of bm) universe.set(d, b.name);
    for (const l of await getLeads()) { const d = norm(l.phone); if (d && !universe.has(d)) universe.set(d, l.name); }
    return dedupeRecipients([...universe.entries()].filter(([d]) => !regByPhone.has(d)).map(([d, name]) => attach(d, name, vars, { webinar_id: webinar.id })));
  }

  // ----- leads -----
  if (spec.type === "leads") {
    let leads = await getLeads();
    if (spec.source) leads = leads.filter((l) => (l.source || "").toLowerCase() === spec.source!.toLowerCase());
    if (spec.stage) leads = leads.filter((l) => (l.status || "").toLowerCase() === spec.stage!.toLowerCase());
    return dedupeRecipients(leads.map((l) => { const d = norm(l.phone); return d ? attach(d, l.name, { item_short: l.course_interest || "" }, { lead_id: l.id }) : null; }).filter((x): x is Recipient => !!x));
  }

  // ----- users with mobile -----
  if (spec.type === "users_with_mobile") {
    return dedupeRecipients([...bm.entries()].map(([d, b]) => attach(d, b.name, {}, {})));
  }

  // ----- everyone (guarded) -----
  if (spec.type === "all") {
    const list: Recipient[] = [...bm.entries()].map(([d, b]) => attach(d, b.name, {}, {}));
    for (const l of await getLeads()) { const d = norm(l.phone); if (d) list.push(attach(d, l.name, {}, { lead_id: l.id })); }
    return dedupeRecipients(list);
  }

  return [];
}
