/**
 * Canonical `source_form` identifiers — the stable value each lead-capture
 * call-site stamps onto its `lead_created` event (payload.source_form). Keeping
 * them in ONE place means the trigger "Lead registered" filter, the live-sources
 * endpoint and every call-site agree, and new forms are added here once.
 *
 * PURE + client-safe (imported by both server call-sites and, indirectly, the UI
 * via the live-sources API). Nothing here sends or executes.
 */

export interface LeadSourceForm {
  /** Stable value stored on the event (payload.source_form). Never rename. */
  value: string;
  /** Human label shown in the trigger filter UI. */
  label: string;
  /** Where it fires from, for staff clarity. */
  where: string;
}

export const LEAD_SOURCE_FORMS: LeadSourceForm[] = [
  { value: "public_lead_form", label: "Website lead form", where: "The inline lead form on public pages." },
  { value: "lead_popup", label: "Lead pop-up", where: "The exit/scroll lead pop-up." },
  { value: "enroll_intent", label: "Enrolment intent", where: "Captured when a visitor starts checkout." },
  { value: "quiz", label: "Quiz sign-up", where: "Public quiz gate (name + phone)." },
  { value: "webinar_registration", label: "Webinar registration", where: "Any webinar registration." },
  { value: "free_download", label: "Free download", where: "The /resources download gate (\"Open Downloads\")." },
  { value: "admin_manual", label: "Added by staff", where: "Manually added in the admin Leads screen." },
];

const KNOWN = new Set(LEAD_SOURCE_FORMS.map((s) => s.value));

/** Fallback identifier for a lead created without an explicit source_form. */
export const LEAD_SOURCE_FALLBACK = "other";

/** Normalise an arbitrary source_form to a known value (or the raw string). */
export function normalizeSourceForm(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return LEAD_SOURCE_FALLBACK;
  return v;
}

/** Label for a source_form value (falls back to a titleised version). */
export function leadSourceLabel(value: string): string {
  const found = LEAD_SOURCE_FORMS.find((s) => s.value === value);
  if (found) return found.label;
  if (value === LEAD_SOURCE_FALLBACK) return "Other / unspecified";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isKnownSourceForm(value: string): boolean {
  return KNOWN.has(value);
}
