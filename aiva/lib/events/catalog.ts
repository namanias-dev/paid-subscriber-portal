/**
 * Canonical AIVA business event catalog. Single source of truth for event_type values written
 * to the `business_events` table and mapped from existing portal tables/analytics_events.
 * See docs/aiva/EVENT_CATALOG.json.
 */

export const BUSINESS_EVENTS = [
  "visitor.session_started",
  "visitor.page_viewed",
  "visitor.offer_viewed",
  "visitor.cta_clicked",
  "lead.created",
  "lead.updated",
  "lead.consented",
  "lead.opted_out",
  "quiz.started",
  "quiz.completed",
  "webinar.viewed",
  "webinar.registered",
  "webinar.attended",
  "course.viewed",
  "course.checkout_started",
  "payment.checkout_opened",
  "payment.pending",
  "payment.proof_uploaded",
  "payment.paid",
  "payment.failed",
  "payment.abandoned",
  "payment.expired",
  "installment.created",
  "installment.due",
  "installment.overdue",
  "installment.paid",
  "enrollment.created",
  "enrollment.activated",
  "enrollment.suspended",
  "enrollment.completed",
  "class.joined",
  "class.missed",
  "recording.viewed",
  "recording.completed",
  "admin.course_created",
  "admin.course_duplicated",
  "admin.course_published",
  "admin.webinar_created",
  "admin.webinar_duplicated",
  "admin.payment_recorded",
  "admin.proof_approved",
  "admin.access_granted",
  "admin.access_revoked",
  "campaign.drafted",
  "campaign.approved",
  "campaign.sent",
  "campaign.converted",
  "agent.recommendation_created",
  "agent.recommendation_approved",
  "agent.recommendation_rejected",
  "agent.action_executed",
] as const;

export type BusinessEventType = (typeof BUSINESS_EVENTS)[number];

export type ActorType = "visitor" | "lead" | "student" | "staff" | "admin" | "system" | "agent";

/** Which agent/domain a pulse belongs to (drives Neural Core node + colour). */
export type EventDomain =
  | "revenue"
  | "admissions"
  | "marketing"
  | "student_success"
  | "content"
  | "batch_launch"
  | "operations"
  | "analytics"
  | "security"
  | "codebase_intelligence";

/** Pulse colour semantics from the AIVA spec §4.1. */
export type PulseColor = "green" | "gold" | "red" | "blue" | "purple" | "orange" | "white";

export function domainForEvent(type: string): EventDomain {
  if (type.startsWith("payment.") || type.startsWith("installment.") || type.startsWith("enrollment.")) return "revenue";
  if (type.startsWith("lead.")) return "admissions";
  if (type.startsWith("webinar.") || type.startsWith("course.")) return "admissions";
  if (type.startsWith("campaign.") || type.startsWith("visitor.")) return "marketing";
  if (type.startsWith("quiz.") || type.startsWith("class.") || type.startsWith("recording.")) return "student_success";
  if (type.startsWith("agent.")) return "analytics";
  if (type.startsWith("admin.")) return "operations";
  return "analytics";
}

export function colorForEvent(type: string): PulseColor {
  switch (type) {
    case "payment.paid":
    case "installment.paid":
      return "green";
    case "installment.overdue":
    case "payment.failed":
      return "red";
    case "payment.abandoned":
    case "payment.proof_uploaded":
      return "orange";
    case "quiz.started":
    case "quiz.completed":
    case "class.joined":
      return "blue";
    case "campaign.drafted":
    case "campaign.sent":
      return "purple";
    case "agent.recommendation_created":
    case "agent.action_executed":
      return "white";
    default:
      break;
  }
  if (type.startsWith("lead.")) return "gold";
  if (type.startsWith("webinar.")) return "blue";
  return "white";
}

export function isBusinessEvent(t: string): t is BusinessEventType {
  return (BUSINESS_EVENTS as readonly string[]).includes(t);
}
