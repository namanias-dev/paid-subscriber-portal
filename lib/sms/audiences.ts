/**
 * Audience resolvers for manual/bulk + cron sends. REUSES dataProvider + the
 * existing paymentsAgg dedupe so recipient counts and "paid" segments reconcile
 * with the Payments tab. Every recipient is deduped by normalized 10-digit mobile.
 */
import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
import { formatISTTime, resolveTimeframe, type TimeframeValue } from "../dates";
import {
  getPayments, getLeads, getBuyers, getWebinars, getWebinarBySlug,
  getWebinarRegistrationsByWebinar, getWebinarPaymentStatusesForSlug,
  getAllCourses, getAllCourseEnrollments,
} from "../dataProvider";
import { isPaidStatus } from "../paymentsAgg";
import { firstNamesMatch, optedOutSet } from "./store";
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
  | "payment_pending" | "payment_failed" | "payment_paid" | "payment_abandoned" | "payment_not_paid" | "payment_all"
  | "webinar_registered" | "webinar_not_registered" | "webinar_attendees" | "webinar_no_show"
  | "leads" | "users_with_mobile" | "all"
  | "filtered";

/** Payment class used by the composable "filtered" audience (course/webinar/payments). */
export type FilterPayStatus = "paid" | "failed" | "pending" | "abandoned" | "notpaid";
export type FilterTimeframe = "7d" | "30d" | "6mo" | "all" | "month";

/**
 * Composable, intersecting filters for the "filtered" audience. Each active
 * dimension (course / webinar / payment status / timeframe) must be satisfied
 * independently — they narrow the set, never widen it. Empty/omitted = ignore.
 */
export interface FilterSpec {
  courseSlug?: string | null;
  webinarSlug?: string | null;
  paymentStatus?: FilterPayStatus | null;
  timeframe?: FilterTimeframe | null;
  month?: string | null; // "YYYY-MM" (IST) when timeframe === "month"
}

export interface AudienceSpec {
  type: AudienceType;
  webinarId?: string | null;
  webinarSlug?: string | null;
  source?: string | null;   // lead source filter
  stage?: string | null;    // lead status filter
  mobile?: string | null;   // for "person"
  name?: string | null;     // for "person"
  filters?: FilterSpec;     // for "filtered"
  /**
   * Optional timeframe scoping for PRESET segments (payment_* / webinar_* / leads
   * / users_with_mobile / all). Mirrors the Lead CRM filter. Scopes recipients by
   * the natural date of each segment (payment date, registration date, lead/buyer
   * created date). Null / mode "all" = no scoping (unchanged behaviour).
   */
  presetTimeframe?: TimeframeValue | null;
  /**
   * Restrict the resolved set to these normalized 10-digit phones (intersection).
   * Powers resend-to-failed: re-run the SAME audience so vars rebuild correctly,
   * but only for the failed numbers. All safeguards still apply downstream.
   */
  restrictTo?: string[] | null;
}

export const AUDIENCE_OPTIONS: { type: AudienceType; label: string; needsWebinar?: boolean; promotionalForCold?: boolean }[] = [
  { type: "person", label: "A specific person" },
  { type: "payment_pending", label: "Payments — Pending" },
  { type: "payment_failed", label: "Payments — Failed" },
  { type: "payment_paid", label: "Payments — Paid" },
  { type: "payment_abandoned", label: "Payments — Abandoned" },
  { type: "payment_not_paid", label: "Payments — NOT paid (no successful payment)" },
  { type: "payment_all", label: "Payments — All" },
  { type: "webinar_registered", label: "Webinar — Registered", needsWebinar: true },
  { type: "webinar_not_registered", label: "Webinar — NOT registered (with mobile)", needsWebinar: true, promotionalForCold: true },
  { type: "webinar_attendees", label: "Webinar — Attended", needsWebinar: true },
  { type: "webinar_no_show", label: "Webinar — No-show", needsWebinar: true },
  { type: "leads", label: "Leads (by source / stage)" },
  { type: "users_with_mobile", label: "All users with a mobile" },
  { type: "all", label: "Everyone (guarded)" },
  { type: "filtered", label: "Filtered (course / webinar / status / time frame)" },
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

/** phone(10) -> buyer created_at ms (for preset timeframe scoping of buyer audiences). */
async function buyerCreatedMsMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    for (const b of await getBuyers()) {
      const d = norm(b.phone);
      if (!d) continue;
      const ms = b.created_at ? new Date(b.created_at).getTime() : NaN;
      if (Number.isFinite(ms)) { const prev = map.get(d); if (prev == null || ms < prev) map.set(d, ms); }
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

/**
 * Public entry. Resolves the audience, then applies two universal narrowing
 * steps that NEVER widen the set:
 *   1. restrictTo — intersect with an explicit phone list (resend-to-failed).
 *   2. suppression — the DND/opt-out seam (no-op stub today; see applySuppression).
 * Everything downstream (sendBatch) still enforces every safeguard.
 */
export async function resolveAudience(spec: AudienceSpec): Promise<Recipient[]> {
  let recips = await resolveAudienceInner(spec);
  if (spec.restrictTo && spec.restrictTo.length) {
    const keep = new Set(spec.restrictTo.map((x) => norm(x)).filter((x): x is string => !!x));
    recips = recips.filter((r) => keep.has(r.normalized));
  }
  recips = await applySuppression(recips);
  return recips;
}

/**
 * Opt-out / DND suppression, applied centrally to EVERY resolved audience
 * (manual, filtered, cron, resend) so previews and counts reflect the real
 * deliverable set. The service layer (sendSms / sendBatch) re-checks the same
 * list at send time — this is defence-in-depth, not the only gate. Fail-open on
 * infra error (optedOutSet returns empty), never fail-closed on legitimate sends.
 */
async function applySuppression(recips: Recipient[]): Promise<Recipient[]> {
  if (!recips.length) return recips;
  const blocked = await optedOutSet(recips.map((r) => r.normalized));
  if (!blocked.size) return recips;
  return recips.filter((r) => !blocked.has(r.normalized));
}

type BuyerMap = Map<string, { name: string | null; login_code: string | null; ambiguous: boolean }>;
type AttachFn = (digits: string, name: string | null, vars: Record<string, string | number | null | undefined>, entity: RelatedEntity) => Recipient;

/** Build the shared recipient-attach closure (name + identity-safe login_code). */
function makeAttach(bm: BuyerMap): AttachFn {
  return (digits, name, vars, entity) => {
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
}

async function resolveAudienceInner(spec: AudienceSpec): Promise<Recipient[]> {
  if (spec.type === "filtered") return resolveFilteredAudience(spec.filters || {});
  const bm = await buyerMap();
  const attach = makeAttach(bm);

  // PRESET timeframe scoping (additive; only active when a non-"all" timeframe is
  // supplied). Filters recipients by the natural date of the segment.
  const ptf = spec.presetTimeframe && spec.presetTimeframe.mode !== "all"
    ? resolveTimeframe(spec.presetTimeframe) : null;
  const inPreset = (ms: number) => !ptf || (ms >= ptf.fromMs && ms < ptf.toMs);

  // ----- specific person -----
  if (spec.type === "person") {
    const d = norm(spec.mobile);
    if (!d) return [];
    return [attach(d, spec.name || null, {}, {})];
  }

  // ----- payment segments (per-student, PAID-wins) -----
  // A single student can have many rows for the same obligation
  // (INITIATED -> FAILED -> ABANDONED -> PAID). We aggregate PER PHONE and let
  // PAID win: a student with >=1 successful payment is "paid" and can NEVER fall
  // into a non-paid segment, no matter how many failed/abandoned attempts they
  // have. NOT-PAID is the exact complement (zero successful payments). This
  // reuses payClassOf / PAY_PRIORITY so it reconciles with the filter builder,
  // and no longer relies on the is_superseded flag as a PAID-wins proxy.
  if (spec.type.startsWith("payment_")) {
    const payments = await getPayments();
    const byPhone = new Map<string, { cls: FilterPayStatus | "none"; row: Payment }>();
    for (const p of payments) {
      const d = norm(p.phone);
      if (!d) continue;
      const cls = payClassOf(p.status); // "none" for INITIATED / unknown
      const prev = byPhone.get(d);
      if (!prev) { byPhone.set(d, { cls, row: p }); continue; }
      if (PAY_PRIORITY[cls] > PAY_PRIORITY[prev.cls]) { prev.cls = cls; prev.row = p; }
      else if (PAY_PRIORITY[cls] === PAY_PRIORITY[prev.cls] &&
        new Date(p.created_at).getTime() > new Date(prev.row.created_at).getTime()) prev.row = p;
    }
    const match = (cls: FilterPayStatus | "none"): boolean => {
      switch (spec.type) {
        case "payment_paid": return cls === "paid";
        case "payment_pending": return cls === "pending";
        case "payment_failed": return cls === "failed";
        case "payment_abandoned": return cls === "abandoned";
        case "payment_not_paid": return cls !== "paid"; // complement of paid (incl. INITIATED)
        default: return true; // payment_all
      }
    };
    return dedupeRecipients([...byPhone.entries()]
      .filter(([, a]) => match(a.cls) && inPreset(new Date(a.row.created_at).getTime()))
      .map(([d, a]) => attach(d, a.row.student_name, paymentVars(a.row),
        { payment_id: a.row.id, course_id: a.row.item_type === "course" ? a.row.item_slug : null, webinar_id: a.row.item_type === "webinar" ? a.row.item_slug : null })));
  }

  // ----- webinar segments -----
  if (spec.type.startsWith("webinar_")) {
    const webinar = spec.webinarSlug ? await getWebinarBySlug(spec.webinarSlug) : (await getWebinars()).find((w) => w.id === spec.webinarId) || null;
    if (!webinar) return [];
    const vars = { item_short: webinar.title, item_name: webinar.title, webinar_time: formatISTTime(webinar.datetime), webinar_date: webinar.datetime };
    const regs = await getWebinarRegistrationsByWebinar(webinar.id);
    const regByPhone = new Map<string, { name: string | null; id: string; attended: boolean; createdMs: number }>();
    for (const r of regs) { const d = norm(r.phone); if (d) regByPhone.set(d, { name: r.name, id: r.id, attended: !!r.attended, createdMs: new Date(r.created_at).getTime() }); }
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
        .filter(([d, r]) => (!isPaidWebinar || payByPhone!.get(d) === "PAID") && inPreset(r.createdMs))
        .map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
    }
    if (spec.type === "webinar_attendees") {
      return dedupeRecipients([...regByPhone.entries()].filter(([d, r]) => (r.attended || zoom.has(d)) && inPreset(r.createdMs)).map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
    }
    if (spec.type === "webinar_no_show") {
      return dedupeRecipients([...regByPhone.entries()].filter(([d, r]) => !r.attended && !zoom.has(d) && inPreset(r.createdMs)).map(([d, r]) => attach(d, r.name, vars, { registration_id: r.id, webinar_id: webinar.id })));
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
    if (ptf) leads = leads.filter((l) => inPreset(new Date(l.created_at).getTime()));
    return dedupeRecipients(leads.map((l) => { const d = norm(l.phone); return d ? attach(d, l.name, { item_short: l.course_interest || "" }, { lead_id: l.id }) : null; }).filter((x): x is Recipient => !!x));
  }

  // buyer signup dates (only needed when a preset timeframe scopes buyers).
  const buyerDateMs = ptf ? await buyerCreatedMsMap() : null;
  const buyerInTime = (d: string) => !buyerDateMs || !buyerDateMs.has(d) || inPreset(buyerDateMs.get(d)!);

  // ----- users with mobile -----
  if (spec.type === "users_with_mobile") {
    return dedupeRecipients([...bm.entries()].filter(([d]) => buyerInTime(d)).map(([d, b]) => attach(d, b.name, {}, {})));
  }

  // ----- everyone (guarded) -----
  if (spec.type === "all") {
    const list: Recipient[] = [...bm.entries()].filter(([d]) => buyerInTime(d)).map(([d, b]) => attach(d, b.name, {}, {}));
    for (const l of await getLeads()) { const d = norm(l.phone); if (d && inPreset(new Date(l.created_at).getTime())) list.push(attach(d, l.name, {}, { lead_id: l.id })); }
    return dedupeRecipients(list);
  }

  return [];
}

// ---------------------------------------------------------------------------
// COMPOSABLE "filtered" audience
// ---------------------------------------------------------------------------

/** [fromMs, toMs] for a timeframe. `all` = the whole timeline. IST month bounds. */
function timeframeBounds(tf: FilterTimeframe | null | undefined, month: string | null | undefined): [number, number] {
  const now = Date.now();
  if (!tf || tf === "all") return [-Infinity, Infinity];
  if (tf === "7d") return [now - 7 * 86400000, now];
  if (tf === "30d") return [now - 30 * 86400000, now];
  if (tf === "6mo") return [now - 182 * 86400000, now];
  // specific IST month "YYYY-MM"
  const m = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (!m) return [-Infinity, Infinity];
  const y = Number(m[1]); const mo = Number(m[2]);
  const from = new Date(`${m[1]}-${m[2]}-01T00:00:00+05:30`).getTime();
  const nextY = mo === 12 ? y + 1 : y; const nextMo = mo === 12 ? 1 : mo + 1;
  const to = new Date(`${nextY}-${String(nextMo).padStart(2, "0")}-01T00:00:00+05:30`).getTime();
  return [from, to];
}

const payClassOf = (status: string | null | undefined): FilterPayStatus | "none" => {
  if (isPaidStatus(status as Payment["status"])) return "paid";
  const s = (status || "").toUpperCase();
  if (s === "FAILED") return "failed";
  if (s === "PENDING" || s === "VERIFYING") return "pending";
  if (s === "ABANDONED") return "abandoned";
  return "none";
};
// Ordering for PAID-wins aggregation. "notpaid" is a filter selector only (never
// an actual row class), so it sorts at the bottom and is never chosen as a class.
const PAY_PRIORITY: Record<FilterPayStatus | "none", number> = { paid: 4, pending: 3, failed: 2, abandoned: 1, none: 0, notpaid: 0 };

/** Per-phone per-dimension summary: membership, best pay class, most-recent date. */
interface DimInfo { name: string | null; payClass: FilterPayStatus | "none"; dateMs: number }

/**
 * Composable audience: COURSE ∩ WEBINAR ∩ PAYMENT-STATUS ∩ TIME-FRAME.
 * Each ACTIVE dimension must be satisfied independently (intersection), and the
 * payment-status + time-frame are evaluated against THAT dimension's own row
 * (course_enrollments/course payments, webinar payments/registrations, or the
 * generic payments ledger) — so the "which date" is always well defined. Reuses
 * isPaidStatus / webinarPayClass so counts reconcile with the Payments tab.
 */
export async function resolveFilteredAudience(f: FilterSpec): Promise<Recipient[]> {
  const bm = await buyerMap();
  const attach = makeAttach(bm);
  const [fromMs, toMs] = timeframeBounds(f.timeframe, f.month);
  const inTime = (ms: number) => ms >= fromMs && ms <= toMs;
  // "notpaid" is the PAID-wins complement: anything that is not a successful
  // payment (failed / pending / abandoned / no attempt on that dimension).
  const statusOk = (cls: FilterPayStatus | "none") =>
    !f.paymentStatus || (f.paymentStatus === "notpaid" ? cls !== "paid" : cls === f.paymentStatus);

  const wantCourse = !!f.courseSlug;
  const wantWebinar = !!f.webinarSlug;

  // ---- build each active dimension's phone -> DimInfo map ----
  const payments = await getPayments();

  // COURSE dimension: course_enrollments ∪ payments(item_type=course, slug).
  let courseDim: Map<string, DimInfo> | null = null;
  if (wantCourse) {
    const slug = f.courseSlug!;
    courseDim = new Map();
    const upsert = (phone: string | null, name: string | null, cls: FilterPayStatus | "none", dateMs: number) => {
      const d = norm(phone); if (!d) return;
      const prev = courseDim!.get(d);
      if (!prev) { courseDim!.set(d, { name, payClass: cls, dateMs }); return; }
      if (PAY_PRIORITY[cls] > PAY_PRIORITY[prev.payClass]) prev.payClass = cls;
      if (dateMs > prev.dateMs) prev.dateMs = dateMs;
      if (!prev.name && name) prev.name = name;
    };
    for (const e of await getAllCourseEnrollments()) {
      if (e.course_slug !== slug) continue;
      const paidByEnrol = (e.amount_paid ?? 0) > 0;
      upsert(e.phone, e.student_name, paidByEnrol ? "paid" : "none", new Date(e.created_at).getTime());
    }
    for (const p of payments) {
      if (p.item_type !== "course" || p.item_slug !== slug || p.is_superseded) continue;
      upsert(p.phone, p.student_name, payClassOf(p.status), new Date(p.created_at).getTime());
    }
  }

  // WEBINAR dimension: registrations + paid class (free webinar => registration = paid seat).
  let webinarDim: Map<string, DimInfo> | null = null;
  let webinarVars: Record<string, string | number | null | undefined> = {};
  if (wantWebinar) {
    const webinar = await getWebinarBySlug(f.webinarSlug!);
    webinarDim = new Map();
    if (webinar) {
      webinarVars = { item_short: webinar.title, item_name: webinar.title, webinar_time: formatISTTime(webinar.datetime), webinar_date: webinar.datetime };
      const isPaidWebinar = (webinar.price ?? 0) > 0;
      const payByPhone = isPaidWebinar ? await getWebinarPaymentStatusesForSlug(webinar.slug) : null;
      const payRowDate = new Map<string, number>(); // phone -> latest webinar payment ms
      if (isPaidWebinar) {
        for (const p of payments) {
          if (p.item_type !== "webinar" || p.item_slug !== webinar.slug) continue;
          const d = norm(p.phone); if (!d) continue;
          payRowDate.set(d, Math.max(payRowDate.get(d) ?? 0, new Date(p.created_at).getTime()));
        }
      }
      for (const r of await getWebinarRegistrationsByWebinar(webinar.id)) {
        const d = norm(r.phone); if (!d) continue;
        const cls: FilterPayStatus | "none" = isPaidWebinar
          ? (payByPhone!.get(d) === "PAID" ? "paid" : payByPhone!.get(d) === "FAILED" ? "failed" : payByPhone!.get(d) === "PENDING" ? "pending" : "none")
          : "paid"; // free webinar: a registration IS a confirmed seat
        // Which date: paid webinar -> when they paid (fallback registration); free -> registration.
        const dateMs = isPaidWebinar ? (payRowDate.get(d) ?? new Date(r.created_at).getTime()) : new Date(r.created_at).getTime();
        webinarDim.set(d, { name: r.name, payClass: cls, dateMs });
      }
    }
  }

  // GENERIC payment dimension (used when neither course nor webinar is chosen):
  // per-phone PAID-wins across the whole ledger (highest-priority class), with
  // the most-recent date. A student with any successful payment is "paid" and is
  // therefore never returned by a non-paid status filter.
  let genericDim: Map<string, DimInfo> | null = null;
  if (!wantCourse && !wantWebinar) {
    genericDim = new Map();
    for (const p of payments) {
      const d = norm(p.phone); if (!d) continue;
      const ms = new Date(p.created_at).getTime();
      const cls = payClassOf(p.status);
      const prev = genericDim.get(d);
      if (!prev) { genericDim.set(d, { name: p.student_name, payClass: cls, dateMs: ms }); continue; }
      if (PAY_PRIORITY[cls] > PAY_PRIORITY[prev.payClass]) prev.payClass = cls;
      if (ms > prev.dateMs) prev.dateMs = ms;
      if (!prev.name && p.student_name) prev.name = p.student_name;
    }
  }

  // ---- intersect the active dimensions ----
  // Candidate phones = intersection of every active dimension's key set.
  const active: Map<string, DimInfo>[] = [courseDim, webinarDim, genericDim].filter((m): m is Map<string, DimInfo> => !!m);
  if (active.length === 0) return [];
  let candidates = new Set<string>(active[0].keys());
  for (let i = 1; i < active.length; i++) candidates = new Set([...candidates].filter((d) => active[i].has(d)));

  const courseTitle = wantCourse ? (await getAllCourses()).find((c) => c.slug === f.courseSlug)?.title ?? null : null;

  const out: Recipient[] = [];
  for (const d of candidates) {
    // Every active dimension must pass its own status + timeframe test.
    let ok = true; let name: string | null = null;
    for (const m of active) {
      const info = m.get(d)!;
      if (!statusOk(info.payClass) || !inTime(info.dateMs)) { ok = false; break; }
      if (!name && info.name) name = info.name;
    }
    if (!ok) continue;
    const vars: Record<string, string | number | null | undefined> = { ...webinarVars };
    if (courseTitle && !vars.item_short) { vars.item_short = courseTitle; vars.item_name = courseTitle; }
    out.push(attach(d, name, vars, {
      webinar_id: wantWebinar ? f.webinarSlug : null,
      course_id: wantCourse ? f.courseSlug : null,
    }));
  }
  return dedupeRecipients(out);
}
