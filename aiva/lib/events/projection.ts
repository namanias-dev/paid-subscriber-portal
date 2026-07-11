import { getSupabase } from "../supabase";
import { isPaidStatus } from "@portal/lib/paymentsAgg";
import { colorForEvent, domainForEvent, type EventDomain, type PulseColor } from "./catalog";

/**
 * Live pulse projection for the AIVA Neural Core. Reads RECENT REAL rows from existing portal
 * tables (payments, payment_proofs, webinar_registrations, leads, analytics_events) plus any
 * rows already in business_events, and normalizes them into pulses.
 *
 * Every pulse corresponds to a real business event — no decorative/fake activity.
 */

export type Pulse = {
  id: string;
  event_type: string;
  domain: EventDomain;
  color: PulseColor;
  occurred_at: string;
  label: string;
};

const SAFE_EMPTY: Pulse[] = [];

export async function getRecentPulses(limitPerSource = 12, total = 60): Promise<Pulse[]> {
  const sb = getSupabase();
  if (!sb) return SAFE_EMPTY;

  const pulses: Pulse[] = [];

  // Payments: paid / abandoned / failed / pending
  try {
    const { data } = await sb
      .from("payments")
      .select("id, status, created_at, item_type, item")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limitPerSource * 3);
    for (const p of data || []) {
      const status = String(p.status || "");
      let type = "payment.pending";
      if (isPaidStatus(status as never)) type = "payment.paid";
      else if (status === "ABANDONED") type = "payment.abandoned";
      else if (status === "FAILED") type = "payment.failed";
      else if (status === "INITIATED") type = "payment.checkout_opened";
      else continue; // skip noisy pending states in the pulse feed
      pulses.push(pulse(p.id, type, p.created_at, labelFor(type, p.item_type)));
    }
  } catch { /* best-effort */ }

  // Payment proofs awaiting review
  try {
    const { data } = await sb
      .from("payment_proofs")
      .select("id, status, created_at")
      .in("status", ["submitted", "reupload_requested"])
      .order("created_at", { ascending: false })
      .limit(limitPerSource);
    for (const r of data || []) pulses.push(pulse(r.id, "payment.proof_uploaded", r.created_at, "Payment proof uploaded"));
  } catch { /* best-effort */ }

  // Webinar registrations
  try {
    const { data } = await sb
      .from("webinar_registrations")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(limitPerSource);
    for (const r of data || []) pulses.push(pulse(r.id, "webinar.registered", r.created_at, "Webinar registration"));
  } catch { /* best-effort */ }

  // New leads
  try {
    const { data } = await sb
      .from("leads")
      .select("id, created_at, temperature")
      .order("created_at", { ascending: false })
      .limit(limitPerSource);
    for (const r of data || []) {
      const hot = String(r.temperature || "").toLowerCase() === "warm" || String(r.temperature || "").toLowerCase() === "interested";
      pulses.push(pulse(r.id, "lead.created", r.created_at, hot ? "Hot lead detected" : "New lead"));
    }
  } catch { /* best-effort */ }

  // Quiz / class activity from analytics_events
  try {
    const { data } = await sb
      .from("analytics_events")
      .select("event_id, event_name, occurred_at")
      .in("event_name", ["registration_created", "course_view", "webinar_view", "login"])
      .order("occurred_at", { ascending: false })
      .limit(limitPerSource);
    for (const r of data || []) {
      const map: Record<string, string> = {
        registration_created: "webinar.registered",
        course_view: "course.viewed",
        webinar_view: "webinar.viewed",
        login: "class.joined",
      };
      const type = map[String(r.event_name)] || "visitor.page_viewed";
      pulses.push(pulse(String(r.event_id), type, r.occurred_at, labelFor(type)));
    }
  } catch { /* best-effort */ }

  // Any explicitly-emitted canonical business events
  try {
    const { data } = await sb
      .from("business_events")
      .select("id, event_type, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(limitPerSource);
    for (const r of data || []) pulses.push(pulse(String(r.id), String(r.event_type), r.occurred_at, labelFor(String(r.event_type))));
  } catch { /* table may not exist yet — safe */ }

  return pulses
    .filter((p) => p.occurred_at)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, total);
}

function pulse(id: string, type: string, occurred_at: string | null, label: string): Pulse {
  return {
    id: `${type}:${id}`,
    event_type: type,
    domain: domainForEvent(type),
    color: colorForEvent(type),
    occurred_at: occurred_at || new Date().toISOString(),
    label,
  };
}

function labelFor(type: string, extra?: string | null): string {
  const base: Record<string, string> = {
    "payment.paid": "Payment received",
    "payment.abandoned": "Checkout abandoned",
    "payment.failed": "Payment failed",
    "payment.checkout_opened": "Checkout opened",
    "payment.proof_uploaded": "Payment proof uploaded",
    "webinar.registered": "Webinar registration",
    "webinar.viewed": "Webinar viewed",
    "course.viewed": "Course viewed",
    "lead.created": "New lead",
    "class.joined": "Login / class activity",
  };
  const label = base[type] || type;
  return extra ? `${label} · ${extra}` : label;
}
