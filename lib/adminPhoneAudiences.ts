/**
 * Phone-audience resolvers for the Lead CRM "Copy phone numbers" modal.
 * Reuses isPaidStatus / isActiveEnrollment / paid-webinar rules — no new status logic.
 */
import { normalizeIndianMobile } from "./phone";
import { isPaidStatus } from "./paymentsAgg";
import { isActiveEnrollment, isLineOutstanding } from "./installments";
import { getPayments, getLeads, getAllCourseEnrollments } from "./dataProvider";
import { normalizeLeadStatus } from "./leadStatus";
import type { Payment, CourseEnrollment, Lead } from "./types";

export type PhoneAudienceId =
  | "not_yet_paid"
  | "webinar_no_course"
  | "webinar_seat_booked"
  | "not_called_no_response"
  | "interested"
  | "seat_booked"
  | "pending_installments"
  | "dropped_off_at_payment";

export const PHONE_AUDIENCES: {
  id: PhoneAudienceId;
  label: string;
  definition: string;
}[] = [
  { id: "not_yet_paid", label: "Not yet paid", definition: "No successful payment of any kind" },
  { id: "webinar_no_course", label: "Webinar attended, no course", definition: "Paid webinar registration, but no seat booking and no installment paid" },
  { id: "webinar_seat_booked", label: "Webinar + seat booked", definition: "Paid webinar registration and a successful seat booking" },
  { id: "not_called_no_response", label: "Not called / no response", definition: "Pipeline stage is Not Called or Not Replied" },
  { id: "interested", label: "Interested", definition: "Pipeline stage is Interested" },
  { id: "seat_booked", label: "Seat booked", definition: "Successful seat-booking payment" },
  { id: "pending_installments", label: "Pending installments", definition: "At least one unpaid installment due" },
  { id: "dropped_off_at_payment", label: "Dropped off at payment", definition: "Payment status failed, abandoned, or checkout-opened" },
];

export interface PhoneAudiencePerson {
  phone: string;
  name: string | null;
  stage: string | null;
}

function digits10(phone: string | null | undefined): string | null {
  const n = normalizeIndianMobile(phone);
  return n.ok && n.digits10 ? n.digits10 : null;
}

function inRange(iso: string | null | undefined, fromMs: number, toMs: number): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
}

function isDroppedStatus(status: string | null | undefined): boolean {
  if (isPaidStatus(status as Payment["status"])) return false;
  const s = (status || "").toUpperCase();
  return s === "FAILED" || s === "ABANDONED" || s === "INITIATED" || s === "PENDING" || s === "VERIFYING";
}

interface Ctx {
  payments: Payment[];
  enrollments: CourseEnrollment[];
  leads: Lead[];
  fromMs: number;
  toMs: number;
}

async function loadCtx(fromMs: number, toMs: number): Promise<Ctx> {
  const [payments, enrollments, leads] = await Promise.all([
    getPayments(),
    getAllCourseEnrollments(),
    getLeads({ includeLegacy: false }),
  ]);
  return { payments, enrollments, leads, fromMs, toMs };
}

function leadStageByPhone(leads: Lead[]): Map<string, { name: string | null; stage: string | null; createdMs: number }> {
  const map = new Map<string, { name: string | null; stage: string | null; createdMs: number }>();
  for (const l of leads) {
    const d = digits10(l.phone);
    if (!d) continue;
    const ms = new Date(l.created_at).getTime();
    const prev = map.get(d);
    if (!prev || ms > prev.createdMs) {
      map.set(d, {
        name: l.name || null,
        stage: normalizeLeadStatus(l.status) ?? l.status ?? null,
        createdMs: ms,
      });
    }
  }
  return map;
}

function toPeople(
  phones: Set<string>,
  leadMap: Map<string, { name: string | null; stage: string | null; createdMs: number }>,
  nameFallback: Map<string, string | null>,
): PhoneAudiencePerson[] {
  const out: PhoneAudiencePerson[] = [];
  for (const phone of phones) {
    const lead = leadMap.get(phone);
    out.push({
      phone,
      name: lead?.name || nameFallback.get(phone) || null,
      stage: lead?.stage || null,
    });
  }
  out.sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.phone.localeCompare(b.phone));
  return out;
}

function resolveOne(id: PhoneAudienceId, ctx: Ctx): PhoneAudiencePerson[] {
  const { payments, enrollments, leads, fromMs, toMs } = ctx;
  const leadMap = leadStageByPhone(leads);
  const nameFallback = new Map<string, string | null>();

  const paidAny = new Set<string>();
  const webinarEver = new Set<string>();
  const webinarInRange = new Set<string>();
  const seatEver = new Set<string>();
  const seatInRange = new Set<string>();
  const installmentEver = new Set<string>();
  const droppedInRange = new Set<string>();

  for (const p of payments) {
    if (p.deleted_at) continue;
    const d = digits10(p.phone);
    if (!d) continue;
    if (p.student_name) nameFallback.set(d, p.student_name);

    if (isPaidStatus(p.status)) {
      paidAny.add(d);
      if (p.item_type === "webinar") {
        webinarEver.add(d);
        if (inRange(p.created_at, fromMs, toMs)) webinarInRange.add(d);
      }
      if (p.item_type === "course" && p.payment_kind === "seat") {
        seatEver.add(d);
        if (inRange(p.created_at, fromMs, toMs)) seatInRange.add(d);
      }
      if (p.item_type === "course" && p.payment_kind === "installment") {
        installmentEver.add(d);
      }
    } else if (isDroppedStatus(p.status) && inRange(p.created_at, fromMs, toMs)) {
      droppedInRange.add(d);
    }
  }

  const phones = new Set<string>();

  switch (id) {
    case "not_yet_paid": {
      for (const [d, info] of leadMap) {
        if (info.createdMs >= fromMs && info.createdMs < toMs && !paidAny.has(d)) phones.add(d);
      }
      for (const p of payments) {
        if (p.deleted_at) continue;
        const d = digits10(p.phone);
        if (!d || !inRange(p.created_at, fromMs, toMs)) continue;
        if (!paidAny.has(d)) phones.add(d);
      }
      break;
    }
    case "webinar_no_course": {
      for (const d of webinarInRange) {
        if (!seatEver.has(d) && !installmentEver.has(d)) phones.add(d);
      }
      break;
    }
    case "webinar_seat_booked": {
      for (const d of seatInRange) {
        if (webinarEver.has(d)) phones.add(d);
      }
      break;
    }
    case "not_called_no_response": {
      for (const [d, info] of leadMap) {
        if (info.createdMs < fromMs || info.createdMs >= toMs) continue;
        if (info.stage === "Not Called" || info.stage === "Not Replied") phones.add(d);
      }
      break;
    }
    case "interested": {
      for (const [d, info] of leadMap) {
        if (info.createdMs < fromMs || info.createdMs >= toMs) continue;
        if (info.stage === "Interested") phones.add(d);
      }
      break;
    }
    case "seat_booked": {
      for (const d of seatInRange) phones.add(d);
      break;
    }
    case "pending_installments": {
      for (const e of enrollments) {
        if (!isActiveEnrollment(e)) continue;
        const d = digits10(e.phone);
        if (!d) continue;
        if (e.student_name) nameFallback.set(d, e.student_name);
        for (const s of e.schedule || []) {
          if (s.kind !== "installment" || !isLineOutstanding(s)) continue;
          const dueOk = s.due ? inRange(s.due, fromMs, toMs) : inRange(e.created_at, fromMs, toMs);
          if (dueOk) phones.add(d);
        }
      }
      break;
    }
    case "dropped_off_at_payment": {
      for (const d of droppedInRange) {
        if (!paidAny.has(d)) phones.add(d);
      }
      break;
    }
  }

  return toPeople(phones, leadMap, nameFallback);
}

export async function countAllPhoneAudiences(
  fromMs: number,
  toMs: number,
): Promise<Record<PhoneAudienceId, number>> {
  const ctx = await loadCtx(fromMs, toMs);
  const out = {} as Record<PhoneAudienceId, number>;
  for (const a of PHONE_AUDIENCES) {
    out[a.id] = resolveOne(a.id, ctx).length;
  }
  return out;
}

export async function resolvePhoneAudience(
  id: PhoneAudienceId,
  fromMs: number,
  toMs: number,
): Promise<PhoneAudiencePerson[]> {
  const ctx = await loadCtx(fromMs, toMs);
  return resolveOne(id, ctx);
}

/** Clipboard payload: 10-digit phones, one per line, LF only, no trailing blank line. */
export function formatPhonesForClipboard(phones: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of phones) {
    const d = digits10(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    lines.push(d);
  }
  return lines.join("\n");
}
